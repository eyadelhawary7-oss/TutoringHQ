import { describe, expect, it } from 'vitest';
import { teacherScaleExample } from '@/lib/pricing/teacherScaleExample';
import { TEACHER_PLANS } from '@/lib/teacherPlans';

/**
 * The `/pricing` no-ceiling readout math, pinned against the LIVE Scale
 * terms: base 2,499 · cap 100 · overage 20 · annual ×10. The annual view
 * discounts the BASE only — the engine bills overage at the flat monthly
 * rate every month regardless of interval (`teacherOverageAmount` takes no
 * interval; `ensureTeacherOverageInvoice` cadence is monthly by design), so
 * these assertions pin the readout to what the invoice will actually say.
 * If Eyad ever approves an engine change that discounts annual overage, the
 * engine, this file and the page copy must move together — never this file
 * alone. If the plan constants in `teacherPlans.ts` move, the live-value
 * assertions move with them; the algorithm assertions must NOT change.
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

  it('annual: two months free discount the base only — the overage rate does not bend', () => {
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
    // Rate: the flat monthly overage, unchanged on annual. The engine has no
    // annual overage branch, so neither does the readout.
    expect(ex.overageRate).toBe(scale.overagePerStudent);
    expect(ex.overageRate).toBe(20);
    // 2,083 + (200 − 100) × 20 = 4,083.
    expect(ex.exampleTotal).toBe(2083 + (200 - scale.studentCap) * 20);
    expect(ex.examplePerStudent).toBeCloseTo(ex.exampleTotal / 200, 10);
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
