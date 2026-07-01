// src/lib/teacherPlans.ts
//
// Single source of truth for the teacher subscription ladder. Prices are charged
// UPFRONT to the teacher's OWN card/wallet via Paymob (the KEEP-ON billing path),
// VAT 14% inclusive. The tier's student cap is enforced by the ACTIVE-STUDENT
// count — a student who checked in at least once during the billing month counts
// once, regardless of how many sessions (see countActiveStudentsThisMonth).
//
//   Free   — center monitoring only, no subscription row. The hook tier.
//   Standard (499)  — up to 20 active students. 14-day free trial. No label.
//   Pro      (999)  — up to 50 active students. Label: "Best for Part-Time".
//   Scale   (2499)  — up to 100 active students, then +20 EGP per active student
//                     above 100, trued up at month end.
//
// No "most popular" badge anywhere. The only label is "Best for Part-Time" on Pro.

export type TeacherPlanKey = 'teacher_standard' | 'teacher_pro' | 'teacher_scale';

export const TEACHER_PLAN_KEYS: readonly TeacherPlanKey[] = [
  'teacher_standard',
  'teacher_pro',
  'teacher_scale',
];

/** The plan a brand-new teacher is provisioned onto (with the free trial). */
export const DEFAULT_TEACHER_PLAN_KEY: TeacherPlanKey = 'teacher_standard';

export interface TeacherPlanDef {
  key: TeacherPlanKey;
  /** 1 = Standard, 2 = Pro, 3 = Scale. Higher unlocks more. */
  rank: number;
  priceGross: number; // EGP/month, VAT-inclusive
  priceNet: number;
  vatAmount: number;
  /** Active-student cap. Standard/Pro hard-cap here; Scale bills overage above it. */
  studentCap: number;
  /** EGP per active student above the cap. Scale only; 0 elsewhere. */
  overagePerStudent: number;
  trialDays: number;
  blastCreditsMonthly: number;
  /** Pro-tier surfaces: analytics, student notes, guest attendees, CSV, automated WhatsApp. */
  proFeatures: boolean;
  /** "as low as" per-student price shown on the card (priceGross / studentCap, rounded). */
  perStudentFloor: number;
}

// VAT 14% inclusive: net = round(gross / 1.14, 2), vat = gross - net.
export const TEACHER_PLANS: Record<TeacherPlanKey, TeacherPlanDef> = {
  teacher_standard: {
    key: 'teacher_standard',
    rank: 1,
    priceGross: 499,
    priceNet: 437.72,
    vatAmount: 61.28,
    studentCap: 20,
    overagePerStudent: 0,
    trialDays: 14,
    blastCreditsMonthly: 0,
    proFeatures: false,
    perStudentFloor: 25,
  },
  teacher_pro: {
    key: 'teacher_pro',
    rank: 2,
    priceGross: 999,
    priceNet: 876.32,
    vatAmount: 122.68,
    studentCap: 50,
    overagePerStudent: 0,
    trialDays: 0,
    blastCreditsMonthly: 100,
    proFeatures: true,
    perStudentFloor: 20,
  },
  teacher_scale: {
    key: 'teacher_scale',
    rank: 3,
    priceGross: 2499,
    priceNet: 2192.11,
    vatAmount: 306.89,
    studentCap: 100,
    overagePerStudent: 20,
    trialDays: 0,
    blastCreditsMonthly: 100,
    proFeatures: true,
    perStudentFloor: 25,
  },
};

/**
 * platform_config key holding a teacher plan's price/config.
 *   teacher_standard → 'teacher_subscription_plan'
 *   teacher_pro      → 'teacher_subscription_plan_pro'
 *   teacher_scale    → 'teacher_subscription_plan_scale'
 * Unknown/legacy keys fall back to Standard's key.
 */
export function teacherPlanConfigKey(planKey: string | null | undefined): string {
  if (planKey === 'teacher_pro') return 'teacher_subscription_plan_pro';
  if (planKey === 'teacher_scale') return 'teacher_subscription_plan_scale';
  return 'teacher_subscription_plan';
}

/** Resolve a (possibly null/legacy) plan_key to a plan def, defaulting to Standard. */
export function getTeacherPlan(planKey: string | null | undefined): TeacherPlanDef {
  if (planKey && planKey in TEACHER_PLANS) {
    return TEACHER_PLANS[planKey as TeacherPlanKey];
  }
  return TEACHER_PLANS[DEFAULT_TEACHER_PLAN_KEY];
}

/** True for Pro and Scale — the tiers that unlock pro features (analytics, notes, guests, CSV, automated WhatsApp). */
export function isProOrAbove(planKey: string | null | undefined): boolean {
  return getTeacherPlan(planKey).proFeatures;
}

/** The active-student cap for the plan. */
export function teacherStudentCap(planKey: string | null | undefined): number {
  return getTeacherPlan(planKey).studentCap;
}

/**
 * Whether exceeding the cap hard-blocks (Standard, Pro) vs. is billed as overage
 * (Scale). Scale never hard-blocks — extra active students are trued up monthly.
 */
export function teacherHasHardCap(planKey: string | null | undefined): boolean {
  return getTeacherPlan(planKey).overagePerStudent === 0;
}

/** Scale overage EGP for a given active-student count (0 for non-Scale or under cap). */
export function teacherOverageAmount(
  planKey: string | null | undefined,
  activeStudents: number,
): number {
  const plan = getTeacherPlan(planKey);
  if (plan.overagePerStudent <= 0) return 0;
  const over = Math.max(0, activeStudents - plan.studentCap);
  return Math.round(over * plan.overagePerStudent * 100) / 100;
}
