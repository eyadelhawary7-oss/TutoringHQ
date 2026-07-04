import { describe, it, expect } from 'vitest';
import {
  centerRenewalPeriodMonths,
  centerRenewalBaseAmount,
} from '@/lib/centerRenewal';

// Centers are billed monthly or annual only. Annual bills monthly × 10 over a
// 12-month clock (mirrors the teacher engine); monthly bills the stored monthly
// amount over a 1-month clock. The quarterly clock is retired for new activity.
describe('centerRenewalPeriodMonths', () => {
  it('annual → 12 months', () => {
    expect(centerRenewalPeriodMonths('annual')).toBe(12);
    expect(centerRenewalPeriodMonths('yearly')).toBe(12); // legacy alias
  });

  it('monthly → 1 month (the standard non-annual cadence)', () => {
    expect(centerRenewalPeriodMonths('monthly')).toBe(1);
  });

  it('every non-annual value → 1 month; the 3-month quarterly clock is gone', () => {
    expect(centerRenewalPeriodMonths('quarterly')).toBe(1);
    expect(centerRenewalPeriodMonths(null)).toBe(1);
    expect(centerRenewalPeriodMonths(undefined)).toBe(1);
    expect(centerRenewalPeriodMonths('garbage')).toBe(1);
  });
});

describe('centerRenewalBaseAmount', () => {
  it('annual → monthly all-in × annualMultiplier (=10 default), NOT the stored quarterly amount', () => {
    // all_in_price = 1000/mo. Annual = 1000 × 10 = 10000. Stored billing_amount
    // (quarterly = 3000) must be ignored for annual.
    expect(
      centerRenewalBaseAmount({
        billingPeriod: 'annual',
        allInPerMonth: 1000,
        storedBillingAmount: 3000,
      }),
    ).toBe(10000);
  });

  it('annual honours a live annualMultiplier override', () => {
    expect(
      centerRenewalBaseAmount({
        billingPeriod: 'annual',
        allInPerMonth: 1000,
        storedBillingAmount: 3000,
        annualMultiplier: 11,
      }),
    ).toBe(11000);
  });

  it('non-annual → the stored (quarterly) billing_amount, unchanged', () => {
    expect(
      centerRenewalBaseAmount({
        billingPeriod: 'quarterly',
        allInPerMonth: 1000,
        storedBillingAmount: 3000,
      }),
    ).toBe(3000);
    expect(
      centerRenewalBaseAmount({
        billingPeriod: 'monthly',
        allInPerMonth: 1000,
        storedBillingAmount: 1150,
      }),
    ).toBe(1150);
  });

  it('non-annual never consults all_in_price (respects custom/early-adopter billing_amount)', () => {
    // A custom quarterly amount that is NOT all_in × 3 must survive untouched.
    expect(
      centerRenewalBaseAmount({
        billingPeriod: 'quarterly',
        allInPerMonth: 1000,
        storedBillingAmount: 2500, // discounted / early-adopter
      }),
    ).toBe(2500);
  });
});
