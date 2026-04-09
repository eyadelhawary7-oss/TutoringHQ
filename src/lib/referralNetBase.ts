/**
 * Referral commission base: net CenterHQ revenue from all-in monthly price.
 * all_in_price includes VAT 14%, service fee 6%, stamp duty 0.4% (pass-through).
 */
export const REFERRAL_NET_REVENUE_DIVISOR = 1.14 * 1.06 * 1.004;

export function netReferralBaseFromAllInPrice(allInPrice: number): number {
  if (!Number.isFinite(allInPrice) || allInPrice <= 0) return 0;
  return Math.round((allInPrice / REFERRAL_NET_REVENUE_DIVISOR) * 100) / 100;
}
