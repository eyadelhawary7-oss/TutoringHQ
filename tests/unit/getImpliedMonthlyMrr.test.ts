import { describe, expect, it } from 'vitest';
import {
  getAnnualChargeRounded,
  getImpliedMonthlyMrr,
  getQuarterlyAllInMonthlyRateFromCenter,
  isCenterEligibleForSubscriptionMrr,
  PLANS,
} from '@/lib/pricing';

describe('getImpliedMonthlyMrr', () => {
  const active = { status: 'active' as const };

  it('solo quarterly: all_in_price 3447 is monthly all-in rate → implied MRR 3447', () => {
    expect(
      getImpliedMonthlyMrr({
        plan: 'solo',
        all_in_price: 3447,
        billing_period: 'quarterly',
        ...active,
      }),
    ).toBe(3447);
  });

  it('solo monthly: all_in 999 (quarterly-rate baseline) → monthly list-equivalent via pricing math', () => {
    const implied = getImpliedMonthlyMrr({
      plan: 'solo',
      all_in_price: 999,
      billing_period: 'monthly',
      ...active,
    });
    expect(implied).toBe(
      getImpliedMonthlyMrr(999, 'monthly', 'solo'),
    );
    expect(implied).toBeGreaterThan(999);
  });

  it('solo annual: uses annual formula / 12', () => {
    const base = getQuarterlyAllInMonthlyRateFromCenter({
      plan: 'solo',
      all_in_price: 999,
    });
    expect(
      getImpliedMonthlyMrr({
        plan: 'solo',
        all_in_price: 999,
        billing_period: 'annual',
        ...active,
      }),
    ).toBe(getAnnualChargeRounded(base) / 12);
  });

  it('suspended centre → 0 subscription MRR', () => {
    expect(
      getImpliedMonthlyMrr({
        plan: 'starter',
        all_in_price: 4499,
        billing_period: 'quarterly',
        status: 'suspended',
      }),
    ).toBe(0);
  });

  it('top_centers with null all_in_price → 0 (no throw)', () => {
    expect(
      getImpliedMonthlyMrr({
        plan: 'top_centers',
        all_in_price: null,
        billing_period: 'quarterly',
        ...active,
      }),
    ).toBe(0);
  });

  it('top_centers with custom all_in_price → that rate as quarterly monthly all-in', () => {
    expect(
      getImpliedMonthlyMrr({
        plan: 'top_centers',
        all_in_price: 25000,
        billing_period: 'quarterly',
        ...active,
      }),
    ).toBe(25000);
  });

  it('solo with all_in_price null → falls back to plan list quarterly all-in', () => {
    expect(
      getImpliedMonthlyMrr({
        plan: 'solo',
        all_in_price: null,
        billing_period: 'quarterly',
        ...active,
      }),
    ).toBe(PLANS.solo.quarterlyAllIn);
  });

  it('solo with all_in_price 0 → falls back to list price (same as legacy finance fallback)', () => {
    expect(
      getImpliedMonthlyMrr({
        plan: 'solo',
        all_in_price: 0,
        billing_period: 'quarterly',
        ...active,
      }),
    ).toBe(PLANS.solo.quarterlyAllIn);
  });

  it('PAYG billing_type → 0 fixed subscription MRR', () => {
    expect(
      getImpliedMonthlyMrr({
        plan: 'starter',
        all_in_price: 4499,
        billing_period: 'quarterly',
        billing_type: 'payg',
        ...active,
      }),
    ).toBe(0);
  });

  it('numeric overload unchanged: quarterly base passes through', () => {
    expect(getImpliedMonthlyMrr(999, 'quarterly', 'solo')).toBe(999);
  });
});

describe('isCenterEligibleForSubscriptionMrr', () => {
  it('excludes suspended', () => {
    expect(isCenterEligibleForSubscriptionMrr('suspended')).toBe(false);
  });
  it('includes active', () => {
    expect(isCenterEligibleForSubscriptionMrr('active')).toBe(true);
  });
});
