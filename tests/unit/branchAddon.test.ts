import { describe, expect, it } from 'vitest';
import {
  billableExtraBranchCount,
  branchAddonChargeForPeriod,
  buildBranchAddonSnapshot,
  normalizeBranchAddonPrice,
  resolvePrimaryCentreId,
  BRANCH_ADDON_MONTHLY_PRICE_KEY,
} from '@/lib/pricing/branchAddon';
import { getImpliedMonthlyMrr, getQuarterlyAllInMonthlyRateFromCenter, isBranchAddonRow, PLANS } from '@/lib/pricing';

describe('BRANCH_ADDON_MONTHLY_PRICE_KEY', () => {
  it('is the key PR #313 already minted for the notice, so notice and charge cannot drift', () => {
    expect(BRANCH_ADDON_MONTHLY_PRICE_KEY).toBe('branch_addon.monthly_price_egp');
  });
});

describe('normalizeBranchAddonPrice', () => {
  it('returns null when the key is absent — no default price, ever', () => {
    expect(normalizeBranchAddonPrice(undefined)).toBeNull();
    expect(normalizeBranchAddonPrice(null)).toBeNull();
  });

  it('treats 0 and negatives as unpriced rather than free', () => {
    expect(normalizeBranchAddonPrice(0)).toBeNull();
    expect(normalizeBranchAddonPrice(-199)).toBeNull();
  });

  it('rejects junk instead of coercing it to a charge', () => {
    expect(normalizeBranchAddonPrice('abc')).toBeNull();
    expect(normalizeBranchAddonPrice({})).toBeNull();
    expect(normalizeBranchAddonPrice(NaN)).toBeNull();
  });

  it('accepts a number or a numeric string, rounded to 2dp', () => {
    expect(normalizeBranchAddonPrice(199)).toBe(199);
    expect(normalizeBranchAddonPrice('199')).toBe(199);
    expect(normalizeBranchAddonPrice(199.456)).toBe(199.46);
  });
});

describe('billableExtraBranchCount', () => {
  it('a single-centre org has no extras — the add-on never touches its invoice', () => {
    expect(billableExtraBranchCount(1)).toBe(0);
    expect(billableExtraBranchCount(0)).toBe(0);
  });

  it('counts every centre beyond the first', () => {
    expect(billableExtraBranchCount(2)).toBe(1);
    expect(billableExtraBranchCount(5)).toBe(4);
  });
});

describe('branchAddonChargeForPeriod', () => {
  const monthly = { billingPeriod: 'monthly' as const };

  it('charges nothing while the config key is unset — the live state today', () => {
    expect(
      branchAddonChargeForPeriod({ extraBranches: 3, monthlyPrice: null, ...monthly }),
    ).toBe(0);
  });

  it('charges nothing for a single-branch org even once priced', () => {
    expect(
      branchAddonChargeForPeriod({ extraBranches: 0, monthlyPrice: 199, ...monthly }),
    ).toBe(0);
  });

  it('monthly: flat price per extra branch', () => {
    expect(branchAddonChargeForPeriod({ extraBranches: 1, monthlyPrice: 199, ...monthly })).toBe(199);
    expect(branchAddonChargeForPeriod({ extraBranches: 3, monthlyPrice: 199, ...monthly })).toBe(597);
  });

  it('annual: bills monthly x annualMultiplier (10), matching the plan’s own "pay 10 get 12"', () => {
    expect(
      branchAddonChargeForPeriod({
        extraBranches: 1,
        monthlyPrice: 199,
        billingPeriod: 'annual',
        annualMultiplier: 10,
      }),
    ).toBe(1990);
  });

  it('annual never silently bills 12 months of add-on against a 10-month plan', () => {
    const annual = branchAddonChargeForPeriod({
      extraBranches: 1,
      monthlyPrice: 199,
      billingPeriod: 'annual',
      annualMultiplier: 10,
    });
    expect(annual).not.toBe(199 * 12);
  });

  it('an unknown/legacy billing period falls to the monthly cadence, not a x3 quarterly charge', () => {
    expect(
      branchAddonChargeForPeriod({ extraBranches: 1, monthlyPrice: 199, billingPeriod: 'quarterly' }),
    ).toBe(199);
  });

  it('ignores a negative or fractional branch count rather than crediting money back', () => {
    expect(branchAddonChargeForPeriod({ extraBranches: -2, monthlyPrice: 199, ...monthly })).toBe(0);
    expect(branchAddonChargeForPeriod({ extraBranches: 1.9, monthlyPrice: 199, ...monthly })).toBe(199);
  });
});

describe('resolvePrimaryCentreId', () => {
  it('picks the oldest centre — the same main-branch rule GET /api/branches shows', () => {
    expect(
      resolvePrimaryCentreId([
        { id: 'b', created_at: '2026-03-01T00:00:00Z' },
        { id: 'a', created_at: '2026-01-01T00:00:00Z' },
        { id: 'c', created_at: '2026-02-01T00:00:00Z' },
      ]),
    ).toBe('a');
  });

  it('is deterministic when timestamps tie, so the add-on lands on one centre only', () => {
    const tie = [
      { id: 'zzz', created_at: '2026-01-01T00:00:00Z' },
      { id: 'aaa', created_at: '2026-01-01T00:00:00Z' },
    ];
    expect(resolvePrimaryCentreId(tie)).toBe('aaa');
    expect(resolvePrimaryCentreId([...tie].reverse())).toBe('aaa');
  });

  it('sorts a missing created_at last rather than making it the payer', () => {
    expect(
      resolvePrimaryCentreId([
        { id: 'nodate', created_at: null },
        { id: 'dated', created_at: '2026-05-01T00:00:00Z' },
      ]),
    ).toBe('dated');
  });

  it('returns null for an empty org', () => {
    expect(resolvePrimaryCentreId([])).toBeNull();
  });
});

describe('buildBranchAddonSnapshot', () => {
  it('is null when nothing was charged, keeping metadata clean', () => {
    expect(buildBranchAddonSnapshot({ extraBranches: 0, monthlyPrice: 199, total: 0 })).toBeNull();
    expect(buildBranchAddonSnapshot({ extraBranches: 2, monthlyPrice: null, total: 0 })).toBeNull();
  });

  it('records count, unit price and total so the invoice reprints at its original price', () => {
    expect(buildBranchAddonSnapshot({ extraBranches: 2, monthlyPrice: 199, total: 398 })).toEqual({
      branch_addon_count: 2,
      branch_addon_unit_price: 199,
      branch_addon_total: 398,
    });
  });
});

describe('D23 regression: a branch must not be counted as a second subscription', () => {
  it('isBranchAddonRow is false for every standalone centre (organization_id NULL)', () => {
    expect(isBranchAddonRow({ organization_id: null, all_in_price: null })).toBe(false);
    expect(isBranchAddonRow({ organization_id: undefined, all_in_price: null })).toBe(false);
  });

  it('isBranchAddonRow is false for the org primary, which carries its own price', () => {
    expect(isBranchAddonRow({ organization_id: 'org-1', all_in_price: 4499 })).toBe(false);
  });

  it('isBranchAddonRow is true for an org member with no price of its own', () => {
    expect(isBranchAddonRow({ organization_id: 'org-1', all_in_price: null })).toBe(true);
    expect(isBranchAddonRow({ organization_id: 'org-1', all_in_price: 0 })).toBe(true);
  });

  it('a branch resolves to a 0 rate instead of falling through to the plan list price', () => {
    expect(
      getQuarterlyAllInMonthlyRateFromCenter({
        plan: 'starter',
        all_in_price: null,
        organization_id: 'org-1',
      }),
    ).toBe(0);
  });

  it('a standalone centre with no all_in_price still falls back to the plan list price (unchanged)', () => {
    expect(
      getQuarterlyAllInMonthlyRateFromCenter({ plan: 'starter', all_in_price: null }),
    ).toBe(PLANS.starter.quarterlyAllIn);
  });

  it('a branch contributes 0 to subscription MRR; the parent still contributes in full', () => {
    const parent = getImpliedMonthlyMrr({
      plan: 'starter',
      all_in_price: 4499,
      billing_period: 'monthly',
      status: 'active',
      organization_id: 'org-1',
    });
    const branch = getImpliedMonthlyMrr({
      plan: 'starter',
      all_in_price: null,
      billing_period: 'monthly',
      status: 'active',
      organization_id: 'org-1',
    });
    expect(parent).toBeGreaterThan(0);
    expect(branch).toBe(0);
    // The pre-fix bug: parent + branch reported two whole starter subscriptions.
    expect(parent + branch).toBe(parent);
  });
});
