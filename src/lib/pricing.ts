// src/lib/pricing.ts
// Single source of truth for all CenterHQ pricing logic

export type PlanKey = 'nano' | 'starter' | 'pro' | 'business' | 'enterprise' | 'top_centers'
export type BillingPeriod = 'monthly' | 'quarterly' | 'annual'

/** DB/UI legacy → canonical billing period */
export function normalizeBillingPeriod(raw: string | null | undefined): BillingPeriod {
  const p = String(raw || 'quarterly').toLowerCase()
  if (p === 'yearly' || p === 'annual') return 'annual'
  if (p === 'half_yearly' || p === 'biannual' || p === 'semi_annual') return 'quarterly'
  if (p === 'monthly' || p === 'quarterly') return p
  return 'quarterly'
}

export interface PlanConfig {
  key: PlanKey
  arabicName: string
  englishName: string
  weeklyStudentLimit: number | null // null = unlimited (top_centers)
  quarterlyAllIn: number // all-inclusive quarterly price
  isMegaCenter?: boolean // enterprise/top_centers get gold border
}

export const PLANS: Record<PlanKey, PlanConfig> = {
  nano: {
    key: 'nano',
    arabicName: 'ناشئ',
    englishName: 'Nano',
    weeklyStudentLimit: 75,
    quarterlyAllIn: 1500,
  },
  starter: {
    key: 'starter',
    arabicName: 'أساسي',
    englishName: 'Starter',
    weeklyStudentLimit: 150,
    quarterlyAllIn: 3000,
  },
  pro: {
    key: 'pro',
    arabicName: 'محترف',
    englishName: 'Pro',
    weeklyStudentLimit: 500,
    quarterlyAllIn: 5500,
  },
  business: {
    key: 'business',
    arabicName: 'أعمال',
    englishName: 'Business',
    weeklyStudentLimit: 1000,
    quarterlyAllIn: 9000,
  },
  enterprise: {
    key: 'enterprise',
    arabicName: 'مؤسسات',
    englishName: 'Enterprise',
    weeklyStudentLimit: 2000,
    quarterlyAllIn: 12500,
    isMegaCenter: true,
  },
  top_centers: {
    key: 'top_centers',
    arabicName: 'كبار السناتر',
    englishName: 'Top Centers',
    weeklyStudentLimit: null,
    quarterlyAllIn: 0, // custom — contact sales
    isMegaCenter: true,
  },
}

export function isPlanKey(id: string | null | undefined): id is PlanKey {
  return id != null && Object.prototype.hasOwnProperty.call(PLANS, id)
}

function chargePerBillingCycleFromQuarterlyAllIn(quarterlyAllIn: number, period: BillingPeriod): number {
  switch (period) {
    case 'quarterly': return quarterlyAllIn
    case 'monthly':   return Math.round(quarterlyAllIn * 1.15)
    case 'annual':    return Math.round(quarterlyAllIn * 0.85)
    default:          return quarterlyAllIn
  }
}

/** Amount due per billing cycle from a center's all-inclusive quarterly base (e.g. Paymob / invoices). */
export function getChargeFromQuarterlyAllIn(quarterlyAllIn: number, period: BillingPeriod): number {
  if (quarterlyAllIn <= 0) return 0
  return chargePerBillingCycleFromQuarterlyAllIn(quarterlyAllIn, period)
}

/** Normalized monthly revenue estimate from all-inclusive quarterly base (admin / dashboards). */
export function getImpliedMonthlyMrr(quarterlyAllIn: number, period: BillingPeriod): number {
  if (quarterlyAllIn <= 0) return 0
  if (period === 'monthly') return getChargeFromQuarterlyAllIn(quarterlyAllIn, 'monthly')
  if (period === 'quarterly') return Math.round(quarterlyAllIn / 3)
  return Math.round(quarterlyAllIn * 0.85)
}

/** Returns displayed all-inclusive price for a billing period */
export function getPlanPrice(planKey: PlanKey, period: BillingPeriod): number {
  const plan = PLANS[planKey]
  if (!plan || planKey === 'top_centers') return 0
  const base = plan.quarterlyAllIn
  switch (period) {
    case 'quarterly': return base
    case 'monthly':   return Math.round(base * 1.15)
    case 'annual':    return Math.round(base * 12 * 0.85) // annual total
    default:          return base
  }
}

/** Monthly equivalent for display in annual billing */
export function getAnnualMonthlyEquivalent(planKey: PlanKey): number {
  const plan = PLANS[planKey]
  if (!plan || planKey === 'top_centers') return 0
  return Math.round(plan.quarterlyAllIn * 0.85)
}

/** Quarterly charge amount to collect (period = 'annual' still charges quarterly) */
export function getQuarterlyCharge(planKey: PlanKey, period: BillingPeriod): number {
  const plan = PLANS[planKey]
  if (!plan || planKey === 'top_centers') return 0
  return chargePerBillingCycleFromQuarterlyAllIn(plan.quarterlyAllIn, period)
}

/** Average weeks per month (52÷12 ≈ 4.333) — not 52÷4 (weeks per quarter). */
const WEEKS_PER_MONTH = 52 / 12

/**
 * Per-student weekly cost at capacity: quarterly all-in ÷ (capacity × weeks per month).
 */
export function getPerStudentWeeklyCost(planKey: PlanKey): number | null {
  const plan = PLANS[planKey]
  if (!plan || !plan.weeklyStudentLimit) return null
  const raw = plan.quarterlyAllIn / (plan.weeklyStudentLimit * WEEKS_PER_MONTH)
  return Math.round(raw * 100) / 100
}

/** Format price for display — always en-US */
export function formatPrice(amount: number, locale?: string): string {
  return amount.toLocaleString('en-US')
}
