import { addMonthsToDateStr } from '@/lib/subscriptionAnchor';
import { normalizeBillingPeriod, type BillingPeriod } from '@/lib/pricing';

/** Whole months per billing step from anchor (quarterly = 3). */
export function billingStepMonths(periodRaw: string | null | undefined): number {
  const p = normalizeBillingPeriod(periodRaw);
  if (p === 'monthly') return 1;
  if (p === 'annual') return 12;
  return 3;
}

export function anchorYmdFromCenter(center: {
  subscription_start_date?: string | null;
  billing_cycle_start?: string | null;
  approved_at?: string | null;
  next_payment_due?: string | null;
}): string {
  const a =
    center.subscription_start_date?.slice(0, 10) ||
    center.billing_cycle_start?.slice(0, 10) ||
    (center.approved_at ? center.approved_at.slice(0, 10) : null) ||
    center.next_payment_due?.slice(0, 10);
  return a ?? new Date().toISOString().slice(0, 10);
}

/**
 * Smallest anchor-aligned due date strictly after `afterYmd` (YYYY-MM-DD).
 * Due_k = addMonths(anchor, k * stepMonths); return first due_k > afterYmd.
 */
export function nextAnchorDueStrictlyAfter(
  anchorYmd: string,
  stepMonths: number,
  afterYmd: string,
): string {
  for (let k = 0; k < 480; k++) {
    const cand = addMonthsToDateStr(anchorYmd, k * stepMonths);
    if (cand > afterYmd) return cand;
  }
  return addMonthsToDateStr(afterYmd, stepMonths);
}

export function calendarAddDaysYmd(baseYmd: string, delta: number): string {
  const [y, m, d] = baseYmd.split('-').map((x) => parseInt(x, 10));
  const t = Date.UTC(y, m - 1, d + delta);
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function autoSuspendAtFromDue(nextPaymentDueYmd: string): string {
  const day = calendarAddDaysYmd(nextPaymentDueYmd, 6);
  return `${day}T12:00:00.000Z`;
}
