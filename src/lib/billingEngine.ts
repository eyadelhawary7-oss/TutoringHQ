/**
 * Core billing calculations and credit ledger helpers (single source of truth).
 * Rules: Paymob order_id is idempotency key; spend credits only after payment success (or credit-only flows).
 * FIFO batches by created_at; earned rows carry expires_at (null = no expiry). DB migrations may use clock_timestamp() for ledger created_at.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Months covered by one invoice for the billing period (not used for proration day-count). */
export function getPeriodMultiplier(period: 'monthly' | 'quarterly' | 'annual'): number {
  switch (period) {
    case 'monthly':
      return 1;
    case 'quarterly':
      return 3;
    case 'annual':
      return 12;
    default:
      throw new Error(`Unknown billing period: ${String(period)}`);
  }
}

/** Calendar-day span used for daily rate / proration (annual = 365). */
export function getPeriodDays(period: 'monthly' | 'quarterly' | 'annual'): number {
  switch (period) {
    case 'monthly':
      return 30;
    case 'quarterly':
      return 90;
    case 'annual':
      return 365;
    default:
      throw new Error(`Unknown billing period: ${String(period)}`);
  }
}

/**
 * EGP per day for the current billing period.
 * @param periodChargeAmount — full amount for one billing cycle (e.g. from getChargeFromQuarterlyAllIn).
 * Annual discount is applied in pricing before this call, not inside getDailyRate.
 */
export function isPaygCenter(center: {
  billing_type?: string | null;
  pricing_type?: string | null;
}): boolean {
  return center.billing_type === 'payg' || center.pricing_type === 'payg';
}

export function getDailyRate(
  periodChargeAmount: number,
  billingPeriod: 'monthly' | 'quarterly' | 'annual',
  billingContext?: { billing_type?: string | null; pricing_type?: string | null },
): number {
  if (billingContext && isPaygCenter(billingContext)) {
    throw new Error('getDailyRate called on PAYG center — use calculatePaygBill');
  }
  const days = getPeriodDays(billingPeriod);
  if (days <= 0) return 0;
  return periodChargeAmount / days;
}

export function getReactivationTier(suspendedAt: Date): 'tier1' | 'tier2' | 'tier3' {
  const daysSuspended = Math.floor(
    (Date.now() - suspendedAt.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (daysSuspended <= 30) return 'tier1';
  if (daysSuspended <= 90) return 'tier2';
  return 'tier3';
}

export function getReactivationAmount(params: {
  tier: 'tier1' | 'tier2' | 'tier3';
  nextPeriodAmount: number;
  dailyRate: number;
}): {
  fine: number;
  reactivationFee: number;
  nextPeriod: number;
  total: number;
  breakdown: string;
} {
  const { tier, nextPeriodAmount, dailyRate } = params;
  const GRACE_DAYS = 6;
  const REACTIVATION_FEE_RATE = 0.03;

  if (tier === 'tier1') {
    const fine = dailyRate * GRACE_DAYS;
    return {
      fine,
      reactivationFee: 0,
      nextPeriod: nextPeriodAmount,
      total: fine + nextPeriodAmount,
      breakdown: `Fine (${GRACE_DAYS} days × ${dailyRate.toFixed(2)} EGP/day) + Next period`,
    };
  }

  const reactivationFee = nextPeriodAmount * REACTIVATION_FEE_RATE;
  return {
    fine: 0,
    reactivationFee,
    nextPeriod: nextPeriodAmount,
    total: reactivationFee + nextPeriodAmount,
    breakdown: `3% reactivation fee + Next period`,
  };
}

export function getUpgradeCost(params: {
  newPlanPrice: number;
  currentPlanPrice: number;
  newBillingPeriod: 'monthly' | 'quarterly' | 'annual';
  currentBillingPeriod: 'monthly' | 'quarterly' | 'annual';
  nextPaymentDue: Date;
}): {
  daysRemaining: number;
  dailyRateDifference: number;
  amountDue: number;
} {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(params.nextPaymentDue);
  dueDate.setHours(0, 0, 0, 0);

  const daysRemaining = Math.max(
    0,
    Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
  );

  const newDailyRate = getDailyRate(params.newPlanPrice, params.newBillingPeriod);
  const currentDailyRate = getDailyRate(params.currentPlanPrice, params.currentBillingPeriod);
  const dailyRateDifference = newDailyRate - currentDailyRate;

  return {
    daysRemaining,
    dailyRateDifference,
    amountDue: Math.max(0, dailyRateDifference * daysRemaining),
  };
}

export function getUpgradeLimit(billingPeriod: 'monthly' | 'quarterly' | 'annual'): number {
  return billingPeriod === 'annual' ? 2 : 1;
}

export function canUpgrade(params: {
  currentPlanRank: number;
  requestedPlanRank: number;
  upgradeCountThisPeriod: number;
  billingPeriod: 'monthly' | 'quarterly' | 'annual';
  /** When true, fixed-plan upgrades are not allowed — tier follows student count. */
  isPaygCenter?: boolean;
}): { allowed: boolean; reason?: string } {
  if (params.isPaygCenter) {
    return { allowed: false, reason: 'Pay As You Go plans scale automatically with student count' };
  }
  if (params.requestedPlanRank <= params.currentPlanRank) {
    return { allowed: false, reason: 'Use the downgrade flow for lower plans' };
  }
  if (params.requestedPlanRank === 6) {
    return { allowed: false, reason: 'Top Centers plan requires manual approval' };
  }

  const limit = getUpgradeLimit(params.billingPeriod);
  if (params.upgradeCountThisPeriod >= limit) {
    return {
      allowed: false,
      reason: `Upgrade limit reached for this billing period (${limit} per period)`,
    };
  }

  return { allowed: true };
}

export async function getCreditBalance(centerId: string, supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase
    .from('centers')
    .select('credit_balance')
    .eq('id', centerId)
    .maybeSingle();
  return Number(data?.credit_balance ?? 0);
}

/** FIFO atomic spend — call only after Paymob success or explicit credit-only flows. */
export async function spendCredits(params: {
  centerId: string;
  amount: number;
  referenceId: string;
  referenceType: string;
  supabase: SupabaseClient;
}): Promise<boolean> {
  const { error } = await params.supabase.rpc('spend_credits_atomic', {
    p_center_id: params.centerId,
    p_amount: params.amount,
    p_reference_id: params.referenceId,
    p_reference_type: params.referenceType,
  });
  if (error) throw new Error(`spendCredits failed: ${error.message}`);
  return true;
}

export async function earnCredits(params: {
  centerId: string;
  amount: number;
  referenceId: string;
  referenceType: string;
  supabase: SupabaseClient;
}): Promise<number> {
  const { data, error } = await params.supabase.rpc('earn_credits_atomic', {
    p_center_id: params.centerId,
    p_amount: params.amount,
    p_reference_id: params.referenceId,
    p_reference_type: params.referenceType,
  });
  if (error) throw new Error(`earnCredits failed: ${error.message}`);
  return Number(data);
}

export { getPaygTier, calculatePaygBill } from '@/lib/paygBilling';
