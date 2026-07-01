import { describe, it, expect } from 'vitest';
import { getUpgradeCost, getSwitchToAnnualCharge, daysRemainingUntil } from '@/lib/billingEngine';

// Shared proration engine — one path for centers AND teachers.
//   - tier upgrade (same interval): daily-rate difference, keeps the renewal date.
//   - monthly→annual: annual full price minus unused-period credit, fresh 12-mo term.
// Guardrails proven: G3 (credit only reduces a bill, floor at 0), G9 (no summer credit).

const SEP15 = new Date('2026-09-15T00:00:00Z');
const SEP30 = new Date('2026-09-30T00:00:00Z');
const DEC01 = new Date('2026-12-01T00:00:00Z');

describe('shared proration — tier upgrade (same interval)', () => {
  it('charges only the daily-rate difference for the days remaining (renewal date kept)', () => {
    // Pro 7,999/mo → Business 12,999/mo, 15 days left.
    const r = getUpgradeCost({
      newPlanPrice: 12999,
      currentPlanPrice: 7999,
      newBillingPeriod: 'monthly',
      currentBillingPeriod: 'monthly',
      nextPaymentDue: SEP30,
    });
    // Charge = (newDaily - oldDaily) × daysRemaining (date-independent assertion).
    expect(r.dailyRateDifference).toBeCloseTo((12999 - 7999) / 30, 4);
    expect(r.amountDue).toBeCloseTo(r.dailyRateDifference * r.daysRemaining, 2);
  });

  it('a cheaper-per-day target yields zero (the monthly→annual defect the brief fixes)', () => {
    // annual is cheaper per day than monthly → getUpgradeCost floors to 0 → the old
    // route rejected it as USE_DOWNGRADE. getSwitchToAnnualCharge replaces this path.
    const r = getUpgradeCost({
      newPlanPrice: 9990, // annual (999 × 10)
      currentPlanPrice: 999, // monthly
      newBillingPeriod: 'annual',
      currentBillingPeriod: 'monthly',
      nextPaymentDue: SEP30,
    });
    expect(r.amountDue).toBe(0);
  });
});

describe('shared proration — monthly → annual (getSwitchToAnnualCharge)', () => {
  it('charges annual minus the unused-month credit, mid-month', () => {
    // Teacher Scale 2,499/mo → annual 24,990, 15 days left.
    const r = getSwitchToAnnualCharge({
      annualFullPrice: 24990,
      currentPeriodPrice: 2499,
      currentBillingPeriod: 'monthly',
      nextPaymentDue: SEP30,
      now: SEP15,
    });
    // credit = 2499/30 × 15 = 1249.5 ; charge = 24990 - 1249.5 = 23740.5
    expect(r.daysRemaining).toBe(15);
    expect(r.credit).toBeCloseTo(1249.5, 2);
    expect(r.charge).toBeCloseTo(23740.5, 2);
  });

  it('G3/G4: credit can only reduce the charge, floored at zero (never negative)', () => {
    const r = getSwitchToAnnualCharge({
      annualFullPrice: 400, // synthetic: tiny annual, huge unused window
      currentPeriodPrice: 999,
      currentBillingPeriod: 'monthly',
      nextPaymentDue: DEC01,
      now: new Date('2026-09-01T00:00:00Z'),
    });
    expect(r.charge).toBe(0); // floors, never negative, never a balance
    expect(r.credit).toBeGreaterThan(400);
  });

  it('G9: no credit while summer holds charges → full annual price charged', () => {
    const r = getSwitchToAnnualCharge({
      annualFullPrice: 24990,
      currentPeriodPrice: 2499,
      currentBillingPeriod: 'monthly',
      nextPaymentDue: SEP30,
      now: SEP15,
      summerHoldsCharges: true,
    });
    expect(r.credit).toBe(0);
    expect(r.charge).toBe(24990);
  });

  it('monthly→annual is always a positive charge (annual ×10 >> one month of credit)', () => {
    // Even with a full month unused, credit ≤ one month, annual = 10 months.
    const r = getSwitchToAnnualCharge({
      annualFullPrice: 9990, // 999 × 10
      currentPeriodPrice: 999,
      currentBillingPeriod: 'monthly',
      nextPaymentDue: SEP30,
      now: new Date('2026-08-31T00:00:00Z'), // ~30 days left
    });
    expect(r.charge).toBeGreaterThan(0);
    expect(r.charge).toBeLessThan(9990);
  });
});

describe('daysRemainingUntil', () => {
  it('floors at zero for past due dates', () => {
    expect(daysRemainingUntil(SEP15, SEP30)).toBe(0);
    expect(daysRemainingUntil(SEP30, SEP15)).toBe(15);
  });
});
