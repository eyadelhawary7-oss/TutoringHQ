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
 * @param periodChargeAmount - full amount for one billing cycle (e.g. from getChargeFromQuarterlyAllIn).
 * Annual discount is applied in pricing before this call, not inside getDailyRate.
 */
export function getDailyRate(
  periodChargeAmount: number,
  billingPeriod: 'monthly' | 'quarterly' | 'annual',
): number {
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
  // Single-day lock model (src/lib/billingLifecycle.ts, rule 4): coming back from a
  // lock charges the PLAIN subscription only — no fine, no reactivation fee, no
  // surcharge. tier/dailyRate are retained in the signature for callers but no
  // longer affect the amount.
  const nextPeriodAmount = Number(params.nextPeriodAmount) || 0;
  return {
    fine: 0,
    reactivationFee: 0,
    nextPeriod: nextPeriodAmount,
    total: nextPeriodAmount,
    breakdown: 'Plain subscription (no reactivation fee)',
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

/** Whole calendar days from today (00:00) until `nextPaymentDue` (00:00), floored at 0. */
export function daysRemainingUntil(nextPaymentDue: Date, now: Date = new Date()): number {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const due = new Date(nextPaymentDue);
  due.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
}

/**
 * Shared monthly→annual interval-switch charge (centers AND teachers, one path).
 *
 * Rule 2: pay the annual price NOW, crediting the unused part of the current paid
 * period; the annual term starts now and renews in 12 months. The credit is the
 * real money already paid for the days not yet used on the OLD plan, and it can
 * only REDUCE this charge — never go negative, never become a balance (G3/G4).
 *
 * G9: during the free summer window no money is being paid, so there is no paid
 * time to credit — `summerHoldsCharges` forces the credit to 0.
 *
 * @param annualFullPrice    the new annual term's full price (e.g. monthly × 10)
 * @param currentPeriodPrice the full price of the current paid period (the old plan)
 * @param currentBillingPeriod cadence of the current period (normally 'monthly')
 * @param nextPaymentDue     end of the current paid period (credit basis)
 */
export function getSwitchToAnnualCharge(params: {
  annualFullPrice: number;
  currentPeriodPrice: number;
  currentBillingPeriod: 'monthly' | 'quarterly' | 'annual';
  nextPaymentDue: Date;
  summerHoldsCharges?: boolean;
  now?: Date;
}): { daysRemaining: number; credit: number; charge: number } {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const daysRemaining = daysRemainingUntil(params.nextPaymentDue, params.now ?? new Date());
  const currentDaily = getDailyRate(params.currentPeriodPrice, params.currentBillingPeriod);
  // G9: no paid time during the held summer window → zero credit.
  // G3/G4: credit is capped at the unused paid value and can only reduce the charge.
  const credit = params.summerHoldsCharges
    ? 0
    : Math.max(0, round2(currentDaily * daysRemaining));
  const charge = Math.max(0, round2(params.annualFullPrice - credit));
  return { daysRemaining, credit, charge };
}

export function getUpgradeLimit(billingPeriod: 'monthly' | 'quarterly' | 'annual'): number {
  return billingPeriod === 'annual' ? 2 : 1;
}

export function canUpgrade(params: {
  currentPlanRank: number;
  requestedPlanRank: number;
  upgradeCountThisPeriod: number;
  billingPeriod: 'monthly' | 'quarterly' | 'annual';
}): { allowed: boolean; reason?: string } {
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

/** FIFO atomic spend - call only after Paymob success or explicit credit-only flows. */
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
