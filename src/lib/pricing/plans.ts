/**
 * Public pricing UI — single import surface (wraps `src/lib/pricing.ts` PLANS).
 */
export {
  PLANS,
  ORDERED_SUBSCRIPTION_PLAN_KEYS,
  type PlanKey,
  type BillingPeriod,
  type PlanConfig,
  getSignupDisplayMonthlyPrice,
  getAnnualMonthlyEquivalent,
  getPlanPrice,
  normalizeBillingPeriod,
} from '@/lib/pricing';
