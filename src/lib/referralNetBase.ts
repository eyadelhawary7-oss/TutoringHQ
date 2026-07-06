/**
 * Referral commission base: net CenterHQ revenue from the all-in monthly price.
 *
 * The divisor strips VAT (14%) — the only real pass-through tax — from
 * `all_in_price`. The former 6% service slice is now retained margin and is
 * INCLUDED in the commissionable base (referrers earn on it). A residual 0.4%
 * factor (1.004) is kept so payouts on the stamp portion stay unchanged from the
 * pre-removal figure; it is a fixed margin factor, not a customer-facing tax.
 */
export const REFERRAL_NET_REVENUE_DIVISOR = 1.14 * 1.004;

export function netReferralBaseFromAllInPrice(allInPrice: number): number {
  if (!Number.isFinite(allInPrice) || allInPrice <= 0) return 0;
  return Math.round((allInPrice / REFERRAL_NET_REVENUE_DIVISOR) * 100) / 100;
}
