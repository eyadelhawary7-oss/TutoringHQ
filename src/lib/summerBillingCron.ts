// src/lib/summerBillingCron.ts
//
// The daily summer engine — the server runner behind /api/cron/summer-billing.
// It is a strict NO-OP unless the master switch (summer.promo.enabled) is on, so
// shipping it is safe-by-default: with summer mode OFF nothing here touches a row
// and normal billing proceeds exactly as today.
//
// Two automatic passes, both driven by the pure decision engine (summer/engine):
//
//   1. Enrollment (on/after SUMMER_FREE_UNTIL, money-free, ALWAYS runs when ON):
//      pulls every signed-up center & teacher from the free-for-all into their
//      14-day trial — stamps summer_trial_start / first_invoice_at / lock_at, and
//      NEUTRALISES the normal billing schedule (centers: next_payment_due +
//      auto_suspend_at → NULL; teachers: next_billing_at → NULL) so the existing
//      billing crons leave summer customers alone until they roll back to normal.
//
//   2. First invoice (on/after each customer's first_invoice_at — ONLY when the
//      first-charge hold is RELEASED): issues the first invoice and hands the
//      pay-window → lock sequence to the EXISTING single-day lock model
//      (centers: next_payment_due = last payable day, auto_suspend_at = lock_at →
//      the existing auto-suspend + /pay + nudges take over; teachers: a teacher
//      invoice via ensureTeacherSubscriptionInvoice + a best-effort status lock at
//      the lock day). When the first invoice is paid, the customer rolls into the
//      normal paid monthly subscription (summer_status → 'paid').
//
// While the hold is HELD (the default), pass 2 issues nothing: everyone stays
// enrolled, free and active. The operator flips the hold to RELEASED once, after a
// real live test payment.

import type { SupabaseClient } from '@supabase/supabase-js';
import { cairoDateKey, cairoYmdPlusDays, startOfUtcInstantForCairoCalendarDay } from '@/lib/cairo/day';
import { getSummerConfig, firstChargeAllowed, type SummerConfig } from '@/lib/summer/config';
import { decideSummerAction, type SummerCustomerState, type SummerCustomerStatus } from '@/lib/summer/engine';
import { getProcessingFeeConfig } from '@/lib/pricingConfig';
import { applyProcessingFee } from '@/lib/processingFee';
import { PLANS, isPlanKey, type PlanKey } from '@/lib/pricing';
import { TEACHER_PLANS, getTeacherPlan } from '@/lib/teacherPlans';
import { ensureTeacherSubscriptionInvoice } from '@/lib/teacherBilling';
import { dropTeacherToFreeBaseline } from '@/lib/teacherFreeBaseline';
import { logBillingEvent } from '@/lib/billingAudit';

type Row = Record<string, unknown>;

export interface SummerBillingResult {
  skipped?: string;
  centersEnrolled: number;
  centersInvoiced: number;
  centersRolled: number;
  teachersEnrolled: number;
  teachersInvoiced: number;
  teachersLocked: number;
  teachersRolled: number;
  errors: number;
}

const EMPTY: SummerBillingResult = {
  centersEnrolled: 0,
  centersInvoiced: 0,
  centersRolled: 0,
  teachersEnrolled: 0,
  teachersInvoiced: 0,
  teachersLocked: 0,
  teachersRolled: 0,
  errors: 0,
};

function normStatus(v: unknown): SummerCustomerStatus {
  if (v === 'enrolled' || v === 'invoiced' || v === 'paid') return v;
  return 'none';
}

/** Last Cairo day the invoice is still payable: first_invoice_at + (payWindow − 1). */
function lastPayableDay(firstInvoiceAt: string, cfg: SummerConfig): string {
  return cairoYmdPlusDays(firstInvoiceAt, Math.max(0, cfg.payWindowDays - 1));
}

/** Is the given invoice id settled? */
async function invoiceIsPaid(supabase: SupabaseClient, invoiceId: string | null | undefined): Promise<boolean> {
  if (!invoiceId) return false;
  const { data } = await supabase.from('invoices').select('status').eq('id', invoiceId).maybeSingle();
  return (data as Row | null)?.status === 'paid';
}

export async function runSummerBillingCron(supabase: SupabaseClient): Promise<SummerBillingResult> {
  const cfg = await getSummerConfig();
  // Master kill switch: when OFF, the whole summer system is inert.
  if (!cfg.enabled) return { ...EMPTY, skipped: 'summer_off' };

  const today = cairoDateKey(new Date());
  const released = firstChargeAllowed(cfg);
  const feeCfg = await getProcessingFeeConfig();
  const out: SummerBillingResult = { ...EMPTY };

  await runCenters(supabase, cfg, today, released, feeCfg.amount, feeCfg.enabled, out);
  await runTeachers(supabase, cfg, today, released, feeCfg.amount, feeCfg.enabled, out);

  return out;
}

// ── Centers ─────────────────────────────────────────────────────────────────
async function runCenters(
  supabase: SupabaseClient,
  cfg: SummerConfig,
  today: string,
  released: boolean,
  feeAmount: number,
  feeEnabled: boolean,
  out: SummerBillingResult,
): Promise<void> {
  // Eligible: real (non-test), non-blacklisted, not cancelled/rejected/deleted.
  const { data, error } = await supabase
    .from('centers')
    .select(
      'id, name, created_at, status, plan, billing_amount, center_code, referral_code, ' +
        'summer_status, summer_first_invoice_at, summer_lock_at, summer_first_invoice_id',
    )
    .not('status', 'in', '(cancelled,rejected,deleted)')
    .or('is_test.is.null,is_test.eq.false')
    .or('is_blacklisted.is.null,is_blacklisted.eq.false');
  if (error) {
    console.error('[summerBillingCron] centers select', error);
    out.errors += 1;
    return;
  }

  for (const raw of (data ?? []) as unknown as Row[]) {
    try {
      const id = String(raw.id);
      const signup = raw.created_at ? cairoDateKey(new Date(String(raw.created_at))) : today;
      const state: SummerCustomerState = {
        summerStatus: normStatus(raw.summer_status),
        signupDateCairo: signup,
        firstInvoiceAt: (raw.summer_first_invoice_at as string | null) ?? null,
        lockDay: raw.summer_lock_at ? cairoDateKey(new Date(String(raw.summer_lock_at))) : null,
        firstInvoicePaid: await maybePaid(supabase, state_invoiceId(raw)),
      };
      const action = decideSummerAction(state, { cfg, todayCairo: today, firstChargeReleased: released });

      if (action.kind === 'enroll') {
        const s = action.schedule;
        const { error: upErr } = await supabase
          .from('centers')
          .update({
            summer_trial_start: s.trialStart,
            summer_first_invoice_at: s.firstInvoiceAt,
            summer_lock_at: s.lockAtIso,
            summer_enrolled_at: new Date().toISOString(),
            summer_status: 'enrolled',
            // Neutralise the normal billing schedule so the standard crons skip them.
            next_payment_due: null,
            auto_suspend_at: null,
            billing_status: 'active',
          })
          .eq('id', id)
          .is('summer_status', null);
        if (upErr) throw upErr;
        out.centersEnrolled += 1;
      } else if (action.kind === 'issue_invoice') {
        const firstInvoiceAt = String(raw.summer_first_invoice_at);
        const base = centerBase(raw);
        const { fee, total } = applyProcessingFee(base, { enabled: feeEnabled, amount: feeAmount });
        const code = (String(raw.center_code || raw.referral_code || '').trim() || 'UNK').replace(/\s+/g, '');
        const invoiceNumber = `SINV-${code}-${firstInvoiceAt}`;
        const billingEnd = cairoYmdPlusDays(firstInvoiceAt, 30);

        // Idempotent: unique invoice_number means a same-day re-run reuses the row.
        const { data: existing } = await supabase
          .from('invoices')
          .select('id')
          .eq('invoice_number', invoiceNumber)
          .maybeSingle();
        let invoiceId = (existing as Row | null)?.id as string | undefined;
        if (!invoiceId) {
          const { data: ins, error: invErr } = await supabase
            .from('invoices')
            .insert({
              center_id: id,
              invoice_number: invoiceNumber,
              invoice_type: 'subscription',
              status: 'pending',
              total_amount: total,
              base_amount: base,
              billing_period_start: firstInvoiceAt,
              billing_period_end: billingEnd,
              due_date: firstInvoiceAt,
              metadata: { processing_fee: fee, summer_first_invoice: true },
            })
            .select('id')
            .single();
          if (invErr) throw invErr;
          invoiceId = String((ins as Row).id);
          await logBillingEvent(supabase, 'invoice_created', { ownerType: 'center', ownerId: id }, {
            invoiceNumber,
            invoiceType: 'subscription',
            total,
            dueDate: firstInvoiceAt,
            summer: true,
          });
        }

        // Hand the pay-window → lock to the existing single-day lock model:
        // next_payment_due = last payable day → existing auto-suspend locks at lock_at.
        await supabase
          .from('centers')
          .update({
            summer_status: 'invoiced',
            summer_first_invoice_id: invoiceId,
            next_payment_due: lastPayableDay(firstInvoiceAt, cfg),
            auto_suspend_at: String(raw.summer_lock_at),
            billing_status: 'due_soon',
          })
          .eq('id', id);
        out.centersInvoiced += 1;
      } else if (action.kind === 'mark_paid') {
        // First invoice settled → finalize RPC already reactivated + set next billing.
        // Just record that summer onboarding is complete; normal subscription owns them now.
        await supabase.from('centers').update({ summer_status: 'paid' }).eq('id', id);
        out.centersRolled += 1;
      }
      // 'lock' for centers is delegated to the existing auto-suspend (auto_suspend_at).
    } catch (e) {
      console.error('[summerBillingCron] center failed', raw.id, e);
      out.errors += 1;
    }
  }
}

function state_invoiceId(raw: Row): string | null {
  return (raw.summer_first_invoice_id as string | null) ?? null;
}
async function maybePaid(supabase: SupabaseClient, invoiceId: string | null): Promise<boolean> {
  return invoiceIsPaid(supabase, invoiceId);
}

function centerBase(raw: Row): number {
  const ba = Number(raw.billing_amount ?? 0);
  if (Number.isFinite(ba) && ba > 0) return ba;
  const planKey = String(raw.plan || 'starter').toLowerCase();
  const pk: PlanKey = isPlanKey(planKey) && planKey !== 'top_centers' ? (planKey as PlanKey) : 'starter';
  return PLANS[pk].monthlyListPrice;
}

// ── Teachers ────────────────────────────────────────────────────────────────
async function runTeachers(
  supabase: SupabaseClient,
  cfg: SummerConfig,
  today: string,
  released: boolean,
  feeAmount: number,
  feeEnabled: boolean,
  out: SummerBillingResult,
): Promise<void> {
  const { data, error } = await supabase
    .from('teacher_subscriptions')
    .select(
      'id, teacher_id, created_at, status, plan_key, price_gross, ' +
        'summer_status, summer_first_invoice_at, summer_lock_at, summer_first_invoice_id',
    )
    .in('status', ['trialing', 'active', 'past_due']);
  if (error) {
    console.error('[summerBillingCron] teachers select', error);
    out.errors += 1;
    return;
  }

  for (const raw of (data ?? []) as unknown as Row[]) {
    try {
      const subId = String(raw.id);
      const teacherId = String(raw.teacher_id);
      const signup = raw.created_at ? cairoDateKey(new Date(String(raw.created_at))) : today;
      const state: SummerCustomerState = {
        summerStatus: normStatus(raw.summer_status),
        signupDateCairo: signup,
        firstInvoiceAt: (raw.summer_first_invoice_at as string | null) ?? null,
        lockDay: raw.summer_lock_at ? cairoDateKey(new Date(String(raw.summer_lock_at))) : null,
        firstInvoicePaid: await invoiceIsPaid(supabase, (raw.summer_first_invoice_id as string | null) ?? null),
      };
      const action = decideSummerAction(state, { cfg, todayCairo: today, firstChargeReleased: released });

      if (action.kind === 'enroll') {
        const s = action.schedule;
        const { error: upErr } = await supabase
          .from('teacher_subscriptions')
          .update({
            summer_trial_start: s.trialStart,
            summer_first_invoice_at: s.firstInvoiceAt,
            summer_lock_at: s.lockAtIso,
            summer_enrolled_at: new Date().toISOString(),
            summer_status: 'enrolled',
            // Show the trial end in the teacher banner; keep the existing billing
            // engine out by clearing next_billing_at (summer owns the schedule).
            trial_ends_at: startOfUtcInstantForCairoCalendarDay(s.rawTrialEnd).toISOString(),
            next_billing_at: null,
          })
          .eq('id', subId)
          .is('summer_status', null);
        if (upErr) throw upErr;
        out.teachersEnrolled += 1;
      } else if (action.kind === 'issue_invoice') {
        const firstInvoiceAt = String(raw.summer_first_invoice_at);
        const priceGross = teacherPrice(raw);
        const fee = feeEnabled ? feeAmount : 0;
        const ensured = await ensureTeacherSubscriptionInvoice(supabase, {
          teacherId,
          billingDayCairo: firstInvoiceAt,
          priceGross,
          fee,
        });
        if (ensured) {
          await supabase
            .from('teacher_subscriptions')
            .update({ summer_status: 'invoiced', summer_first_invoice_id: ensured.invoiceId })
            .eq('id', subId);
          out.teachersInvoiced += 1;
        }
      } else if (action.kind === 'lock') {
        // Drop the non-paying teacher to the FREE BASELINE (reliable + idempotent):
        // they keep center monitoring + center cut and lose the private engine until
        // they pay. The unpaid invoice + pay link already exist for them to return.
        const dropped = await dropTeacherToFreeBaseline(supabase, subId, null);
        if (dropped.ok) out.teachersLocked += 1;
      } else if (action.kind === 'mark_paid') {
        await supabase.from('teacher_subscriptions').update({ summer_status: 'paid' }).eq('id', subId);
        out.teachersRolled += 1;
      }
    } catch (e) {
      console.error('[summerBillingCron] teacher failed', raw.id, e);
      out.errors += 1;
    }
  }
}

function teacherPrice(raw: Row): number {
  const pg = Number(raw.price_gross ?? 0);
  if (Number.isFinite(pg) && pg > 0) return pg;
  return getTeacherPlan(String(raw.plan_key || '')).priceGross || TEACHER_PLANS.teacher_standard.priceGross;
}
