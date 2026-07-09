import { getImpliedMonthlyMrr, type ImpliedMrrCenterFields } from '@/lib/pricing';

/**
 * Subscription-only MRR total used across GET /api/admin/billing, overview, and finance.
 */
export function computeSubscriptionTotalMrrRounded(centers: ImpliedMrrCenterFields[]): number {
  return Math.round(centers.reduce((sum, c) => sum + getImpliedMonthlyMrr(c), 0));
}
