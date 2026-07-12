/**
 * Phase 2 — Supabase adapter for the midnight billing engine.
 *
 * Thin DB layer behind MidnightBillingAdapter: finds due charges and persists each
 * outcome. The decision logic lives in midnightBilling.ts; this only does I/O.
 *
 * Centers AND teachers now flow through the SAME `invoices` machinery:
 *  - Centers: their subscription invoice already exists (subscriptionBillingCron /
 *    signup) — due rows are read from `invoices`.
 *  - Teachers: due rows are read from `teacher_subscriptions` (next_billing_at),
 *    and the engine CREATES the teacher's invoice on the billing day
 *    (ensureTeacherSubscriptionInvoice) before charging — mirroring centers.
 *
 * Money-safety notes:
 *  - On a successful card charge we link the MIT Paymob order to the invoice and
 *    call the SAME idempotent finalizer the webhook uses
 *    (`finalizeInvoicePaymentSuccess`, which no-ops if already paid + advances the
 *    teacher subscription / center on settle), so cron and webhook can both run
 *    without double-advancing.
 *  - One invoice, one processing fee: a teacher dunning retry REUSES the same open
 *    invoice (ensureTeacherSubscriptionInvoice), so the flat fee is never doubled.
 *  - Pay-link creation is best-effort: if Paymob isn't configured the invoice is
 *    still left in the unpaid bucket and the owner's on-demand pay flow makes the
 *    link later.
 *  - Lock timing is the single-day rule (autoSuspendAtFromDue for centers,
 *    grace_until for teachers — the free-tier drop is preserved); during the soft
 *    retry window the lock is deferred to just after the next retry day.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { cairoDateKey, cairoPaidAtDayUtcBounds, startOfUtcInstantForCairoCalendarDay } from '@/lib/cairo/day';
import { autoSuspendAtFromDue } from '@/lib/billingSchedule';
import { lockAtFromBillingDay } from '@/lib/billingLifecycle';
import { createPaymobCheckoutEgp } from '@/lib/paymobCenterCheckout';
import { finalizeInvoicePaymentSuccess } from '@/lib/invoicePaymobPayment';
import {
  ensureTeacherSubscriptionInvoice,
  ensureTeacherOverageInvoice,
  advanceTeacherSubscriptionPaid,
  advanceTeacherOverageTick,
} from '@/lib/teacherBilling';
import { countActiveNonGuestStudents } from '@/lib/teacherCap';
import { teacherOverageAmount, getTeacherPlan } from '@/lib/teacherPlans';
import { getIntervalConfig, getProcessingFeeConfig } from '@/lib/pricingConfig';
import { resolveProcessingFeeAmount } from '@/lib/processingFee';
import { round2 } from '@/lib/invoiceBalance';
import { MAX_CHARGE_ATTEMPTS, type DueChargeable, type ManualReason, type MidnightBillingAdapter } from '@/lib/midnightBilling';
import type { OwnerRef } from '@/lib/savedCard/types';
import { classifyPaymobDecline } from '@/lib/savedCard/declineClassification';

type Row = Record<string, unknown>;

async function ownersWithActiveCard(
  supabase: SupabaseClient,
  ownerType: 'center' | 'teacher',
  ownerIds: string[],
): Promise<Set<string>> {
  if (ownerIds.length === 0) return new Set();
  const { data } = await supabase
    .from('saved_cards')
    .select('owner_id')
    .eq('owner_type', ownerType)
    .eq('status', 'active')
    .in('owner_id', ownerIds);
  return new Set(((data as Row[]) ?? []).map((r) => String(r.owner_id)));
}

async function emitEvent(
  supabase: SupabaseClient,
  action: string,
  owner: OwnerRef,
  details: Record<string, unknown>,
): Promise<void> {
  await supabase.from('audit_log').insert({
    action,
    entity_type: 'billing_autocharge',
    entity_id: owner.ownerId,
    center_id: owner.ownerType === 'center' ? owner.ownerId : null,
    details: { ownerType: owner.ownerType, ...details },
  });
}

/**
 * Best-effort Paymob pay-link for an unpaid invoice (center OR teacher). The
 * billing display name/phone is read from the right owner table. Idempotent: it
 * no-ops once a link exists, and the update guards on a null paymob_order_id.
 */
async function ensureInvoicePayLink(supabase: SupabaseClient, invoiceId: string): Promise<void> {
  const { data } = await supabase
    .from('invoices')
    .select('id, owner_type, center_id, teacher_id, invoice_number, total_amount, paymob_order_id, paymob_iframe_url')
    .eq('id', invoiceId)
    .maybeSingle();
  const inv = data as Row | null;
  if (!inv) return;
  if (inv.paymob_order_id && inv.paymob_iframe_url) return; // link already present

  let displayName = 'Customer';
  let phoneDigits = '0';
  if (inv.owner_type === 'teacher' && inv.teacher_id) {
    const { data: u } = await supabase
      .from('users')
      .select('name, phone')
      .eq('id', String(inv.teacher_id))
      .maybeSingle();
    const ur = (u as Row | null) ?? {};
    displayName = (String(ur.name ?? '').trim() || 'Teacher').slice(0, 50);
    phoneDigits = String(ur.phone ?? '').replace(/\D/g, '') || '0';
  } else if (inv.center_id) {
    const { data: center } = await supabase
      .from('centers')
      .select('name, phone')
      .eq('id', String(inv.center_id))
      .maybeSingle();
    const c = (center as Row | null) ?? {};
    displayName = (String(c.name ?? '').trim() || 'Center').slice(0, 50);
    phoneDigits = String(c.phone ?? '').replace(/\D/g, '') || '0';
  }

  try {
    const { paymobOrderId, iframeUrl } = await createPaymobCheckoutEgp({
      amountEgp: Number(inv.total_amount ?? 0),
      merchantOrderId: `inv-${invoiceId}-${Date.now()}`,
      itemName: `Invoice ${String(inv.invoice_number ?? '')}`.slice(0, 120),
      phoneDigits,
      displayName,
    });
    await supabase
      .from('invoices')
      .update({ paymob_order_id: paymobOrderId, paymob_iframe_url: iframeUrl })
      .eq('id', invoiceId)
      .is('paymob_order_id', null);
  } catch (e) {
    // Best-effort: leave unpaid; the owner's on-demand pay flow creates the link.
    console.warn('[midnightBilling] pay-link creation skipped', invoiceId, (e as Error).message);
  }
}

export function createSupabaseMidnightBillingAdapter(
  supabase: SupabaseClient,
  now: Date = new Date(),
): MidnightBillingAdapter {
  const today = cairoDateKey(now);

  return {
    todayCairo() {
      return today;
    },

    async listDue(todayCairo: string): Promise<DueChargeable[]> {
      const items: DueChargeable[] = [];

      // --- Centers: initial subscription charges due today (or earlier) ---
      // `.lte` (not `.eq`) so a straggler is still picked up on the NEXT run: a
      // center's first subscription invoice can be issued by summer-billing on
      // Cairo-day D with due_date=D, and if autocharge already ran that day it
      // would never re-match an `.eq('due_date', D+1)`. Widening catches it the
      // next night. The status filter (pending/overdue) still excludes a
      // final-failed invoice (status='failed', handled by retryInv below), and
      // the downstream charge path is idempotent (applyCharged guards
      // `.neq('status','paid')` and finalizeInvoicePaymentSuccess no-ops if
      // already paid), so a paid invoice is never re-charged.
      // NOTE (cron ordering): vercel.json also runs summer-billing BEFORE
      // subscription-autocharge on the same night so same-day issuance is
      // collected immediately; this `.lte` widening is the belt-and-suspenders.
      const { data: dueInv } = await supabase
        .from('invoices')
        .select('id, center_id, total_amount, billing_period_start, status, retry_count')
        .eq('owner_type', 'center')
        .eq('invoice_type', 'subscription')
        .in('status', ['pending', 'overdue'])
        .lte('due_date', todayCairo);

      // --- Centers: soft-decline retries scheduled for today ---
      const { data: retryInv } = await supabase
        .from('invoices')
        .select('id, center_id, total_amount, billing_period_start, status, retry_count')
        .eq('owner_type', 'center')
        .eq('invoice_type', 'subscription')
        .eq('status', 'failed')
        .eq('next_retry_at', todayCairo)
        .gte('retry_count', 1)
        .lt('retry_count', MAX_CHARGE_ATTEMPTS);

      const centerRows = [...((dueInv as Row[]) ?? []), ...((retryInv as Row[]) ?? [])];
      const centerIds = centerRows.map((r) => String(r.center_id));
      const centerCarded = await ownersWithActiveCard(supabase, 'center', centerIds);

      for (const r of centerRows) {
        const ownerId = String(r.center_id);
        items.push({
          key: String(r.id),
          customerType: 'center',
          owner: { ownerType: 'center', ownerId },
          amount: Number(r.total_amount ?? 0),
          invoiceId: String(r.id),
          periodKey: String(r.billing_period_start ?? todayCairo).slice(0, 7),
          billingDayCairo: todayCairo,
          hasSavedCard: centerCarded.has(ownerId),
          attemptIndex: Number(r.retry_count ?? 0),
        });
      }

      // --- Teachers: charges/retries due today (next_billing_at within Cairo day) ---
      const { start, endExclusive } = cairoPaidAtDayUtcBounds(todayCairo);
      const { data: dueTeach } = await supabase
        .from('teacher_subscriptions')
        .select('id, teacher_id, plan_key, price_gross, billing_interval, dunning_attempts, status, next_billing_at, scheduled_plan_key')
        .in('status', ['active', 'trialing', 'past_due'])
        .gte('next_billing_at', start.toISOString())
        .lt('next_billing_at', endExclusive.toISOString());

      const teachRows = (dueTeach as Row[]) ?? [];
      const teacherIds = teachRows.map((r) => String(r.teacher_id));
      const teacherCarded = await ownersWithActiveCard(supabase, 'teacher', teacherIds);

      // Flat processing fee (snapshotted onto each new teacher invoice).
      let fee = 0;
      try {
        fee = resolveProcessingFeeAmount(await getProcessingFeeConfig());
      } catch {
        fee = 0;
      }
      // Shared annual multiplier (=10) — only applied to billing_interval='annual' rows.
      let annualMultiplier: number | undefined;
      try {
        annualMultiplier = (await getIntervalConfig()).annualMultiplier;
      } catch {
        annualMultiplier = undefined;
      }

      for (const r of teachRows) {
        const attempt = Number(r.dunning_attempts ?? 0);
        if (attempt >= MAX_CHARGE_ATTEMPTS) continue;
        const ownerId = String(r.teacher_id);

        // G1/G5: a scheduled downgrade LANDS exactly here, at the renewal boundary —
        // the new (lower) plan + its price take effect for the period now starting,
        // never sooner. set_teacher_plan_key keeps the renewal cadence; the recurring
        // engine advances the period on payment.
        let priceGross = Number(r.price_gross ?? 0);
        const scheduledPlan = r.scheduled_plan_key ? String(r.scheduled_plan_key) : null;
        if (scheduledPlan && scheduledPlan !== r.plan_key) {
          await supabase.rpc('set_teacher_plan_key', {
            p_user_id: ownerId,
            p_plan_key: scheduledPlan,
            p_actor_id: ownerId,
          });
          await supabase
            .from('teacher_subscriptions')
            .update({ scheduled_plan_key: null, scheduled_billing_interval: null })
            .eq('id', r.id);
          priceGross = getTeacherPlan(scheduledPlan).priceGross;
        }

        const interval: 'monthly' | 'annual' =
          r.billing_interval === 'annual' ? 'annual' : 'monthly';
        const monthlyFallbackBase =
          interval === 'annual' ? priceGross * (annualMultiplier ?? 10) : priceGross;

        // Create (or reuse, on retry) the teacher's invoice on the billing day —
        // this is the teacher equivalent of the center subscription invoice.
        const ensured = await ensureTeacherSubscriptionInvoice(supabase, {
          teacherId: ownerId,
          billingDayCairo: todayCairo,
          priceGross,
          fee,
          interval,
          annualMultiplier,
        });

        items.push({
          key: `teacher:${String(r.id)}`,
          customerType: 'teacher',
          owner: { ownerType: 'teacher', ownerId },
          amount: ensured ? ensured.total : round2(monthlyFallbackBase + fee),
          invoiceId: ensured ? ensured.invoiceId : null,
          periodKey: todayCairo.slice(0, 7),
          billingDayCairo: todayCairo,
          hasSavedCard: teacherCarded.has(ownerId),
          attemptIndex: attempt,
          billingInterval: interval,
        });
      }

      // --- Teachers: Scale monthly OVERAGE tick (independent of the base cycle) ---
      // Driven by overage_next_at, NOT next_billing_at, so an annual Scale base
      // (next_billing +12m) still gets a monthly overage true-up. Summer-safe: the
      // tick is only ever set/advanced for active Scale subs, never the held path.
      const { data: dueOverage } = await supabase
        .from('teacher_subscriptions')
        .select('id, teacher_id, plan_key, status, overage_next_at')
        .eq('plan_key', 'teacher_scale')
        .in('status', ['active', 'past_due'])
        .not('overage_next_at', 'is', null)
        .gte('overage_next_at', start.toISOString())
        .lt('overage_next_at', endExclusive.toISOString());

      const overageRows = (dueOverage as Row[]) ?? [];
      const overageTeacherIds = overageRows.map((r) => String(r.teacher_id));
      const overageCarded = await ownersWithActiveCard(supabase, 'teacher', overageTeacherIds);

      for (const r of overageRows) {
        const ownerId = String(r.teacher_id);
        let activeCount = 0;
        try {
          activeCount = await countActiveNonGuestStudents(supabase, ownerId);
        } catch {
          // Cannot count reliably → skip this tick (do NOT advance; reassess next run).
          continue;
        }
        const overageAmount = teacherOverageAmount('teacher_scale', activeCount);

        if (overageAmount <= 0) {
          // Nothing over the cap this month — keep the cadence moving, no invoice.
          await advanceTeacherOverageTick(supabase, ownerId, todayCairo);
          continue;
        }

        const ensured = await ensureTeacherOverageInvoice(supabase, {
          teacherId: ownerId,
          billingDayCairo: todayCairo,
          overageAmount,
          fee,
          overageStudents: Math.max(0, activeCount - 100),
        });
        if (!ensured) {
          await advanceTeacherOverageTick(supabase, ownerId, todayCairo);
          continue;
        }

        // Read the overage invoice's own retry_count so overage dunning is tracked
        // on the invoice, never on the subscription's base dunning_attempts.
        const { data: ovInv } = await supabase
          .from('invoices')
          .select('retry_count')
          .eq('id', ensured.invoiceId)
          .maybeSingle();
        items.push({
          key: `teacher-overage:${String(r.id)}`,
          customerType: 'teacher',
          owner: { ownerType: 'teacher', ownerId },
          amount: ensured.total,
          invoiceId: ensured.invoiceId,
          periodKey: todayCairo.slice(0, 7),
          billingDayCairo: todayCairo,
          hasSavedCard: overageCarded.has(ownerId),
          attemptIndex: Number((ovInv as Row | null)?.retry_count ?? 0),
          overage: true,
        });
      }

      return items;
    },

    async applyCharged(item, result) {
      if (!result.ok) return; // only called for a successful charge
      if (item.invoiceId && result.paymobOrderId) {
        // Unified center + teacher path: link the MIT order and finalize. The
        // finalizer advances the center OR teacher subscription on settle.
        await supabase
          .from('invoices')
          .update({
            paymob_order_id: result.paymobOrderId,
            paymob_transaction_id: result.transactionId,
          })
          .eq('id', item.invoiceId)
          .neq('status', 'paid');
        await finalizeInvoicePaymentSuccess(supabase, result.paymobOrderId, result.transactionId ?? '');
      } else if (item.customerType === 'teacher') {
        // Defensive fallback (invoice creation failed): advance directly.
        await advanceTeacherSubscriptionPaid(supabase, item.owner.ownerId, today, item.billingInterval);
      }
      await emitEvent(supabase, 'autocharge_succeeded', item.owner, {
        invoiceId: item.invoiceId,
        transactionId: result.transactionId,
      });
    },

    async applyAlreadyCharged(item, result) {
      if (!result.ok) return;
      // Same finalize path; both sides are idempotent (finalize no-ops if paid;
      // teacher advance is skipped when next_billing_at is already in the future).
      if (item.invoiceId && result.paymobOrderId) {
        await finalizeInvoicePaymentSuccess(supabase, result.paymobOrderId, result.transactionId ?? '');
      } else if (item.customerType === 'teacher') {
        const { data } = await supabase
          .from('teacher_subscriptions')
          .select('next_billing_at')
          .eq('teacher_id', item.owner.ownerId)
          .maybeSingle();
        const nb = (data as Row | null)?.next_billing_at;
        const alreadyAdvanced = nb && cairoDateKey(new Date(String(nb))) > today;
        if (!alreadyAdvanced)
          await advanceTeacherSubscriptionPaid(supabase, item.owner.ownerId, today, item.billingInterval);
      }
    },

    async applyManualUnpaid(item, reason: ManualReason) {
      // Both owners get a pay-link on the unpaid invoice so the on-demand pay
      // surface (center /pay, teacher /teacher/pay) can settle it.
      if (item.invoiceId) {
        await ensureInvoicePayLink(supabase, item.invoiceId);
      }
      if (item.customerType === 'center') {
        await supabase
          .from('centers')
          .update({ auto_suspend_at: autoSuspendAtFromDue(item.billingDayCairo) })
          .eq('id', item.owner.ownerId)
          .neq('billing_status', 'paid');
      } else if (item.overage) {
        // Overage is a month-end true-up, not the base subscription — an unpaid
        // overage invoice never locks the private engine. Pay-link only (above).
      } else {
        // Teacher free-tier drop preserved: lock the private engine at the next
        // Cairo midnight. The invoice stays unpaid; she pays it to restore access.
        await supabase
          .from('teacher_subscriptions')
          .update({ grace_until: lockAtFromBillingDay(item.billingDayCairo) })
          .eq('teacher_id', item.owner.ownerId);
      }
      // Phase 4 reads this event to drive the WhatsApp/banner fallback sequence.
      await emitEvent(supabase, 'autocharge_manual_unpaid', item.owner, {
        invoiceId: item.invoiceId,
        reason,
      });
    },

    async applyRetryScheduled(item, nextRetryYmd, attempt) {
      // Defer the lock to just after the next retry day so the customer is not
      // locked mid-retry-window.
      const deferLock = lockAtFromBillingDay(nextRetryYmd);
      if (item.invoiceId) {
        // Mark the invoice failed + schedule the retry (one invoice, reused on the
        // retry day). Applies to both centers and teachers.
        await supabase
          .from('invoices')
          .update({
            status: 'failed',
            retry_count: attempt,
            last_retry_at: new Date().toISOString(),
            next_retry_at: nextRetryYmd,
          })
          .eq('id', item.invoiceId);
      }
      if (item.customerType === 'center') {
        await supabase
          .from('centers')
          .update({ auto_suspend_at: deferLock })
          .eq('id', item.owner.ownerId)
          .neq('billing_status', 'paid');
      } else if (item.overage) {
        // Overage retries re-detect off overage_next_at (NOT next_billing_at), and
        // never touch the base dunning_attempts/grace — the base cycle is separate.
        await supabase
          .from('teacher_subscriptions')
          .update({ overage_next_at: startOfUtcInstantForCairoCalendarDay(nextRetryYmd).toISOString() })
          .eq('teacher_id', item.owner.ownerId);
      } else {
        // Teacher re-detection on the retry day is driven by next_billing_at, so
        // move it forward and record the attempt; defer the free-tier lock.
        await supabase
          .from('teacher_subscriptions')
          .update({
            dunning_attempts: attempt,
            next_billing_at: startOfUtcInstantForCairoCalendarDay(nextRetryYmd).toISOString(),
            grace_until: deferLock,
          })
          .eq('teacher_id', item.owner.ownerId);
      }
      await emitEvent(supabase, 'autocharge_retry_scheduled', item.owner, {
        invoiceId: item.invoiceId,
        nextRetryYmd,
        attempt,
      });
    },

    async applyFinalFailed(item) {
      // Retries exhausted → lock fires at the next Cairo midnight.
      const lockTomorrow = lockAtFromBillingDay(today);
      if (item.invoiceId) {
        await ensureInvoicePayLink(supabase, item.invoiceId);
      }
      if (item.customerType === 'center') {
        await supabase
          .from('centers')
          .update({ auto_suspend_at: lockTomorrow })
          .eq('id', item.owner.ownerId)
          .neq('billing_status', 'paid');
      } else if (item.overage) {
        // Give up on this month's overage and move the tick on; never lock the
        // engine for an unpaid true-up (the open invoice remains payable on demand).
        await advanceTeacherOverageTick(supabase, item.owner.ownerId, today);
      } else {
        await supabase
          .from('teacher_subscriptions')
          .update({ grace_until: lockTomorrow, dunning_attempts: MAX_CHARGE_ATTEMPTS })
          .eq('teacher_id', item.owner.ownerId);
      }
      await emitEvent(supabase, 'autocharge_final_failed', item.owner, { invoiceId: item.invoiceId });
    },

    async applyReconcile(item, result) {
      await emitEvent(supabase, 'autocharge_reconcile', item.owner, {
        invoiceId: item.invoiceId,
        status: result.ok ? result.status : result.status,
        intentId: 'intentId' in result ? result.intentId : null,
      });
    },

    async recordDecline(item, result) {
      if (result.ok || result.status !== 'declined') return;
      const declineCode = result.declineCode ?? null;
      const errorMessage = result.errorMessage ?? null;
      const classification = classifyPaymobDecline({ code: declineCode, message: errorMessage });

      // Best-effort card metadata (weak issuer proxy: brand + last4).
      let cardBrand: string | null = null;
      let cardLast4: string | null = null;
      try {
        const { data: card } = await supabase
          .from('saved_cards')
          .select('card_brand, card_last4')
          .eq('owner_type', item.owner.ownerType)
          .eq('owner_id', item.owner.ownerId)
          .eq('status', 'active')
          .maybeSingle();
        const cr = card as Row | null;
        cardBrand = (cr?.card_brand as string) ?? null;
        cardLast4 = (cr?.card_last4 as string) ?? null;
      } catch {
        // metadata is non-essential — record the decline regardless.
      }

      try {
        await supabase.from('recurring_charge_declines').insert({
          owner_type: item.owner.ownerType,
          owner_id: item.owner.ownerId,
          invoice_id: item.invoiceId,
          billing_period: item.periodKey,
          attempt_index: item.attemptIndex,
          decline_code: declineCode,
          decline_classification: classification,
          error_message: errorMessage,
          card_brand: cardBrand,
          card_last4: cardLast4,
          // issuer_bank left null: Paymob does not expose the issuing bank on the
          // recurring-charge response we parse today.
          issuer_bank: null,
        });
      } catch (e) {
        console.error('[midnightBilling] recordDecline insert failed', item.key, e);
      }
    },
  };
}
