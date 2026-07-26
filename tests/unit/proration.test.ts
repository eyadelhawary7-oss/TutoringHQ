import { describe, it, expect } from 'vitest';
import {
  getUpgradeCost,
  getSwitchToAnnualCharge,
  daysRemainingUntil,
  getPeriodDays,
} from '@/lib/billingEngine';

// getUpgradeCost has no injectable `now` (unlike getSwitchToAnnualCharge), so
// dates below are computed relative to Date.now() rather than hardcoded — a
// fixed calendar date rots into the past and silently changes which case a
// test exercises (the switchGuardrails.test.ts G6 failure this whole file's
// neighbor is being fixed for).
const daysFromNow = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};

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

  it('daysRemaining never exceeds one period, whatever the due date', () => {
    // Any realistic same-interval upgrade is now provably bounded by the new
    // period's own full price: amountDue = rateDiff × days, days ≤ D, and
    // rateDiff × D ≤ newDailyRate × D = newPlanPrice (the full period charge).
    // A downstream cap can no longer be reached for a same-interval upgrade.
    const cases: Array<['monthly' | 'annual', number]> = [
      ['monthly', 15],
      ['monthly', 45], // more than one period out — clamps
      ['annual', 300],
      ['annual', 900], // more than one period out — clamps
    ];
    for (const [period, daysOut] of cases) {
      const r = getUpgradeCost({
        newPlanPrice: 12999,
        currentPlanPrice: 7999,
        newBillingPeriod: period,
        currentBillingPeriod: period,
        nextPaymentDue: daysFromNow(daysOut),
      });
      expect(r.daysRemaining).toBeLessThanOrEqual(getPeriodDays(period));
      expect(r.amountDue).toBeLessThanOrEqual(12999);
    }
  });

  it('a corrupt/sentinel due date (e.g. 2099-12-31 seed data) no longer produces a runaway charge', () => {
    // Regression lock for the exposure a raw signed day-count created: with no
    // upper bound, a stale sentinel date turned "days remaining" into tens of
    // thousands, multiplying the daily-rate difference into a charge far past
    // any plan's actual price. Bounding at the source (not a downstream cap)
    // makes this the same shape as any ordinary same-interval upgrade.
    const sentinel = new Date('2099-12-31T12:00:00Z');
    const r = getUpgradeCost({
      newPlanPrice: 12999, // business monthly
      currentPlanPrice: 7999, // pro monthly
      newBillingPeriod: 'monthly',
      currentBillingPeriod: 'monthly',
      nextPaymentDue: sentinel,
    });
    expect(r.daysRemaining).toBe(30);
    expect(r.amountDue).toBeCloseTo(((12999 - 7999) / 30) * 30, 2);
    expect(r.amountDue).toBeLessThanOrEqual(12999);
  });

  it('KNOWN GAP (not fixed by this bound): a cross-interval call can still exceed the new plan price', () => {
    // The clamp bounds daysRemaining by the CURRENT period's length, but a
    // cross-interval comparison (annual current rate vs. monthly new rate, or
    // vice versa) mixes two different day divisors — the result is not bounded
    // by either plan's own period price. This is NOT a corrupt-data artifact:
    // a real annual center with a genuine 300 days left in its own cycle hits
    // this today. /api/billing/upgrade's own cap (route.ts) still guards this
    // path and must stay until interval switching is removed from that route
    // entirely — do not delete that cap on the strength of this bound alone.
    const r = getUpgradeCost({
      newPlanPrice: 12999, // business monthly
      currentPlanPrice: 7999, // pro annual
      newBillingPeriod: 'monthly',
      currentBillingPeriod: 'annual',
      nextPaymentDue: daysFromNow(300), // real, non-corrupt: within one annual cycle
    });
    expect(r.daysRemaining).toBe(300);
    expect(r.amountDue).toBeGreaterThan(12999); // exceeds the new plan's own full price
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
