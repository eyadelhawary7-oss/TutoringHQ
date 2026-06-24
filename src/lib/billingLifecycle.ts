// src/lib/billingLifecycle.ts
//
// The "Claude billing model" — a single-day lock, identical for centers AND
// teachers. Replaces the old multi-day grace + 5% late fee + reactivation fee +
// day-30 dormancy machinery.
//
//   1. Billing fires at 00:00 Africa/Cairo on the billing day (calendar date
//      only — never the original signup hour).
//   2. If the charge fails, the customer keeps FULL access for the rest of that
//      same Cairo calendar day (until 23:59:59), with a "payment failed" banner.
//   3. At the next 00:00 Cairo (start of the following day), access LOCKS to the
//      summary screen (headline numbers + pay button) until paid.
//   4. No late fee. No reactivation fee. Paying unlocks immediately at the plain
//      subscription price.
//   5. Manual cancellation keeps FULL access until the end of the current paid
//      cycle (then it lapses — no immediate lock).
//   6. There is no mechanism to move a billing date.
//
// All comparisons are on Cairo calendar dates (YYYY-MM-DD). Africa/Cairo midnight
// instants are computed via the cairo/ helpers (DST-safe), never a fixed offset.

import {
  cairoDateKey,
  cairoYmdPlusDays,
  startOfUtcInstantForCairoCalendarDay,
} from '@/lib/cairo/day';

export type BillingAccess = 'full' | 'failed_today' | 'locked';

export interface BillingLifecycleInput {
  /** Cairo calendar date (YYYY-MM-DD) the charge is/was due to fire (00:00 Cairo). */
  billingDayCairo: string | null;
  /** Did the charge for the current cycle clear? */
  paid: boolean;
  /**
   * Cairo calendar date (YYYY-MM-DD) the most recent charge attempt FAILED, if
   * known. Under the single-day rule this is the billing day; defaults to it.
   */
  chargeFailedDayCairo?: string | null;
  /** Manual cancellation requested — access runs to `cycleEndCairo`, then lapses. */
  cancelPending?: boolean;
  /** Cairo calendar date (YYYY-MM-DD) the current paid cycle ends (inclusive). */
  cycleEndCairo?: string | null;
}

/**
 * Resolve access for the instant `now` under the single-day lock model.
 *  - 'full'         — full app access.
 *  - 'failed_today' — full app access + "pay today or lock at midnight" banner.
 *  - 'locked'       — summary screen only (headline numbers + pay button).
 */
export function resolveBillingAccess(
  input: BillingLifecycleInput,
  now: Date = new Date(),
): BillingAccess {
  const todayCairo = cairoDateKey(now);

  // (5) Manual cancellation: full access through the end of the paid cycle.
  if (input.cancelPending) {
    if (input.cycleEndCairo && todayCairo <= input.cycleEndCairo) return 'full';
    return 'locked';
  }

  // Paid for the current cycle → full access.
  if (input.paid) return 'full';

  // Unpaid. The billing day grants access for the whole Cairo day; the next
  // Cairo midnight locks. A recorded failure date defaults to the billing day.
  const billingDay = input.chargeFailedDayCairo ?? input.billingDayCairo ?? null;
  if (!billingDay) return 'full'; // nothing due yet

  if (todayCairo < billingDay) return 'full'; // before the billing day
  if (todayCairo === billingDay) return 'failed_today'; // (1)(2) same day → banner
  return 'locked'; // (3) next Cairo midnight or later → locked
}

/** Full use of the app (all records), not just the summary screen. */
export function hasFullAccess(access: BillingAccess): boolean {
  return access === 'full' || access === 'failed_today';
}

/** Show the "payment failed — pay today or lose access at midnight" banner. */
export function shouldShowFailedBanner(access: BillingAccess): boolean {
  return access === 'failed_today';
}

/** Locked to the summary screen. */
export function isLocked(access: BillingAccess): boolean {
  return access === 'locked';
}

/**
 * The instant a charge that failed (or went unpaid) on `billingDayCairo` locks the
 * account: 00:00 Africa/Cairo on the FOLLOWING calendar day (DST-safe). Stored in
 * centers.auto_suspend_at and compared against `now` by the proxy / cron.
 */
export function lockAtFromBillingDay(billingDayCairo: string): string {
  return startOfUtcInstantForCairoCalendarDay(
    cairoYmdPlusDays(billingDayCairo, 1),
  ).toISOString();
}

/**
 * The amount to charge to come back from a lock: the PLAIN subscription price —
 * never a late fee or reactivation surcharge (rule 4). The flat processing fee
 * (added by the normal subscription path) is the only add-on and is applied
 * separately at invoice creation, not here.
 */
export function reactivationChargeAmount(plainSubscriptionPrice: number): number {
  const n = Number(plainSubscriptionPrice);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}
