// Center recurring-renewal period math (the center equivalent of the teacher
// engine's `teacherCyclePeriodDays` + annual-charge seam in `teacherBilling.ts`).
//
// Centers store their cadence on `centers.billing_period` ('monthly' | 'quarterly'
// | 'annual') and their per-month base on `centers.all_in_price`. `billing_amount`
// is the QUARTERLY figure (monthly × 3) written at signup — correct for the legacy
// quarterly clock but NOT for an annual center, whose renewal must bill
// monthly × annualMultiplier (=10, "true 2 months free") over a 12-month period.
//
// These two pure helpers centralise that decision so the recurring cron and the
// paid-invoice handler stay in lock-step. Only the ANNUAL branch is new: the
// monthly/quarterly path returns exactly what those call sites used before (the
// stored quarterly amount over a 3-month clock), so non-annual billing is
// byte-identical.

import {
  getAnnualChargeRounded,
  ANNUAL_BILLED_MONTHS_DEFAULT,
  normalizeBillingPeriod,
} from '@/lib/pricing';

/**
 * Calendar months in one center billing cycle: 12 for annual, 3 otherwise.
 * Non-annual intentionally stays quarterly (the legacy clock) — see module note.
 */
export function centerRenewalPeriodMonths(billingPeriod: string | null | undefined): number {
  return normalizeBillingPeriod(billingPeriod) === 'annual' ? 12 : 3;
}

/**
 * Base (pre-processing-fee) amount to charge on a center's recurring renewal.
 *
 *  - annual → monthly all-in × annualMultiplier (=10), mirroring the teacher
 *    engine (`getAnnualChargeRounded`). Uses `all_in_price`, the reliable
 *    per-month base, NOT the stored quarterly `billing_amount`.
 *  - monthly / quarterly → UNCHANGED: the stored `billing_amount` (quarterly
 *    figure) exactly as the cron/paid handler used it before.
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
