// src/lib/summer/projection.ts
//
// "No bill shock" — given a customer's live usage, project the tier their usage
// places them in and the exact amount their first invoice will carry, with the
// normal processing fee + VAT lines. Centers ride the six-tier ladder; teachers
// the three tiers. Summer signups default to MONTHLY cadence, so the projected
// subscription is the monthly VAT-inclusive price.
//
// Pure + client-safe: no Supabase, no `new Date()`. Prices come from the pricing
// SSOT (PLANS, TEACHER_PLANS); the per-tier monthly map can be overridden so the
// server can feed dynamic prices from `pricing_plans`.

import {
  ORDERED_SUBSCRIPTION_PLAN_KEYS,
  PLANS,
  type SubscriptionPlanKey,
} from '@/lib/pricing';
import { applyProcessingFee, vatInsideInclusive } from '@/lib/processingFee';
import { TEACHER_PLANS, type TeacherPlanKey } from '@/lib/teacherPlans';

export type ProjectionTierKey = SubscriptionPlanKey | 'top_centers' | TeacherPlanKey;

export interface FirstInvoiceProjection {
  segment: 'center' | 'teacher';
  tierKey: ProjectionTierKey;
  tierNameEn: string;
  tierNameAr: string;
  activeStudents: number;
  /** Top Centers — amount is custom (all_in_price) and not auto-derivable from usage. */
  custom: boolean;
  /** Monthly VAT-inclusive subscription price for the tier. */
  subscriptionInclusive: number;
  /** Teacher Scale overage (EGP) above the cap; 0 for everyone else. */
  overage: number;
  /** Flat processing fee applied (0 when disabled). */
  fee: number;
  /** subscription + overage + fee — the first-invoice total. */
  total: number;
  /** VAT already contained inside `total` (does not add to it). */
  vatIncluded: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The center tier a given active-student count lands in (six-tier ladder, then Top Centers). */
export function centerTierForStudents(activeStudents: number): SubscriptionPlanKey | 'top_centers' {
  const count = Math.max(0, Math.floor(Number(activeStudents) || 0));
  for (const key of ORDERED_SUBSCRIPTION_PLAN_KEYS) {
    const limit = PLANS[key].weeklyStudentLimit;
    if (limit != null && count <= limit) return key;
  }
  return 'top_centers';
}

/** The teacher tier a given active-student count lands in (Standard → Pro → Scale). */
export function teacherTierForStudents(activeStudents: number): TeacherPlanKey {
  const count = Math.max(0, Math.floor(Number(activeStudents) || 0));
  if (count <= TEACHER_PLANS.teacher_standard.studentCap) return 'teacher_standard';
  if (count <= TEACHER_PLANS.teacher_pro.studentCap) return 'teacher_pro';
  return 'teacher_scale';
}

export interface CenterProjectionOpts {
  /** Flat processing fee EGP (from getProcessingFeeConfig). */
  feeAmount: number;
  /** Optional dynamic monthly inclusive price per tier (else PLANS[].quarterlyAllIn). */
  monthlyByTier?: Partial<Record<SubscriptionPlanKey, number>>;
}

/** Project a center's first invoice from its active-student count. */
export function projectCenterFirstInvoice(
  activeStudents: number,
  opts: CenterProjectionOpts,
): FirstInvoiceProjection {
  const count = Math.max(0, Math.floor(Number(activeStudents) || 0));
  const tierKey = centerTierForStudents(count);
  const fee = Math.max(0, round2(Number(opts.feeAmount) || 0));

  if (tierKey === 'top_centers') {
    return {
      segment: 'center',
      tierKey,
      tierNameEn: PLANS.top_centers.englishName,
      tierNameAr: PLANS.top_centers.arabicName,
      activeStudents: count,
      custom: true,
      subscriptionInclusive: 0,
      overage: 0,
      fee,
      total: 0,
      vatIncluded: 0,
    };
  }

  const monthly =
    opts.monthlyByTier?.[tierKey] != null && Number(opts.monthlyByTier[tierKey]) > 0
      ? round2(Number(opts.monthlyByTier[tierKey]))
      : PLANS[tierKey].quarterlyAllIn;
  const applied = applyProcessingFee(monthly, { enabled: fee > 0, amount: fee });
  return {
    segment: 'center',
    tierKey,
    tierNameEn: PLANS[tierKey].englishName,
    tierNameAr: PLANS[tierKey].arabicName,
    activeStudents: count,
    custom: false,
    subscriptionInclusive: applied.subscription,
    overage: 0,
    fee: applied.fee,
    total: applied.total,
    vatIncluded: vatInsideInclusive(applied.total),
  };
}

export interface TeacherProjectionOpts {
  /** Flat processing fee EGP (from getProcessingFeeConfig). */
  feeAmount: number;
}

const TEACHER_TIER_NAMES: Record<TeacherPlanKey, { en: string; ar: string }> = {
  teacher_standard: { en: 'Standard', ar: 'أساسي' },
  teacher_pro: { en: 'Pro', ar: 'احترافي' },
  teacher_scale: { en: 'Scale', ar: 'نمو' },
};

/** Project a teacher's first invoice from its active-student count (Scale adds overage). */
export function projectTeacherFirstInvoice(
  activeStudents: number,
  opts: TeacherProjectionOpts,
): FirstInvoiceProjection {
  const count = Math.max(0, Math.floor(Number(activeStudents) || 0));
  const tierKey = teacherTierForStudents(count);
  const plan = TEACHER_PLANS[tierKey];
  const fee = Math.max(0, round2(Number(opts.feeAmount) || 0));
  const overage =
    plan.overagePerStudent > 0
      ? round2(Math.max(0, count - plan.studentCap) * plan.overagePerStudent)
      : 0;
  const subscriptionInclusive = round2(plan.priceGross + overage);
  const total = round2(subscriptionInclusive + fee);
  return {
    segment: 'teacher',
    tierKey,
    tierNameEn: TEACHER_TIER_NAMES[tierKey].en,
    tierNameAr: TEACHER_TIER_NAMES[tierKey].ar,
    activeStudents: count,
    custom: false,
    subscriptionInclusive,
    overage,
    fee,
    total,
    vatIncluded: vatInsideInclusive(total),
  };
}
