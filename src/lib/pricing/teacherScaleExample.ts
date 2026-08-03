import { getAnnualMonthlyFromBase } from '@/lib/pricing';

/**
 * The `/pricing` no-ceiling readout for the teacher Scale tier — the design's
 * base-plus-rate readout (design/Merged-Public-Marketing.html L1864-1897) as
 * one pure function, so the page and the unit tests agree on every figure.
 *
 * One deliberate divergence from the design's algorithm: the design applied
 * the annual two-months-free multiplier to the overage rate too. The billing
 * engine does not. Overage is billed at the flat monthly rate EVERY month,
 * annual subscribers included:
 *  - `teacherOverageAmount` (teacherPlans.ts) takes no billing interval;
 *  - `ensureTeacherOverageInvoice` (teacherBilling.ts) documents the cadence
 *    as monthly and independent of the base cycle;
 *  - `midnightBillingAdapter.ts` applies the annual multiplier to the base
 *    price only.
 * So here the multiplier discounts the BASE alone (via
 * `getAnnualMonthlyFromBase`, the SAME rounding the billing engine's display
 * path uses — never a re-derivation) and the overage rate never changes.
 * Quoting a discounted annual overage rate would understate the invoice.
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
  /** Per-extra-student EGP/month. Identical in both views — billed monthly. */
  overageRate: number;
  /** Total EGP/month at `students`. */
  exampleTotal: number;
  /** Per-head EGP/month at `students`. */
  examplePerStudent: number;
}

export function teacherScaleExample(input: TeacherScaleExampleInput): TeacherScaleExample {
  const { baseMonthly, studentCap, overagePerStudent, billing, annualMultiplier, students } = input;

  const shownBase =
    billing === 'annual' ? getAnnualMonthlyFromBase(baseMonthly, annualMultiplier) : baseMonthly;
  // No annual branch: the engine bills overage monthly at the flat rate on
  // every plan interval. See the header comment for the engine anchors.
  const overageRate = overagePerStudent;

  const extra = Math.max(0, students - studentCap);
  const exampleTotal = shownBase + extra * overageRate;

  return {
    shownBase,
    overageRate,
    exampleTotal,
    examplePerStudent: students > 0 ? exampleTotal / students : 0,
  };
}
