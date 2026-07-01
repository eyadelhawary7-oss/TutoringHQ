// src/lib/teacherBilling.ts
//
// Teacher invoice parity (mirrors the center subscription-invoice flow).
//
// Teachers now get REAL invoice records in the SAME `invoices` table centers use
// (owner_type='teacher', teacher_id set, center_id null — see migration
// 20260625000000). This module owns the two teacher-specific seams:
//
//   1. ensureTeacherSubscriptionInvoice — idempotently create (or reuse) the
//      teacher's open subscription invoice on her billing day. One invoice per
//      billing cycle: a dunning retry reuses the same open invoice, so there is
//      ever only ONE processing fee (the fee lives inside total_amount and is
//      never re-derived) — exactly like centers reuse the same failed invoice on
//      retry.
//
//   2. advanceTeacherSubscriptionPaid — on a paid teacher invoice, advance the
//      subscription one month and restore private-engine access (status active,
//      grace_until cleared). This is the teacher equivalent of the center
//      `handleSubscriptionInvoicePaid` side-effect, invoked from the SAME
//      idempotent finalizer (finalizeInvoicePaymentSuccess).
//
// The processing fee, underpayment math and idempotent finalize all come from the
// shared center machinery — this module only differs where the data model does
// (a teacher has no center row; her access is gated by teacher_subscriptions).

import type { SupabaseClient } from '@supabase/supabase-js';
import { cairoDateKey, cairoYmdPlusDays, startOfUtcInstantForCairoCalendarDay } from '@/lib/cairo/day';
import { round2 } from '@/lib/invoiceBalance';
import { logBillingEvent } from '@/lib/billingAudit';
import { getAnnualChargeRounded, ANNUAL_BILLED_MONTHS_DEFAULT } from '@/lib/pricing';

type Row = Record<string, unknown>;

export type TeacherBillingInterval = 'monthly' | 'annual';

/** Calendar days in one billing cycle: 365 for annual, 30 for monthly. */
export function teacherCyclePeriodDays(interval: TeacherBillingInterval): number {
  return interval === 'annual' ? 365 : 30;
}

/** Statuses that mean "still owed" — an open invoice eligible for reuse on retry. */
const OPEN_STATUSES = ['pending', 'overdue', 'failed'] as const;

export interface EnsuredTeacherInvoice {
  invoiceId: string;
  /** total_amount on the invoice (priceGross + processing fee). */
  total: number;
}

/**
 * Ensure the teacher has an OPEN subscription invoice for the current billing
 * cycle, creating it on the billing day if absent. Idempotent and retry-safe:
 *
 *  - If an open (pending/overdue/failed) teacher invoice already exists, it is
 *    reused as-is — a dunning retry never mints a second invoice or a second
 *    processing fee.
 *  - Otherwise a fresh `subscription` invoice is created (status 'pending',
 *    total = priceGross + fee, fee snapshotted in metadata.processing_fee).
 *
 * Returns null only if there is nothing chargeable (non-positive total) or the
 * insert genuinely failed and no row could be recovered.
 */
export async function ensureTeacherSubscriptionInvoice(
  supabase: SupabaseClient,
  opts: {
    teacherId: string;
    billingDayCairo: string;
    priceGross: number;
    fee: number;
    /** Billing cadence; 'annual' charges priceGross × annualMultiplier over a 12-month period. */
    interval?: TeacherBillingInterval;
    /** Shared pricing.interval.annual_multiplier (=10). Only used when interval='annual'. */
    annualMultiplier?: number;
  },
): Promise<EnsuredTeacherInvoice | null> {
  const { teacherId, billingDayCairo } = opts;
  const interval: TeacherBillingInterval = opts.interval === 'annual' ? 'annual' : 'monthly';
  const annualMultiplier =
    Number.isFinite(opts.annualMultiplier) && (opts.annualMultiplier as number) > 0
      ? (opts.annualMultiplier as number)
      : ANNUAL_BILLED_MONTHS_DEFAULT;

  // Reuse an existing open invoice (covers dunning retries within the same cycle).
  const { data: open } = await supabase
    .from('invoices')
    .select('id, total_amount')
    .eq('owner_type', 'teacher')
    .eq('teacher_id', teacherId)
    .in('status', OPEN_STATUSES as unknown as string[])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const openRow = open as Row | null;
  if (openRow?.id) {
    return { invoiceId: String(openRow.id), total: Number(openRow.total_amount ?? 0) };
  }

  const fee = Math.max(0, round2(Number(opts.fee) || 0));
  const monthlyGross = round2(Number(opts.priceGross) || 0);
  // Annual cycle bills monthly × annualMultiplier (=10) up-front; monthly bills the base.
  const cycleBase =
    interval === 'annual' ? getAnnualChargeRounded(monthlyGross, annualMultiplier) : monthlyGross;
  const total = round2(cycleBase + fee);
  if (!Number.isFinite(total) || total <= 0) return null;

  // Deterministic, globally-unique number keyed to the billing day + teacher, so a
  // same-day cron re-run cannot create a duplicate (unique invoice_number).
  const invoiceNumber = `TINV-${billingDayCairo}-${teacherId}`;
  const periodEnd = cairoYmdPlusDays(billingDayCairo, teacherCyclePeriodDays(interval));

  const { data: ins, error } = await supabase
    .from('invoices')
    .insert({
      owner_type: 'teacher',
      teacher_id: teacherId,
      center_id: null,
      invoice_number: invoiceNumber,
      invoice_type: 'subscription',
      status: 'pending',
      base_amount: cycleBase,
      total_amount: total,
      billing_period_start: billingDayCairo,
      billing_period_end: periodEnd,
      due_date: billingDayCairo,
      metadata: { processing_fee: fee },
    })
    .select('id')
    .single();

  if (error || !(ins as Row | null)?.id) {
    // Unique-violation race (concurrent cron) — recover the row that won.
    const { data: again } = await supabase
      .from('invoices')
      .select('id, total_amount')
      .eq('invoice_number', invoiceNumber)
      .maybeSingle();
    const againRow = again as Row | null;
    if (againRow?.id) {
      return { invoiceId: String(againRow.id), total: Number(againRow.total_amount ?? total) };
    }
    return null;
  }

  const newInvoiceId = String((ins as Row).id);
  await logBillingEvent(supabase, 'invoice_created', { ownerType: 'teacher', ownerId: teacherId }, {
    invoiceId: newInvoiceId,
    invoiceType: 'subscription',
    total,
    billingDayCairo,
  });
  return { invoiceId: newInvoiceId, total };
}

/**
 * Ensure the Scale teacher has an OPEN overage invoice for the current monthly
 * overage tick, creating it if absent. Mirrors ensureTeacherSubscriptionInvoice
 * (reuse-open-then-create, race-safe) but for the `teacher_overage` type:
 *
 *   total = (active students over 100) × 20 + processing fee.
 *
 * The overage cadence is MONTHLY and independent of the base cycle — annual Scale
 * subscribers still get one of these every month. Returns null when there is
 * nothing to bill (≤ 100 active → overage 0), so the caller just advances the tick.
 */
export async function ensureTeacherOverageInvoice(
  supabase: SupabaseClient,
  opts: {
    teacherId: string;
    billingDayCairo: string;
    overageAmount: number;
    fee: number;
    /** Students above the cap (for the invoice line + audit). Optional. */
    overageStudents?: number;
  },
): Promise<EnsuredTeacherInvoice | null> {
  const { teacherId, billingDayCairo } = opts;

  const { data: open } = await supabase
    .from('invoices')
    .select('id, total_amount')
    .eq('owner_type', 'teacher')
    .eq('teacher_id', teacherId)
    .eq('invoice_type', 'teacher_overage')
    .in('status', OPEN_STATUSES as unknown as string[])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const openRow = open as Row | null;
  if (openRow?.id) {
    return { invoiceId: String(openRow.id), total: Number(openRow.total_amount ?? 0) };
  }

  const fee = Math.max(0, round2(Number(opts.fee) || 0));
  const overage = round2(Math.max(0, Number(opts.overageAmount) || 0));
  if (overage <= 0) return null; // nothing over the cap this month
  const total = round2(overage + fee);

  const invoiceNumber = `TOVG-${billingDayCairo}-${teacherId}`;
  const periodEnd = cairoYmdPlusDays(billingDayCairo, 30);

  const { data: ins, error } = await supabase
    .from('invoices')
    .insert({
      owner_type: 'teacher',
      teacher_id: teacherId,
      center_id: null,
      invoice_number: invoiceNumber,
      invoice_type: 'teacher_overage',
      status: 'pending',
      base_amount: overage,
      total_amount: total,
      billing_period_start: billingDayCairo,
      billing_period_end: periodEnd,
      due_date: billingDayCairo,
      metadata: {
        processing_fee: fee,
        overage: true,
        overage_students: Math.max(0, Math.floor(Number(opts.overageStudents ?? 0))),
      },
    })
    .select('id')
    .single();

  if (error || !(ins as Row | null)?.id) {
    const { data: again } = await supabase
      .from('invoices')
      .select('id, total_amount')
      .eq('invoice_number', invoiceNumber)
      .maybeSingle();
    const againRow = again as Row | null;
    if (againRow?.id) {
      return { invoiceId: String(againRow.id), total: Number(againRow.total_amount ?? total) };
    }
    return null;
  }

  const newInvoiceId = String((ins as Row).id);
  await logBillingEvent(supabase, 'invoice_created', { ownerType: 'teacher', ownerId: teacherId }, {
    invoiceId: newInvoiceId,
    invoiceType: 'teacher_overage',
    total,
    billingDayCairo,
  });
  return { invoiceId: newInvoiceId, total };
}

/** Advance only the monthly overage tick (Scale), leaving the base cycle untouched. */
export async function advanceTeacherOverageTick(
  supabase: SupabaseClient,
  teacherId: string,
  fromCairo: string,
): Promise<void> {
  const nextYmd = cairoYmdPlusDays(fromCairo, 30);
  await supabase
    .from('teacher_subscriptions')
    .update({ overage_next_at: startOfUtcInstantForCairoCalendarDay(nextYmd).toISOString() })
    .eq('teacher_id', teacherId);
}

/**
 * Advance a teacher's subscription by one paid month and restore private-engine
 * access. Called from the shared finalizer when a teacher invoice is settled —
 * the teacher equivalent of the center "subscription paid" side-effect.
 *
 * Sets status='active' (so teacher_private_access() passes again), rolls the
 * period +30 Cairo days, stamps last_payment_at, and clears the dunning/lock
 * fields (grace_until, dunning_attempts). Idempotent in practice: re-running with
 * an already-advanced subscription simply re-writes the same active state.
 */
export async function advanceTeacherSubscriptionPaid(
  supabase: SupabaseClient,
  teacherId: string,
  todayCairo: string = cairoDateKey(new Date()),
  interval: TeacherBillingInterval = 'monthly',
): Promise<void> {
  const nextYmd = cairoYmdPlusDays(todayCairo, teacherCyclePeriodDays(interval));
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
