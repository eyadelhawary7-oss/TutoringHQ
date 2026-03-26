/** @deprecated Import from @/lib/pricing instead */
export type { PlanKey, BillingPeriod, PlanConfig } from './pricing'
export {
  PLANS,
  getPlanPrice,
  getQuarterlyCharge,
  getAnnualMonthlyEquivalent,
  getPerStudentWeeklyCost,
  formatPrice,
  normalizeBillingPeriod,
  getChargeFromQuarterlyAllIn,
  getImpliedMonthlyMrr,
  isPlanKey,
} from './pricing'
