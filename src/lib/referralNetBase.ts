/**
 * Referral commission base: net CenterHQ revenue from the all-in monthly price.
 *
 * The divisor strips only VAT (14%) — the sole customer tax. The former 6%
 * service fee and 0.5% stamp duty no longer exist, so nothing else is stripped;
 * both former slices are commissionable margin (referrers earn on them).
 */
export const REFERRAL_NET_REVENUE_DIVISOR = 1.14;

export function netReferralBaseFromAllInPrice(allInPrice: number): number {
  if (!Number.isFinite(allInPrice) || allInPrice <= 0) return 0;
  return Math.round((allInPrice / REFERRAL_NET_REVENUE_DIVISOR) * 100) / 100;
}
