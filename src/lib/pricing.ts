// src/lib/pricing.ts
// Single source of truth for CenterHQ subscription pricing.
// `quarterlyAllIn` matches pricing_plans.all_in_price: EGP/month when billed quarterly (×3 = one quarter invoice).

export type PlanKey = 'nano' | 'starter' | 'pro' | 'business' | 'enterprise' | 'top_centers';
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
  nano: {
    key: 'nano',
    arabicName: 'ناشئ',
    englishName: 'Nano',
    weeklyStudentLimit: 100,
    quarterlyAllIn: 2000,
    monthlyListPrice: 2500,
  },
  starter: {
    key: 'starter',
    arabicName: 'أساسي',
    englishName: 'Starter',
    weeklyStudentLimit: 250,
    quarterlyAllIn: 4500,
    monthlyListPrice: 5200,
  },
  pro: {
    key: 'pro',
    arabicName: 'محترف',
    englishName: 'Pro',
    weeklyStudentLimit: 500,
    quarterlyAllIn: 8000,
    monthlyListPrice: 9200,
  },
  business: {
    key: 'business',
    arabicName: 'أعمال',
    englishName: 'Business',
    weeklyStudentLimit: 1000,
    quarterlyAllIn: 13000,
    monthlyListPrice: 15000,
  },
  enterprise: {
    key: 'enterprise',
    arabicName: 'مؤسسات',
    englishName: 'Enterprise',
    weeklyStudentLimit: 2000,
    quarterlyAllIn: 18500,
    monthlyListPrice: 21300,
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
      return Math.round(allInPerMonth * 3);
    case 'monthly': {
      const list = def?.monthlyListPrice ?? Math.round(allInPerMonth * 1.15);
      return Math.max(1, Math.round(list * scale));
    }
    case 'annual':
      return Math.round(allInPerMonth * 12 * 0.85);
    default:
      return Math.round(allInPerMonth * 3);
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
  if (p === 'quarterly') return Math.round(allInPerMonth);
  if (p === 'monthly') {
    return getChargeFromQuarterlyAllIn(allInPerMonth, 'monthly', planKey);
  }
  return Math.round(allInPerMonth * 0.85);
}

/** Display price for plan picker / landing (full cycle amount for the selected period). */
export function getPlanPrice(planKey: PlanKey, period: BillingPeriod): number {
  const plan = PLANS[planKey];
  if (!plan || planKey === 'top_centers') return 0;
  const p = normalizeBillingPeriod(period);
  switch (p) {
    case 'quarterly':
      return Math.round(plan.quarterlyAllIn * 3);
    case 'monthly':
      return plan.monthlyListPrice;
    case 'annual':
      return Math.round(plan.quarterlyAllIn * 12 * 0.85);
    default:
      return Math.round(plan.quarterlyAllIn * 3);
  }
}

/** Per-month figure when customer pays annual (−15% on year vs 12× quarterly-monthly). */
export function getAnnualMonthlyEquivalent(planKey: PlanKey): number {
  const plan = PLANS[planKey];
  if (!plan || planKey === 'top_centers') return 0;
  return Math.round(plan.quarterlyAllIn * 0.85);
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
  return amount.toLocaleString(locale ?? 'en-US');
}
