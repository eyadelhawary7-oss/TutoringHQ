import { describe, it, expect } from 'vitest';
import {
  centerRenewalPeriodMonths,
  centerRenewalBaseAmount,
} from '@/lib/centerRenewal';

// Job 1: center recurring renewals must be period-aware. Annual bills monthly × 10
// over a 12-month clock (mirrors the teacher engine); monthly/quarterly are left
// exactly on the legacy quarterly clock + stored amount.
describe('centerRenewalPeriodMonths', () => {
  it('annual → 12 months', () => {
    expect(centerRenewalPeriodMonths('annual')).toBe(12);
    expect(centerRenewalPeriodMonths('yearly')).toBe(12); // legacy alias
  });

  it('non-annual → 3 months (unchanged quarterly clock)', () => {
    expect(centerRenewalPeriodMonths('quarterly')).toBe(3);
    expect(centerRenewalPeriodMonths('monthly')).toBe(3);
    expect(centerRenewalPeriodMonths(null)).toBe(3);
    expect(centerRenewalPeriodMonths(undefined)).toBe(3);
    expect(centerRenewalPeriodMonths('garbage')).toBe(3);
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
