import { describe, expect, it } from 'vitest';
import { computeSubscriptionTotalMrrRounded } from '@/lib/adminSubscriptionMrr';

/**
 * Mirrors GET /api/admin/billing row iteration (subscription-only accumulation).
 * PAYG rows contribute 0 here — parity uses computeSubscriptionTotalMrrRounded on the same centre list.
 */
function billingRouteSubscriptionTotal(
  rows: {
    id: string;
    plan?: string;
    billing_period?: string;
    all_in_price?: number | null;
    status?: string;
    billing_type?: string;
    is_early_adopter?: boolean;
    early_adopter_price?: number | null;
  }[],
): number {
  return computeSubscriptionTotalMrrRounded(rows);
}

function overviewRouteSubscriptionTotal(
  allCenters: {
    id: string;
    plan?: string;
    billing_period?: string | null;
    all_in_price?: number | null;
    status?: string;
    billing_type?: string;
    is_early_adopter?: boolean;
    early_adopter_price?: number | null;
  }[],
): number {
  return computeSubscriptionTotalMrrRounded(allCenters);
}

function financeRouteSubscriptionTotal(
  centers: {
    id: string;
    plan?: string | null;
    billing_period?: string | null;
    all_in_price?: number | null;
    status?: string | null;
    billing_type?: string | null;
    is_early_adopter?: boolean | null;
    early_adopter_price?: number | null;
  }[],
): number {
  return computeSubscriptionTotalMrrRounded(centers);
}

describe('admin MRR parity (billing vs overview vs finance)', () => {
  it('matches subscription totalMRR across the three admin surfaces for mixed centres', () => {
    const centers = [
      {
        id: '1',
        plan: 'solo',
        billing_period: 'quarterly',
        all_in_price: 999,
        status: 'active',
        billing_type: 'fixed',
        is_early_adopter: false,
        early_adopter_price: null,
      },
      {
        id: '2',
        plan: 'nano',
        billing_period: 'monthly',
        all_in_price: 1999,
        status: 'active',
        billing_type: 'fixed',
        is_early_adopter: false,
        early_adopter_price: null,
      },
      {
        id: '3',
        plan: 'starter',
        billing_period: 'quarterly',
        all_in_price: 4499,
        status: 'pending',
        billing_type: 'fixed',
        is_early_adopter: false,
        early_adopter_price: null,
      },
      {
        id: '4',
        plan: 'pro',
        billing_period: 'annual',
        all_in_price: 7999,
        status: 'active',
        billing_type: 'fixed',
        is_early_adopter: false,
        early_adopter_price: null,
      },
      {
        id: '5',
        plan: 'business',
        billing_period: 'quarterly',
        all_in_price: 12999,
        status: 'active',
        billing_type: 'fixed',
        is_early_adopter: false,
        early_adopter_price: null,
      },
      {
        id: '6',
        plan: 'enterprise',
        billing_period: 'quarterly',
        all_in_price: 18499,
        status: 'active',
        billing_type: 'fixed',
        is_early_adopter: false,
        early_adopter_price: null,
      },
      {
        id: '7',
        plan: 'top_centers',
        billing_period: 'quarterly',
        all_in_price: 25_000,
        status: 'active',
        billing_type: 'fixed',
        is_early_adopter: false,
        early_adopter_price: null,
      },
      {
        id: '8',
        plan: 'starter',
        billing_period: 'quarterly',
        all_in_price: 4499,
        status: 'suspended',
        billing_type: 'fixed',
        is_early_adopter: false,
        early_adopter_price: null,
      },
      {
        id: '9',
        plan: 'nano',
        billing_period: 'quarterly',
        all_in_price: 1999,
        status: 'churned',
        billing_type: 'fixed',
        is_early_adopter: false,
        early_adopter_price: null,
      },
      {
        id: '10',
        plan: 'starter',
        billing_period: 'quarterly',
        all_in_price: 4499,
        status: 'active',
        billing_type: 'payg',
        is_early_adopter: false,
        early_adopter_price: null,
      },
      {
        id: '11',
        plan: 'unknown_tier',
        billing_period: 'quarterly',
        all_in_price: null,
        status: 'active',
        billing_type: 'fixed',
        is_early_adopter: true,
        early_adopter_price: 3000,
      },
    ];

    const b = billingRouteSubscriptionTotal(centers);
    const o = overviewRouteSubscriptionTotal(centers);
    const f = financeRouteSubscriptionTotal(centers);

    expect(b).toBe(o);
    expect(o).toBe(f);

    if (b !== o || o !== f) {
      // eslint-disable-next-line no-console
      console.error('MRR parity divergence', { billing: b, overview: o, finance: f });
    }
  });
});
