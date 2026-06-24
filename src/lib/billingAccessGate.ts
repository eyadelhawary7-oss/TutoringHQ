/**
 * Phase 2 (2b) — the one place request-time access enforcement decides whether a
 * center is locked, wiring the tested billing rule-engine (resolveBillingAccess)
 * into the proxy. This supersedes the ad-hoc `now >= auto_suspend_at` comparison
 * that previously lived inline in the middleware.
 *
 * Behaviour is equivalent to the old check for the common case (auto_suspend_at is
 * exactly `lockAtFromBillingDay(next_payment_due)`), but now flows through the
 * single-day model so centers and teachers share one definition of "locked".
 */

import { resolveBillingAccess, isLocked } from '@/lib/billingLifecycle';

export interface CenterBillingRow {
  billing_status?: string | null;
  next_payment_due?: string | null;
  auto_suspend_at?: string | null;
}

/** True when the center should be locked to the summary screen right now. */
export function centerIsLockedNow(row: CenterBillingRow, now: Date = new Date()): boolean {
  const paid = row.billing_status === 'paid';
  const billingDay = row.next_payment_due ? row.next_payment_due.slice(0, 10) : null;

  if (billingDay) {
    return isLocked(resolveBillingAccess({ billingDayCairo: billingDay, paid }, now));
  }

  // Legacy fallback when next_payment_due is absent: lock once the stored
  // auto_suspend_at instant has passed and the cycle is unpaid.
  if (!paid && row.auto_suspend_at) {
    return now >= new Date(row.auto_suspend_at);
  }
  return false;
}
