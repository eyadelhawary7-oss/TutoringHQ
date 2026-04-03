/**
 * Core billing calculations and credit ledger helpers (single source of truth).
 * Rules: Paymob order_id is idempotency key; spend credits only after payment success (or credit-only flows).
 * FIFO batches by created_at; earned rows carry expires_at (null = no expiry). DB migrations may use clock_timestamp() for ledger created_at.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export function getDailyRate(
  planPrice: number,
  billingPeriod: 'monthly' | 'quarterly' | 'annual',
): number {
  const days = { monthly: 30, quarterly: 90, annual: 365 };
  return planPrice / days[billingPeriod];
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

  const periodDays = { monthly: 30, quarterly: 90, annual: 365 };
  const days = periodDays[params.newBillingPeriod];

  const newDailyRate = params.newPlanPrice / days;
  const currentDailyRate = params.currentPlanPrice / days;
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

/** FIFO: spend oldest non-expired credits first. Call only after Paymob success or credit-only payment. */
export async function spendCredits(params: {
  centerId: string;
  amount: number;
  referenceId: string;
  referenceType: string;
  supabase: SupabaseClient;
}): Promise<{ spent: number; insufficient: boolean }> {
  const nowMs = Date.now();
  const { centerId, amount, referenceId, referenceType, supabase } = params;

  const { data: batchRows } = await supabase
    .from('credit_ledger')
    .select('id, amount, expires_at')
    .eq('center_id', centerId)
    .eq('type', 'earned')
    .gt('amount', 0)
    .order('created_at', { ascending: true });

  const batches = (batchRows ?? []).filter((b) => {
    const ex = (b as { expires_at?: string | null }).expires_at;
    if (ex == null) return true;
    return new Date(ex).getTime() > nowMs;
  });

  if (batches.length === 0) {
    return { spent: 0, insufficient: true };
  }

  let remaining = amount;
  let totalSpent = 0;

  for (const batch of batches) {
    if (remaining <= 0) break;
    const batchAmount = Number(batch.amount);
    const useFromBatch = Math.min(batchAmount, remaining);

    await supabase
      .from('credit_ledger')
      .update({ amount: batchAmount - useFromBatch })
      .eq('id', batch.id);

    await supabase.from('credit_ledger').insert({
      center_id: centerId,
      amount: -useFromBatch,
      type: 'spent',
      reference_id: referenceId,
      reference_type: referenceType,
    });

    remaining -= useFromBatch;
    totalSpent += useFromBatch;
  }

  const { data: center } = await supabase
    .from('centers')
    .select('credit_balance')
    .eq('id', centerId)
    .maybeSingle();
  const newBalance = Math.max(0, Number(center?.credit_balance ?? 0) - totalSpent);
  await supabase.from('centers').update({ credit_balance: newBalance }).eq('id', centerId);

  return { spent: totalSpent, insufficient: remaining > 0 };
}

export async function earnCredits(params: {
  centerId: string;
  amount: number;
  referenceId: string;
  referenceType: string;
  supabase: SupabaseClient;
}): Promise<void> {
  const { centerId, amount, referenceId, referenceType, supabase } = params;
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + 6);

  await supabase.from('credit_ledger').insert({
    center_id: centerId,
    amount,
    type: 'earned',
    reference_id: referenceId,
    reference_type: referenceType,
    expires_at: expiresAt.toISOString(),
  });

  const { data: center } = await supabase
    .from('centers')
    .select('credit_balance')
    .eq('id', centerId)
    .maybeSingle();

  const { data: planData } = await supabase
    .from('centers')
    .select('all_in_price')
    .eq('id', centerId)
    .maybeSingle();

  const maxBalance = Number(planData?.all_in_price ?? 0) * 3;
  const newBalance = Math.min(maxBalance, Number(center?.credit_balance ?? 0) + amount);

  await supabase.from('centers').update({ credit_balance: newBalance }).eq('id', centerId);
}
