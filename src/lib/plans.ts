/**
 * Plan features, limits, and feature-gating utilities.
 * Plans: nano | starter | pro | business | enterprise | top_centers | payg
 */

export const PLAN_ORDER = ['nano', 'starter', 'pro', 'business', 'enterprise', 'top_centers', 'payg'] as const;
export type PlanId = (typeof PLAN_ORDER)[number];

/** Legacy merged tier; treat like business for limits/ordering. */
export function canonicalPlanId(plan: string | null | undefined): string {
  const p = plan || 'starter';
  if (p === ['pro', '_plus'].join('')) return 'business';
  return p;
}

export const PLAN_STUDENT_LIMITS: Record<string, number> = {
  nano: 100,
  starter: 250,
  pro: 500,
  business: 1000,
  enterprise: 2000,
  top_centers: 999999,
  payg: 999999,
};

export const PLAN_TEAM_LIMITS: Record<string, number> = {
  nano: 2,
  starter: 2,
  pro: 5,
  business: 10,
  enterprise: 20,
  top_centers: 999999,
  payg: 5, // PAYG default
};

/** Plan level for comparison (higher = more features) */
const PLAN_LEVEL: Record<string, number> = {
  nano: 1,
  starter: 2,
  pro: 3,
  business: 4,
  enterprise: 5,
  top_centers: 6,
  payg: 3, // PAYG treated as pro-level for features
};

/** Minimum plan required for each feature */
export const FEATURE_PLANS: Record<string, PlanId> = {
  excel_export: 'pro',
  multi_location: 'business',
  api_access: 'enterprise',
  custom_reports: 'enterprise',
  advanced_analytics: 'pro',
  payment_confirmation: 'pro',
  bulk_operations: 'business',
  custom_widgets: 'business',
  automated_reports: 'business',
};

export function getPlanLevel(plan: string | null | undefined): number {
  return PLAN_LEVEL[canonicalPlanId(plan)] ?? 0;
}

export function hasPlanFeature(plan: string | null | undefined, feature: keyof typeof FEATURE_PLANS): boolean {
  const requiredPlan = FEATURE_PLANS[feature];
  if (!requiredPlan) return true;
  const userLevel = getPlanLevel(plan);
  const requiredLevel = getPlanLevel(requiredPlan);
  return userLevel >= requiredLevel;
}

export function getStudentLimit(plan: string | null | undefined): number {
  return PLAN_STUDENT_LIMITS[canonicalPlanId(plan)] ?? 250;
}

export function getTeamLimit(plan: string | null | undefined): number {
  return PLAN_TEAM_LIMITS[canonicalPlanId(plan)] ?? 2;
}
