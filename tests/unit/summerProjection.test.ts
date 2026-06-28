import { describe, it, expect } from 'vitest';
import {
  centerTierForStudents,
  teacherTierForStudents,
  projectCenterFirstInvoice,
  projectTeacherFirstInvoice,
} from '@/lib/summer/projection';
import { PLANS } from '@/lib/pricing';
import { TEACHER_PLANS } from '@/lib/teacherPlans';

describe('centerTierForStudents — six-tier ladder by usage', () => {
  it('maps student counts to the lowest tier whose cap covers them', () => {
    expect(centerTierForStudents(0)).toBe('solo');
    expect(centerTierForStudents(50)).toBe('solo');
    expect(centerTierForStudents(51)).toBe('nano');
    expect(centerTierForStudents(120)).toBe('nano');
    expect(centerTierForStudents(200)).toBe('starter');
    expect(centerTierForStudents(500)).toBe('pro');
    expect(centerTierForStudents(1000)).toBe('business');
    expect(centerTierForStudents(2000)).toBe('enterprise');
    expect(centerTierForStudents(2001)).toBe('top_centers');
  });
});

describe('teacherTierForStudents — three tiers by usage', () => {
  it('Standard ≤20, Pro ≤50, Scale above', () => {
    expect(teacherTierForStudents(0)).toBe('teacher_standard');
    expect(teacherTierForStudents(20)).toBe('teacher_standard');
    expect(teacherTierForStudents(21)).toBe('teacher_pro');
    expect(teacherTierForStudents(50)).toBe('teacher_pro');
    expect(teacherTierForStudents(51)).toBe('teacher_scale');
    expect(teacherTierForStudents(140)).toBe('teacher_scale');
  });
});

describe('projectCenterFirstInvoice — monthly subscription + processing fee', () => {
  it('Solo tier with a 20 EGP fee', () => {
    const p = projectCenterFirstInvoice(40, { feeAmount: 20 });
    expect(p.tierKey).toBe('solo');
    expect(p.subscriptionInclusive).toBe(PLANS.solo.monthlyListPrice);
    expect(p.fee).toBe(20);
    expect(p.total).toBe(PLANS.solo.monthlyListPrice + 20);
    expect(p.vatIncluded).toBeGreaterThan(0);
  });

  it('disabled fee → fee 0, total is the bare subscription', () => {
    const p = projectCenterFirstInvoice(300, { feeAmount: 0 });
    expect(p.tierKey).toBe('pro');
    expect(p.fee).toBe(0);
    expect(p.total).toBe(PLANS.pro.monthlyListPrice);
  });

  it('honors a dynamic per-tier monthly override', () => {
    const p = projectCenterFirstInvoice(100, { feeAmount: 20, monthlyByTier: { nano: 3000 } });
    expect(p.tierKey).toBe('nano');
    expect(p.subscriptionInclusive).toBe(3000);
    expect(p.total).toBe(3020);
  });

  it('Top Centers is flagged custom (amount not auto-derivable)', () => {
    const p = projectCenterFirstInvoice(5000, { feeAmount: 20 });
    expect(p.tierKey).toBe('top_centers');
    expect(p.custom).toBe(true);
    expect(p.subscriptionInclusive).toBe(0);
  });
});

describe('projectTeacherFirstInvoice — tiers + Scale overage', () => {
  it('Standard with fee', () => {
    const p = projectTeacherFirstInvoice(10, { feeAmount: 20 });
    expect(p.tierKey).toBe('teacher_standard');
    expect(p.subscriptionInclusive).toBe(TEACHER_PLANS.teacher_standard.priceGross);
    expect(p.overage).toBe(0);
    expect(p.total).toBe(TEACHER_PLANS.teacher_standard.priceGross + 20);
  });

  it('Scale adds 20 EGP per active student above the 100 cap', () => {
    const p = projectTeacherFirstInvoice(130, { feeAmount: 20 });
    expect(p.tierKey).toBe('teacher_scale');
    expect(p.overage).toBe(30 * TEACHER_PLANS.teacher_scale.overagePerStudent);
    expect(p.subscriptionInclusive).toBe(
      TEACHER_PLANS.teacher_scale.priceGross + 30 * TEACHER_PLANS.teacher_scale.overagePerStudent,
    );
    expect(p.total).toBe(p.subscriptionInclusive + 20);
  });
});
