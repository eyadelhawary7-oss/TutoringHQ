// src/lib/pricing.ts
// Single source of truth for CenterHQ subscription pricing.
// `quarterlyAllIn` matches pricing_plans.all_in_price: EGP/month when billed quarterly (×3 = one quarter invoice).

import { formatNumber } from '@/lib/formatNumber';
import { SUBSCRIPTION_PLAN_DEFINITIONS } from '@/lib/pricing/plans';
import { requireTopCentersAllInPrice } from '@/lib/pricing/topCentersPrice';

export { SUBSCRIPTION_PLAN_DEFINITIONS } from '@/lib/pricing/plans';

/** Fixed tiers (excludes `top_centers`), lowest → highest for UI and ranking. */
export type SubscriptionPlanKey = (typeof SUBSCRIPTION_PLAN_DEFINITIONS)[number]['key'];

export const ORDERED_SUBSCRIPTION_PLAN_KEYS = SUBSCRIPTION_PLAN_DEFINITIONS.map(
  (d) => d.key,
) as readonly SubscriptionPlanKey[];

export type PlanKey = SubscriptionPlanKey | 'top_centers';
export type BillingPeriod = 'monthly' | 'quarterly' | 'annual';

/**
 * DB/UI legacy → canonical billing period. Quarterly is retired: the centers
 * CHECKs only allow monthly/annual, so empty/unknown input reads as monthly
 * (the DB default). Explicit legacy quarterly-family values still normalize to
 * 'quarterly' so historical rows (old invoices, audit data) price correctly.
 */
export function normalizeBillingPeriod(raw: string | null | undefined): BillingPeriod {
  const p = String(raw || 'monthly').toLowerCase();
  if (p === 'yearly' || p === 'annual') return 'annual';
  if (p === 'half_yearly' || p === 'biannual' || p === 'semi_annual') return 'quarterly';
  if (p === 'monthly' || p === 'quarterly') return p;
  return 'monthly';
}

export interface PlanConfig {
  key: PlanKey;
  arabicName: string;
  englishName: string;
  /** Max students/week for this tier (top_centers = custom / unlimited). */
  weeklyStudentLimit: number | null;
  /** Same as DB all_in_price - the per-month rate, charged for monthly AND quarterly. */
  quarterlyAllIn: number;
  /** Whole EGP/month equivalent on annual billing (PRICING_SPEC). */
  annualEffectiveMonthly: number;
  /** Marketing badge on public pricing grid only. */
  landingBadge?: 'entry' | 'popular';
  isMegaCenter?: boolean;
}

const PLANS_FROM_DEFS = Object.fromEntries(
  SUBSCRIPTION_PLAN_DEFINITIONS.map((d) => {
    const cfg: PlanConfig = {
      key: d.key,
      arabicName: d.arabicName,
      englishName: d.englishName,
      weeklyStudentLimit: d.weeklyStudentLimit,
      quarterlyAllIn: d.quarterlyAllIn,
      annualEffectiveMonthly: d.annualEffectiveMonthly,
    };
    if ('landingBadge' in d && d.landingBadge) cfg.landingBadge = d.landingBadge;
    if ('isMegaCenter' in d && d.isMegaCenter) cfg.isMegaCenter = true;
    return [d.key, cfg];
  }),
) as Record<SubscriptionPlanKey, PlanConfig>;

export const PLANS: Record<PlanKey, PlanConfig> = {
  ...PLANS_FROM_DEFS,
  top_centers: {
    key: 'top_centers',
    arabicName: 'كبار السناتر',
    englishName: 'Top Centers',
    weeklyStudentLimit: null,
    quarterlyAllIn: 0,
    annualEffectiveMonthly: 0,
    isMegaCenter: true,
  },
};

export function isPlanKey(id: string | null | undefined): id is PlanKey {
  return id != null && Object.prototype.hasOwnProperty.call(PLANS, id);
}

/**
 * Annual billing = "true 2 months free": annual total = monthly all-in × 10
 * (pay for 10 months, get 12). `annualMultiplier` is the admin-editable
 * `pricing.interval.annual_multiplier` value — the number of months charged per
 * year (default 10). Display and charge paths both route through this so the
 * price SHOWN equals the price CHARGED. Per-month figure = annual total ÷ 12.
 */
export const ANNUAL_BILLED_MONTHS_DEFAULT = 10;

export function getAnnualChargeRounded(
  allInPerMonth: number,
  annualMultiplier: number = ANNUAL_BILLED_MONTHS_DEFAULT,
): number {
  if (!Number.isFinite(allInPerMonth) || allInPerMonth <= 0) return 0;
  const mult =
    Number.isFinite(annualMultiplier) && annualMultiplier > 0
      ? annualMultiplier
      : ANNUAL_BILLED_MONTHS_DEFAULT;
  return Math.round(allInPerMonth * mult);
}

/** Whole EGP/month equivalent when billed annually = annual total ÷ 12. */
export function getAnnualMonthlyFromBase(
  allInPerMonth: number,
  annualMultiplier: number = ANNUAL_BILLED_MONTHS_DEFAULT,
): number {
  return Math.round(getAnnualChargeRounded(allInPerMonth, annualMultiplier) / 12);
}

const WEEKS_PER_QUARTER = 13;

/**
 * One billing-cycle charge from all_in_price (per-month rate) and period.
 * Monthly and quarterly bill at the same per-month rate; annual applies the multiplier.
 * @param allInPerMonth - centers.all_in_price or PLANS[].quarterlyAllIn
 * @param planKey - accepted for signature compatibility; no longer affects the amount
 */
export function getChargeFromQuarterlyAllIn(
  allInPerMonth: number,
  period: BillingPeriod,
  planKey?: PlanKey,
  annualMultiplier: number = ANNUAL_BILLED_MONTHS_DEFAULT,
): number {
  if (allInPerMonth <= 0) return 0;
  const p = normalizeBillingPeriod(period);

  switch (p) {
    case 'quarterly':
      return allInPerMonth * 3;
    case 'monthly':
      // Monthly is charged at the same per-month rate as quarterly (all_in_price).
      return Math.max(1, allInPerMonth);
    case 'annual':
      return getAnnualChargeRounded(allInPerMonth, annualMultiplier);
    default:
      return allInPerMonth * 3;
  }
}

/** Fields needed for dashboard MRR from a `centers` row (subset allowed). */
export type ImpliedMrrCenterFields = {
  plan?: string | null;
  all_in_price?: number | null;
  billing_period?: string | null;
  /** Account row status (not billing_status). Excluded when not eligible - see `isCenterEligibleForSubscriptionMrr`. */
  status?: string | null;
  billing_type?: string | null;
  is_early_adopter?: boolean | null;
  early_adopter_price?: number | null;
  id?: string;
  /** Seed / audit / fixture centres - never counted toward subscription MRR (see docs/PRICING_SPEC.md). */
  is_test?: boolean | null;
};

/** Argument for `isCenterEligibleForSubscriptionMrr` when passing a row-shaped input (status + optional flags). */
export type SubscriptionMrrEligibilityInput = {
  status?: string | null;
  is_test?: boolean | null;
};

function isStatusEligibleForSubscriptionMrr(status: string | null | undefined): boolean {
  const s = (status ?? '').toLowerCase();
  return (
    s !== 'suspended' &&
    s !== 'churned' &&
    s !== 'deleted' &&
    s !== 'cancelled' &&
    s !== 'inactive'
  );
}

/**
 * Same exclusions as finance admin `isActive`: these centres do not contribute to subscription MRR.
 * Test centres (`is_test === true`) are excluded before status is considered.
 * Pending/trial centres still count if paying (unless status excludes).
 *
 * Pass a **string** (status only) for legacy call sites where `is_test` is unknown - unknown is treated as non-test.
 * Prefer a **row object** `{ status, is_test }` when available so test centres are excluded.
 */
export function isCenterEligibleForSubscriptionMrr(
  input: string | null | undefined | SubscriptionMrrEligibilityInput,
): boolean {
  if (input != null && typeof input === 'object') {
    if (input.is_test === true) return false;
    return isStatusEligibleForSubscriptionMrr(input.status);
  }
  return isStatusEligibleForSubscriptionMrr(input as string | null | undefined);
}

/** Maps unknown plans to `starter`; known tiers resolve to their PLANS key (`top_centers` maps to `starter` for tier scaling multipliers). */
export function planKeyOrStarter(plan: string | null | undefined): PlanKey {
  const k = String(plan || 'starter').toLowerCase();
  if (k in PLANS && k !== 'top_centers') return k as PlanKey;
  return 'starter';
}

/**
 * `centers.all_in_price` / early-adopter / plan list price as the quarterly-plan **monthly all-in rate**
 * (same semantics as `PLANS[].quarterlyAllIn`). Used before billing-period normalization.
 */
export function getQuarterlyAllInMonthlyRateFromCenter(
  row: Pick<
    ImpliedMrrCenterFields,
    'plan' | 'all_in_price' | 'is_early_adopter' | 'early_adopter_price'
  > & { id?: string },
): number {
  const rawPlan = String(row.plan || 'starter').toLowerCase();
  if (rawPlan === 'top_centers') {
    try {
      return requireTopCentersAllInPrice(row.all_in_price, `mrr:${row.id ?? 'unknown'}`);
    } catch {
      return 0;
    }
  }
  const pk = planKeyOrStarter(row.plan);
  if (row.is_early_adopter && typeof row.early_adopter_price === 'number') {
    return Number(row.early_adopter_price);
  }
  if (row.all_in_price != null && Number(row.all_in_price) > 0) {
    return Number(row.all_in_price);
  }
  return PLANS[pk].quarterlyAllIn;
}

function computeImpliedMonthlyMrrFromBase(
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

function getImpliedMonthlyMrrFromCenterFields(row: ImpliedMrrCenterFields): number {
  if (!isCenterEligibleForSubscriptionMrr(row)) return 0;

  const bp = row.billing_period || 'quarterly';
  const mrrPeriod: BillingPeriod =
    bp === 'semi_annual' || bp === 'half_yearly'
      ? 'quarterly'
      : normalizeBillingPeriod(bp);

  const baseQ = getQuarterlyAllInMonthlyRateFromCenter(row);
  const pk = planKeyOrStarter(row.plan);

  return computeImpliedMonthlyMrrFromBase(baseQ, mrrPeriod, pk);
}

/** MRR-style monthly equivalent for dashboards - numeric base path. */
export function getImpliedMonthlyMrr(
  allInPerMonth: number,
  period: BillingPeriod,
  planKey?: PlanKey,
): number;
/** Canonical path: derive implied MRR from a centre row (billing period, plan tier, inactive exclusions). */
export function getImpliedMonthlyMrr(center: ImpliedMrrCenterFields): number;
export function getImpliedMonthlyMrr(
  a: number | ImpliedMrrCenterFields,
  b?: BillingPeriod,
  c?: PlanKey,
): number {
  if (typeof a === 'object' && a !== null) {
    return getImpliedMonthlyMrrFromCenterFields(a as ImpliedMrrCenterFields);
  }
  return computeImpliedMonthlyMrrFromBase(a as number, b ?? 'quarterly', c);
}

/**
 * Signup UI headline: EGP/month figure (quarterly = all-in monthly equivalent, not ×3).
 */
export function getSignupDisplayMonthlyPrice(
  planKey: PlanKey,
  period: BillingPeriod,
  annualMultiplier: number = ANNUAL_BILLED_MONTHS_DEFAULT,
): number {
  const plan = PLANS[planKey];
  if (!plan || planKey === 'top_centers') return 0;
  const p = normalizeBillingPeriod(period);
  if (p === 'quarterly') return plan.quarterlyAllIn;
  if (p === 'monthly') return plan.quarterlyAllIn;
  return getAnnualMonthlyEquivalent(planKey, annualMultiplier);
}

/** Display price for plan picker / landing (full cycle amount for the selected period). */
export function getPlanPrice(
  planKey: PlanKey,
  period: BillingPeriod,
  annualMultiplier: number = ANNUAL_BILLED_MONTHS_DEFAULT,
): number {
  const plan = PLANS[planKey];
  if (!plan || planKey === 'top_centers') return 0;
  const p = normalizeBillingPeriod(period);
  switch (p) {
    case 'quarterly':
      return plan.quarterlyAllIn * 3;
    case 'monthly':
      return plan.quarterlyAllIn;
    case 'annual':
      return getAnnualChargeRounded(plan.quarterlyAllIn, annualMultiplier);
    default:
      return plan.quarterlyAllIn * 3;
  }
}

/** Per-month inclusive figure when customer pays annual = annual total ÷ 12. */
export function getAnnualMonthlyEquivalent(
  planKey: PlanKey,
  annualMultiplier: number = ANNUAL_BILLED_MONTHS_DEFAULT,
): number {
  const plan = PLANS[planKey];
  if (!plan || planKey === 'top_centers') return 0;
  return getAnnualMonthlyFromBase(plan.quarterlyAllIn, annualMultiplier);
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
