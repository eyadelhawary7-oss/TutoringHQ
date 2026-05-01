// src/lib/pricing.ts
// Single source of truth for CenterHQ subscription pricing.
// `quarterlyAllIn` matches pricing_plans.all_in_price: EGP/month when billed quarterly (×3 = one quarter invoice).

import { formatNumber } from '@/lib/formatNumber';

/** Fixed tiers (excludes `top_centers`), lowest → highest for UI and ranking. */
export const ORDERED_SUBSCRIPTION_PLAN_KEYS = [
  'solo',
  'nano',
  'starter',
  'pro',
  'business',
  'enterprise',
] as const;
export type SubscriptionPlanKey = (typeof ORDERED_SUBSCRIPTION_PLAN_KEYS)[number];

export type PlanKey = SubscriptionPlanKey | 'top_centers';
export type BillingPeriod = 'monthly' | 'quarterly' | 'annual';

/** DB/UI legacy → canonical billing period */
export function normalizeBillingPeriod(raw: string | null | undefined): BillingPeriod {
  const p = String(raw || 'quarterly').toLowerCase();
  if (p === 'yearly' || p === 'annual') return 'annual';
  if (p === 'half_yearly' || p === 'biannual' || p === 'semi_annual') return 'quarterly';
  if (p === 'monthly' || p === 'quarterly') return p;
  return 'quarterly';
}

export interface PlanConfig {
  key: PlanKey;
  arabicName: string;
  englishName: string;
  /** Max students/week for this tier (top_centers = custom / unlimited). */
  weeklyStudentLimit: number | null;
  /** Same as DB all_in_price — monthly rate on quarterly billing. */
  quarterlyAllIn: number;
  /** Listed price if customer pays monthly (+15% tier; nano uses exact list). */
  monthlyListPrice: number;
  isMegaCenter?: boolean;
}

export const PLANS: Record<PlanKey, PlanConfig> = {
  solo: {
    key: 'solo',
    arabicName: 'فردي',
    englishName: 'Solo',
    weeklyStudentLimit: 50,
    quarterlyAllIn: 999,
    monthlyListPrice: 1149,
  },
  nano: {
    key: 'nano',
    arabicName: 'سنتر نانو',
    englishName: 'Nano',
    weeklyStudentLimit: 75,
    quarterlyAllIn: 1999,
    monthlyListPrice: 2499,
  },
  starter: {
    key: 'starter',
    arabicName: 'أساسي',
    englishName: 'Starter',
    weeklyStudentLimit: 150,
    quarterlyAllIn: 4499,
    monthlyListPrice: 5199,
  },
  pro: {
    key: 'pro',
    arabicName: 'محترف',
    englishName: 'Pro',
    weeklyStudentLimit: 500,
    quarterlyAllIn: 7999,
    monthlyListPrice: 9199,
  },
  business: {
    key: 'business',
    arabicName: 'أعمال',
    englishName: 'Business',
    weeklyStudentLimit: 1000,
    quarterlyAllIn: 12999,
    monthlyListPrice: 14999,
  },
  enterprise: {
    key: 'enterprise',
    arabicName: 'مؤسسات',
    englishName: 'Enterprise',
    weeklyStudentLimit: 2000,
    quarterlyAllIn: 18499,
    monthlyListPrice: 21299,
    isMegaCenter: true,
  },
  top_centers: {
    key: 'top_centers',
    arabicName: 'كبار السناتر',
    englishName: 'Top Centers',
    weeklyStudentLimit: null,
    quarterlyAllIn: 0,
    monthlyListPrice: 0,
    isMegaCenter: true,
  },
};

export function isPlanKey(id: string | null | undefined): id is PlanKey {
  return id != null && Object.prototype.hasOwnProperty.call(PLANS, id);
}

/** Full annual charge from quarterly monthly equivalent (−15% vs 12× quarter months): round to nearest 100 EGP then −1 (99-ending). */
export function getAnnualChargeRounded(allInPerMonth: number): number {
  if (!Number.isFinite(allInPerMonth) || allInPerMonth <= 0) return 0;
  return Math.round((allInPerMonth * 10.2) / 100) * 100 - 1;
}

const WEEKS_PER_QUARTER = 13;

/**
 * One billing-cycle charge from all_in_price (monthly rate on quarterly plan) and period.
 * @param allInPerMonth — centers.all_in_price or PLANS[].quarterlyAllIn
 * @param planKey — required for correct monthly list price when scaling custom all_in
 */
export function getChargeFromQuarterlyAllIn(
  allInPerMonth: number,
  period: BillingPeriod,
  planKey?: PlanKey,
): number {
  if (allInPerMonth <= 0) return 0;
  const p = normalizeBillingPeriod(period);
  const pk =
    planKey && isPlanKey(planKey) && planKey !== 'top_centers' ? planKey : null;
  const def = pk ? PLANS[pk] : null;
  const defaultAllIn = def?.quarterlyAllIn ?? allInPerMonth;
  const scale = defaultAllIn > 0 ? allInPerMonth / defaultAllIn : 1;

  switch (p) {
    case 'quarterly':
      return allInPerMonth * 3;
    case 'monthly': {
      const list = def?.monthlyListPrice ?? allInPerMonth * 1.15;
      return Math.max(1, list * scale);
    }
    case 'annual':
      return getAnnualChargeRounded(allInPerMonth);
    default:
      return allInPerMonth * 3;
  }
}

/** MRR-style monthly equivalent for dashboards. */
export function getImpliedMonthlyMrr(
  allInPerMonth: number,
  period: BillingPeriod,
  planKey?: PlanKey,
): number {
  if (allInPerMonth <= 0) return 0;
  const p = normalizeBillingPeriod(period);
  if (p === 'quarterly') return allInPerMonth;
  if (p === 'monthly') {
    return getChargeFromQuarterlyAllIn(allInPerMonth, 'monthly', planKey);
  }
  return getAnnualChargeRounded(allInPerMonth) / 12;
}

/**
 * Signup UI headline: EGP/month figure (quarterly = all-in monthly equivalent, not ×3).
 */
export function getSignupDisplayMonthlyPrice(planKey: PlanKey, period: BillingPeriod): number {
  const plan = PLANS[planKey];
  if (!plan || planKey === 'top_centers') return 0;
  const p = normalizeBillingPeriod(period);
  if (p === 'quarterly') return plan.quarterlyAllIn;
  if (p === 'monthly') return plan.monthlyListPrice;
  return getAnnualMonthlyEquivalent(planKey);
}

/** Display price for plan picker / landing (full cycle amount for the selected period). */
export function getPlanPrice(planKey: PlanKey, period: BillingPeriod): number {
  const plan = PLANS[planKey];
  if (!plan || planKey === 'top_centers') return 0;
  const p = normalizeBillingPeriod(period);
  switch (p) {
    case 'quarterly':
      return plan.quarterlyAllIn * 3;
    case 'monthly':
      return plan.monthlyListPrice;
    case 'annual':
      return getAnnualChargeRounded(plan.quarterlyAllIn);
    default:
      return plan.quarterlyAllIn * 3;
  }
}

/** Per-month figure when customer pays annual (−15% on year vs 12× quarterly-monthly). */
export function getAnnualMonthlyEquivalent(planKey: PlanKey): number {
  const plan = PLANS[planKey];
  if (!plan || planKey === 'top_centers') return 0;
  return getAnnualChargeRounded(plan.quarterlyAllIn) / 12;
}

export function getQuarterlyCharge(planKey: PlanKey, period: BillingPeriod): number {
  const plan = PLANS[planKey];
  if (!plan || planKey === 'top_centers') return 0;
  return getChargeFromQuarterlyAllIn(plan.quarterlyAllIn, period, planKey);
}

/**
 * Per-student weekly cost at capacity: one quarter’s revenue ÷ (capacity × 13 weeks).
 */
export function getPerStudentWeeklyCost(planKey: PlanKey): number | null {
  const plan = PLANS[planKey];
  if (!plan || !plan.weeklyStudentLimit) return null;
  const quarterTotal = plan.quarterlyAllIn * 3;
  const raw = quarterTotal / (plan.weeklyStudentLimit * WEEKS_PER_QUARTER);
  return Math.round(raw * 100) / 100;
}

export function formatPrice(amount: number, locale?: string): string {
  return formatNumber(amount, locale ?? 'en');
}
