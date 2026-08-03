import { getAnnualMonthlyFromBase } from '@/lib/pricing';

/**
 * The `/pricing` no-ceiling readout for the teacher Scale tier — the design's
 * base-plus-rate algorithm (design/Merged-Public-Marketing.html L1864-1897)
 * as one pure function, so the page and the unit tests agree on every figure.
 *
 * Semantics, in the design's own terms:
 *  - monthly view: base price as-is, each extra student adds the flat overage.
 *  - annual view: the same two-months-free multiplier applies to the overage
 *    rate as to the base (`rate × multiplier ÷ 12`), so the per-head curve does
 *    not bend at the cap. The base uses `getAnnualMonthlyFromBase` — the SAME
 *    rounding the billing engine's display path uses — never a re-derivation.
 *
 * Every input is passed in (no module state): the caller feeds it
 * `TEACHER_PLANS.teacher_scale` and the live annual multiplier, so the page
 * keeps quoting the rate the invoice will actually use.
 */
export interface TeacherScaleExampleInput {
  /** VAT-inclusive monthly base price (TEACHER_PLANS.teacher_scale.priceGross). */
  baseMonthly: number;
  /** Students included in the base (TEACHER_PLANS.teacher_scale.studentCap). */
  studentCap: number;
  /** Flat EGP/month added per student past the cap (overagePerStudent). */
  overagePerStudent: number;
  /** 'monthly' | 'annual' — which billing view the readout is in. */
  billing: 'monthly' | 'annual';
  /** Months charged per year on annual (pricing.interval.annual_multiplier). */
  annualMultiplier: number;
  /** The worked example's student count. Must be ≥ studentCap. */
  students: number;
}

export interface TeacherScaleExample {
  /** The base figure shown for the first `studentCap` students, this view. */
  shownBase: number;
  /** Per-extra-student EGP/month at this view (fractional on annual). */
  overageRate: number;
  /** What one extra student costs per YEAR on annual (= rate × multiplier). */
  overageYearly: number;
  /** Total EGP/month at `students`. */
  exampleTotal: number;
  /** Per-head EGP/month at `students`. */
  examplePerStudent: number;
}

export function teacherScaleExample(input: TeacherScaleExampleInput): TeacherScaleExample {
  const { baseMonthly, studentCap, overagePerStudent, billing, annualMultiplier, students } = input;
  const annual = billing === 'annual';

  const shownBase = annual
    ? getAnnualMonthlyFromBase(baseMonthly, annualMultiplier)
    : baseMonthly;
  const overageRate = annual
    ? (overagePerStudent * annualMultiplier) / 12
    : overagePerStudent;

  const extra = Math.max(0, students - studentCap);
  const exampleTotal = shownBase + extra * overageRate;

  return {
    shownBase,
    overageRate,
    overageYearly: overagePerStudent * annualMultiplier,
    exampleTotal,
    examplePerStudent: students > 0 ? exampleTotal / students : 0,
  };
}
