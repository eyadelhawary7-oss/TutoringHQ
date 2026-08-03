import { describe, expect, it } from 'vitest';
import { teacherScaleExample } from '@/lib/pricing/teacherScaleExample';
import { TEACHER_PLANS } from '@/lib/teacherPlans';

/**
 * The `/pricing` no-ceiling readout math (design L1864-1897), pinned against
 * the LIVE Scale terms: base 2,499 · cap 100 · overage 20 · annual ×10. If
 * Eyad applies the proposed 150/16 data change, the constants in
 * `teacherPlans.ts` move and these live-value assertions move with them —
 * the algorithm assertions below them must NOT change.
 */
const scale = TEACHER_PLANS.teacher_scale;

describe('teacherScaleExample', () => {
  it('monthly: base plus flat overage past the cap (live values)', () => {
    const ex = teacherScaleExample({
      baseMonthly: scale.priceGross,
      studentCap: scale.studentCap,
      overagePerStudent: scale.overagePerStudent,
      billing: 'monthly',
      annualMultiplier: 10,
      students: 200,
    });
    // 2,499 + (200 − 100) × 20 = 4,499
    expect(ex.shownBase).toBe(2499);
    expect(ex.overageRate).toBe(20);
    expect(ex.exampleTotal).toBe(4499);
    expect(ex.examplePerStudent).toBeCloseTo(22.495, 3); // 4,499 / 200
  });

  it('annual: two months free apply to the overage rate too', () => {
    const ex = teacherScaleExample({
      baseMonthly: scale.priceGross,
      studentCap: scale.studentCap,
      overagePerStudent: scale.overagePerStudent,
      billing: 'annual',
      annualMultiplier: 10,
      students: 200,
    });
    // Base: round(round(2,499 × 10) / 12) = round(2,082.5) = 2,083.
    expect(ex.shownBase).toBe(2083);
    // Rate: 20 × 10 / 12 = 16.666…, NOT rounded before the multiplication.
    expect(ex.overageRate).toBeCloseTo(20 * (10 / 12), 10);
    // 2,083 + 100 × 16.666… = 3,749.666…
    expect(ex.exampleTotal).toBeCloseTo(2083 + (200 - scale.studentCap) * (20 * 10) / 12, 6);
    expect(ex.examplePerStudent).toBeCloseTo(ex.exampleTotal / 200, 10);
    // One extra student costs overage × multiplier per year.
    expect(ex.overageYearly).toBe(200);
  });

  it('per-head cost keeps descending past the cap (the design argument)', () => {
    const at = (students: number) =>
      teacherScaleExample({
        baseMonthly: scale.priceGross,
        studentCap: scale.studentCap,
        overagePerStudent: scale.overagePerStudent,
        billing: 'monthly',
        annualMultiplier: 10,
        students,
      }).examplePerStudent;
    // The overage rate sits below the tier's own per-student cost, so every
    // added student lowers the per-head figure.
    expect(at(scale.studentCap + 1)).toBeLessThan(at(scale.studentCap));
    expect(at(400)).toBeLessThan(at(200));
  });

  it('never bills negative extras below the cap and guards a zero count', () => {
    const ex = teacherScaleExample({
      baseMonthly: scale.priceGross,
      studentCap: scale.studentCap,
      overagePerStudent: scale.overagePerStudent,
      billing: 'monthly',
      annualMultiplier: 10,
      students: 50,
    });
    expect(ex.exampleTotal).toBe(scale.priceGross);

    const zero = teacherScaleExample({
      baseMonthly: scale.priceGross,
      studentCap: scale.studentCap,
      overagePerStudent: scale.overagePerStudent,
      billing: 'monthly',
      annualMultiplier: 10,
      students: 0,
    });
    expect(zero.examplePerStudent).toBe(0);
  });
});
