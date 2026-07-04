// Center recurring-renewal period math (the center equivalent of the teacher
// engine's `teacherCyclePeriodDays` + annual-charge seam in `teacherBilling.ts`).
//
// Centers are billed **monthly or annual only** (the quarterly clock is retired
// for all new activity). They store their cadence on `centers.billing_period`
// ('monthly' | 'annual') and their per-month base on `centers.all_in_price`.
// `billing_amount` holds the recurring charge for one cycle: the monthly amount
// for a monthly center. An annual center's renewal must bill monthly ×
// annualMultiplier (=10, "true 2 months free") over a 12-month period, computed
// from `all_in_price` rather than the stored amount.
//
// These two pure helpers centralise that decision so the recurring cron and the
// paid-invoice handler stay in lock-step. The quarterly clock is gone: any
// non-annual center (and any unknown/legacy value) renews on the 1-month cadence.

import {
  getAnnualChargeRounded,
  ANNUAL_BILLED_MONTHS_DEFAULT,
  normalizeBillingPeriod,
} from '@/lib/pricing';

/**
 * Calendar months in one center billing cycle: 12 for annual, 1 for everything
 * else. Monthly is the standard non-annual cadence and the default for any
 * unknown/legacy value — the three-month (quarterly) clock is removed entirely;
 * no path returns 3 anymore. See module note.
 */
export function centerRenewalPeriodMonths(billingPeriod: string | null | undefined): number {
  return normalizeBillingPeriod(billingPeriod) === 'annual' ? 12 : 1;
}

/**
 * Base (pre-processing-fee) amount to charge on a center's recurring renewal.
 *
 *  - annual → monthly all-in × annualMultiplier (=10), mirroring the teacher
 *    engine (`getAnnualChargeRounded`). Uses `all_in_price`, the reliable
 *    per-month base, NOT the stored `billing_amount`.
 *  - monthly (and the retired quarterly fallback) → the stored `billing_amount`
 *    exactly as the cron/paid handler uses it: for a monthly center that is the
 *    monthly charge. Respects custom / early-adopter amounts (never recomputed).
 */
export function centerRenewalBaseAmount(opts: {
  billingPeriod: string | null | undefined;
  allInPerMonth: number | null | undefined;
  storedBillingAmount: number | null | undefined;
  annualMultiplier?: number;
}): number {
  if (normalizeBillingPeriod(opts.billingPeriod) === 'annual') {
    const mult =
      Number.isFinite(opts.annualMultiplier) && (opts.annualMultiplier as number) > 0
        ? (opts.annualMultiplier as number)
        : ANNUAL_BILLED_MONTHS_DEFAULT;
    return getAnnualChargeRounded(Number(opts.allInPerMonth ?? 0), mult);
  }
  return Number(opts.storedBillingAmount ?? 0);
}
