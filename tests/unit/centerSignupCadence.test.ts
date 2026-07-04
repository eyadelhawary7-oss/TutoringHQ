import { describe, it, expect } from 'vitest';
import { PLANS, getPlanPrice, getAnnualChargeRounded } from '@/lib/pricing';

// Centers are billed monthly or annual only. The signup route stores
// `billing_amount = getPlanPrice(planKey, period)` — this asserts that a monthly
// signup is charged ONE month (the monthly list price), never the ×3 quarterly
// figure, and that annual stays monthly × annualMultiplier. Guards the brief's
// invariant: "no new activity produces a three-month period or a times-three
// amount."
describe('center signup cadence — monthly is one month, never ×3', () => {
  for (const key of ['solo', 'nano', 'starter', 'pro', 'business', 'enterprise'] as const) {
    const plan = PLANS[key];

    it(`${key}: monthly signup amount = monthly list price (not quarterlyAllIn × 3)`, () => {
      const monthly = getPlanPrice(key, 'monthly');
      expect(monthly).toBe(plan.monthlyListPrice);
      expect(monthly).not.toBe(plan.quarterlyAllIn * 3);
      // A single month is always strictly less than three quarterly months.
      expect(monthly).toBeLessThan(plan.quarterlyAllIn * 3);
    });

    it(`${key}: annual signup amount = monthly all-in × annualMultiplier (unchanged)`, () => {
      expect(getPlanPrice(key, 'annual', 10)).toBe(getAnnualChargeRounded(plan.quarterlyAllIn, 10));
    });
  }
});
