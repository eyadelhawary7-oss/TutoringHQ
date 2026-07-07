/**
 * Referral commission payout fees. Applied in a FIXED order on the gross
 * commission the referrer withdraws:
 *   1. flat processing fee (20 EGP, from platform_config) — deducted first
 *   2. 5% withdrawal fee — on the remainder
 * Net received = (gross − processingFee) × (1 − 0.05).
 * e.g. gross 1020 → −20 = 1000 → −5% (50) = 950 net.
 *
 * This is the single source of truth — the payout route, the receipt PDF, and
 * the withdrawal panel all compute through `computeReferralPayout` so the shown
 * net equals the paid net.
 */

export const REFERRAL_WITHDRAWAL_FEE_RATE = 0.05;

/**
 * Minimum GROSS cash withdrawal (EGP) on the referral payout path (wallet/bank
 * cash-out with the 20 + 5% fees). Checked before fees. Distinct from the separate
 * credits-system minimum (2,000 credits = 1,000 EGP, 2:1). Spending commission
 * balance inside the app on an invoice is NOT a withdrawal and is not gated by this.
 */
export const REFERRAL_WITHDRAWAL_MIN_EGP = 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface ReferralPayoutBreakdown {
  /** Gross commission withdrawn (deducted from the referrer's balance). */
  gross: number;
  /** Flat processing fee (deducted first). */
  processingFee: number;
  /** 5% withdrawal fee on (gross − processingFee). */
  withdrawalFee: number;
  /** Net cash the referrer receives. */
  net: number;
}

/**
 * Compute the payout breakdown. Returns `net: 0` (and zeroed fees) when the gross
 * cannot cover the flat processing fee — callers must reject such requests so a
 * payout never goes to or below zero.
 */
export function computeReferralPayout(
  gross: number,
  processingFee: number,
  feeRate: number = REFERRAL_WITHDRAWAL_FEE_RATE,
): ReferralPayoutBreakdown {
  const g = round2(Number(gross) || 0);
  const pf = round2(Math.max(0, Number(processingFee) || 0));
  const rate = Number.isFinite(feeRate) && feeRate >= 0 ? feeRate : REFERRAL_WITHDRAWAL_FEE_RATE;
  if (g <= pf) {
    return { gross: g, processingFee: 0, withdrawalFee: 0, net: 0 };
  }
  const afterProcessing = round2(g - pf);
  const withdrawalFee = round2(afterProcessing * rate);
  const net = round2(afterProcessing - withdrawalFee);
  return { gross: g, processingFee: pf, withdrawalFee, net };
}
