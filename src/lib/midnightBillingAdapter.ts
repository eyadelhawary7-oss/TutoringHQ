/**
 * Phase 2 — Supabase adapter for the midnight billing engine.
 *
 * Thin DB layer behind MidnightBillingAdapter: finds due charges (centers via the
 * `invoices` table, teachers via `teacher_subscriptions`), and persists each
 * outcome. The decision logic lives in midnightBilling.ts; this only does I/O.
 *
 * Money-safety notes:
 *  - On a successful card charge we link the MIT Paymob order to the invoice and
 *    call the SAME idempotent finalizer the webhook uses
 *    (`finalizeInvoicePaymentSuccess`, which no-ops if already paid), so cron and
 *    webhook can both run without double-advancing the subscription.
 *  - Pay-link creation is best-effort: if Paymob isn't configured the invoice is
 *    still left in the unpaid bucket and the owner's on-demand pay flow makes the
 *    link later.
 *  - Lock timing is the single-day rule (autoSuspendAtFromDue); during the soft
 *    retry window the lock is deferred to just after the next retry day.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { cairoDateKey, cairoYmdPlusDays, cairoPaidAtDayUtcBounds, startOfUtcInstantForCairoCalendarDay } from '@/lib/cairo/day';
import { autoSuspendAtFromDue } from '@/lib/billingSchedule';
import { lockAtFromBillingDay } from '@/lib/billingLifecycle';
import { createPaymobCheckoutEgp } from '@/lib/paymobCenterCheckout';
import { finalizeInvoicePaymentSuccess } from '@/lib/invoicePaymobPayment';
import { MAX_CHARGE_ATTEMPTS, type DueChargeable, type ManualReason, type MidnightBillingAdapter } from '@/lib/midnightBilling';
import type { OwnerRef } from '@/lib/savedCard/types';

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

async function ensureCenterInvoicePayLink(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<void> {
  const { data } = await supabase
    .from('invoices')
    .select('id, center_id, invoice_number, total_amount, paymob_order_id, paymob_iframe_url')
    .eq('id', invoiceId)
    .maybeSingle();
  const inv = data as Row | null;
  if (!inv) return;
  if (inv.paymob_order_id && inv.paymob_iframe_url) return; // link already present

  const { data: center } = await supabase
    .from('centers')
    .select('name, phone')
    .eq('id', String(inv.center_id))
    .maybeSingle();
  const c = (center as Row | null) ?? {};
  try {
    const { paymobOrderId, iframeUrl } = await createPaymobCheckoutEgp({
      amountEgp: Number(inv.total_amount ?? 0),
      merchantOrderId: `inv-${invoiceId}-${Date.now()}`,
      itemName: `Invoice ${String(inv.invoice_number ?? '')}`.slice(0, 120),
      phoneDigits: String(c.phone ?? '').replace(/\D/g, '') || '0',
      displayName: String(c.name ?? 'Center').slice(0, 50),
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

/** Advance a teacher subscription by one paid month (Cairo-anchored). */
async function advanceTeacher(supabase: SupabaseClient, teacherId: string, todayCairo: string): Promise<void> {
  const nextYmd = cairoYmdPlusDays(todayCairo, 30);
  const nowIso = new Date().toISOString();
  const nextIso = startOfUtcInstantForCairoCalendarDay(nextYmd).toISOString();
  await supabase
    .from('teacher_subscriptions')
    .update({
      status: 'active',
      current_period_start: nowIso,
      current_period_end: nextIso,
      next_billing_at: nextIso,
      last_payment_at: nowIso,
      grace_until: null,
      dunning_attempts: 0,
    })
    .eq('teacher_id', teacherId);
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

      // --- Centers: initial subscription charges due today ---
      const { data: dueInv } = await supabase
        .from('invoices')
        .select('id, center_id, total_amount, billing_period_start, status, retry_count')
        .eq('invoice_type', 'subscription')
        .in('status', ['pending', 'overdue'])
        .eq('due_date', todayCairo);

      // --- Centers: soft-decline retries scheduled for today ---
      const { data: retryInv } = await supabase
        .from('invoices')
        .select('id, center_id, total_amount, billing_period_start, status, retry_count')
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
        .select('id, teacher_id, price_gross, dunning_attempts, status, next_billing_at')
        .in('status', ['active', 'trialing', 'past_due'])
        .gte('next_billing_at', start.toISOString())
        .lt('next_billing_at', endExclusive.toISOString());

      const teachRows = (dueTeach as Row[]) ?? [];
      const teacherIds = teachRows.map((r) => String(r.teacher_id));
      const teacherCarded = await ownersWithActiveCard(supabase, 'teacher', teacherIds);

      for (const r of teachRows) {
        const attempt = Number(r.dunning_attempts ?? 0);
        if (attempt >= MAX_CHARGE_ATTEMPTS) continue;
        const ownerId = String(r.teacher_id);
        items.push({
          key: `teacher:${String(r.id)}`,
          customerType: 'teacher',
          owner: { ownerType: 'teacher', ownerId },
          amount: Number(r.price_gross ?? 0),
          invoiceId: null,
          periodKey: todayCairo.slice(0, 7),
          billingDayCairo: todayCairo,
          hasSavedCard: teacherCarded.has(ownerId),
          attemptIndex: attempt,
        });
      }

      return items;
    },

    async applyCharged(item, result) {
      if (!result.ok) return; // only called for a successful charge
      if (item.customerType === 'center' && item.invoiceId && result.paymobOrderId) {
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
        await advanceTeacher(supabase, item.owner.ownerId, today);
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
      if (item.customerType === 'center' && item.invoiceId && result.paymobOrderId) {
        await finalizeInvoicePaymentSuccess(supabase, result.paymobOrderId, result.transactionId ?? '');
      } else if (item.customerType === 'teacher') {
        const { data } = await supabase
          .from('teacher_subscriptions')
          .select('next_billing_at')
          .eq('teacher_id', item.owner.ownerId)
          .maybeSingle();
        const nb = (data as Row | null)?.next_billing_at;
        const alreadyAdvanced = nb && cairoDateKey(new Date(String(nb))) > today;
        if (!alreadyAdvanced) await advanceTeacher(supabase, item.owner.ownerId, today);
      }
    },

    async applyManualUnpaid(item, reason: ManualReason) {
      if (item.customerType === 'center' && item.invoiceId) {
        await ensureCenterInvoicePayLink(supabase, item.invoiceId);
        await supabase
          .from('centers')
          .update({ auto_suspend_at: autoSuspendAtFromDue(item.billingDayCairo) })
          .eq('id', item.owner.ownerId)
          .neq('billing_status', 'paid');
      } else if (item.customerType === 'teacher') {
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
      if (item.customerType === 'center' && item.invoiceId) {
        await supabase
          .from('invoices')
          .update({
            status: 'failed',
            retry_count: attempt,
            last_retry_at: new Date().toISOString(),
            next_retry_at: nextRetryYmd,
          })
          .eq('id', item.invoiceId);
        await supabase
          .from('centers')
          .update({ auto_suspend_at: deferLock })
          .eq('id', item.owner.ownerId)
          .neq('billing_status', 'paid');
      } else if (item.customerType === 'teacher') {
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
      if (item.customerType === 'center' && item.invoiceId) {
        await ensureCenterInvoicePayLink(supabase, item.invoiceId);
        await supabase
          .from('centers')
          .update({ auto_suspend_at: lockTomorrow })
          .eq('id', item.owner.ownerId)
          .neq('billing_status', 'paid');
      } else if (item.customerType === 'teacher') {
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
  };
}
