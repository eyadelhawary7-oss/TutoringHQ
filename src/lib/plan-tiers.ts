/**
 * Single source of truth for plan definitions.
 * Base monthly fee = quarterly rate. Use getEffectiveMonthlyRate for billing period adjustments.
 */

export interface PlanTier {
  id: string;
  nameAr: string;
  nameEn: string;
  monthlyFee: number;
  setupFee: number;
  maxStudentsPerWeek: number;
  isCustom?: boolean;
}

export const PLAN_TIERS: PlanTier[] = [
  {
    id: 'nano',
    nameAr: 'ناشئ',
    nameEn: 'Nano',
    monthlyFee: 1200,
    setupFee: 500,
    maxStudentsPerWeek: 75,
  },
  {
    id: 'starter',
    nameAr: 'سنتر صغير',
    nameEn: 'Starter',
    monthlyFee: 2000,
    setupFee: 1000,
    maxStudentsPerWeek: 150,
  },
  {
    id: 'pro',
    nameAr: 'سنتر متوسط',
    nameEn: 'Pro',
    monthlyFee: 4500,
    setupFee: 2000,
    maxStudentsPerWeek: 500,
  },
  {
    id: 'business',
    nameAr: 'سنتر كبير',
    nameEn: 'Business',
    monthlyFee: 6500,
    setupFee: 3000,
    maxStudentsPerWeek: 1000,
  },
  {
    id: 'enterprise',
    nameAr: 'سنتر ضخم',
    nameEn: 'Enterprise',
    monthlyFee: 9000,
    setupFee: 5000,
    maxStudentsPerWeek: 2000,
  },
  {
    id: 'top_centers',
    nameAr: 'ميجا سنتر',
    nameEn: 'Mega Center',
    monthlyFee: 0,
    setupFee: 0,
    maxStudentsPerWeek: 0,
    isCustom: true,
  },
];

export type BillingPeriod = 'monthly' | 'quarterly' | 'biannual' | 'half_yearly' | 'yearly';

/** Base monthly_fee = quarterly rate. Multipliers for other periods. */
export const BILLING_MULTIPLIERS: Record<string, number> = {
  monthly: 1.075,
  quarterly: 1.0,
  biannual: 0.95,
  half_yearly: 0.95,
  yearly: 0.9,
};

export const BILLING_CYCLES: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  biannual: 6,
  yearly: 12,
};

/** Multipliers: base fee is quarterly rate. Monthly +7.5%, Half-yearly -5%, Yearly -10% */
const PERIOD_MULTIPLIERS: Record<BillingPeriod, number> = BILLING_MULTIPLIERS as Record<BillingPeriod, number>;

export function getEffectiveMonthlyRate(baseMonthlyFee: number, period: BillingPeriod): number {
  const mult = PERIOD_MULTIPLIERS[period] ?? 1;
  return Math.round(baseMonthlyFee * mult);
}

export function getTotalForPeriod(baseMonthlyFee: number, period: BillingPeriod): number {
  const effective = getEffectiveMonthlyRate(baseMonthlyFee, period);
  if (period === 'monthly') return effective;
  if (period === 'quarterly') return baseMonthlyFee * 3;
  if (period === 'biannual' || period === 'half_yearly') return Math.round(baseMonthlyFee * 0.95 * 6);
  if (period === 'yearly') return Math.round(baseMonthlyFee * 0.9 * 12);
  return baseMonthlyFee * 3;
}

export function getPerStudentPerWeek(plan: PlanTier): string {
  if (plan.isCustom || plan.maxStudentsPerWeek <= 0) return '';
  return (plan.monthlyFee / plan.maxStudentsPerWeek / 4.33).toFixed(2);
}
