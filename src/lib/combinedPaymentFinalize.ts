import type { SupabaseClient } from '@supabase/supabase-js';
import { todayISO } from '@/lib/parentPack';
import {
  getChargeFromQuarterlyAllIn,
  isPlanKey,
  normalizeBillingPeriod,
  type BillingPeriod,
  type PlanKey,
} from '@/lib/pricing';
import { spendCredits } from '@/lib/billingEngine';
import {
  anchorYmdFromCenter,
  autoSuspendAtFromDue,
  billingStepMonths,
  nextAnchorDueStrictlyAfter,
} from '@/lib/billingSchedule';

export type CombinedSessionMetadata = {
  newPlan?: string;
  newBillingPeriod?: string;
  previousPlan?: string;
  previousBillingPeriod?: string;
  daysRemaining?: number;
  dailyRateDifference?: number;
  amountCharged?: number;
  billingAnchorYmd?: string;
};

function asMeta(raw: unknown): CombinedSessionMetadata {
  return raw && typeof raw === 'object' ? (raw as CombinedSessionMetadata) : {};
}

export async function reactivateCenterFromSession(
  supabase: SupabaseClient,
  centerId: string,
): Promise<void> {
  const { data: center } = await supabase
    .from('centers')
    .select(
      'next_payment_due, subscription_start_date, billing_cycle_start, approved_at, subscription_billing_period, billing_period',
    )
    .eq('id', centerId)
    .maybeSingle();

  const c = center as {
    next_payment_due?: string | null;
    subscription_start_date?: string | null;
    billing_cycle_start?: string | null;
    approved_at?: string | null;
    subscription_billing_period?: string | null;
    billing_period?: string | null;
  } | null;

  if (!c) return;

  const today = todayISO();
  const anchor = anchorYmdFromCenter(c);
  const step = billingStepMonths(c.subscription_billing_period ?? c.billing_period);
  const existingDue = c.next_payment_due?.slice(0, 10);
  const nextDue =
    existingDue && existingDue > today
      ? existingDue
      : nextAnchorDueStrictlyAfter(anchor, step, today);

  await supabase
    .from('centers')
    .update({
      status: 'active',
      subscription_status: 'active',
      billing_status: 'active',
      next_payment_due: nextDue,
      suspended_at: null,
      reactivation_tier: null,
      reactivation_fee_amount: 0,
      auto_suspend_at: autoSuspendAtFromDue(nextDue),
    })
    .eq('id', centerId);
}

/**
 * Paymob success: finalize pending combined_payment_sessions row (upgrade / reactivation).
 * Returns true if this order was a combined session (handled or already paid).
 */
export async function tryFinalizeCombinedPaymentSession(
  supabase: SupabaseClient,
  paymobOrderId: string,
  paymobTransactionId: string,
): Promise<boolean> {
  const { data: session } = await supabase
    .from('combined_payment_sessions')
    .select('*')
    .eq('paymob_order_id', paymobOrderId)
    .maybeSingle();

  if (!session) return false;

  const row = session as {
    id: string;
    center_id: string;
    status: string;
    session_type: string;
    credit_amount: number | string | null;
    invoice_ids: string[] | null;
    metadata?: unknown;
  };

  if (row.status === 'paid') return true;
  if (row.status !== 'pending') return false;

  const handled = new Set(['upgrade', 'reactivation_tier1', 'reactivation_tier2']);
  if (!handled.has(row.session_type)) return false;

  const creditToSpend = Number(row.credit_amount ?? 0);
  const meta = asMeta(row.metadata);

  if (creditToSpend > 0) {
    await spendCredits({
      centerId: row.center_id,
      amount: creditToSpend,
      referenceId: row.id,
      referenceType: 'subscription',
      supabase,
    });
  }

  const st = row.session_type as string;

  if (st === 'upgrade') {
    const newPlan = meta.newPlan;
    const newPeriodRaw = meta.newBillingPeriod;
    if (!newPlan || !newPeriodRaw) {
      console.error('[combinedPayment] upgrade missing metadata', row.id);
      return true;
    }

    const newBp = normalizeBillingPeriod(newPeriodRaw) as BillingPeriod;
    const pk = isPlanKey(newPlan) ? newPlan : null;
    if (!pk) {
      console.error('[combinedPayment] invalid newPlan', newPlan);
      return true;
    }

    const { data: priceRow } = await supabase
      .from('pricing_plans')
      .select('all_in_price, plan_key')
      .eq('plan_key', newPlan)
      .eq('is_active', true)
      .maybeSingle();

    const allIn = Number((priceRow as { all_in_price?: number } | null)?.all_in_price ?? 0);
    if (!Number.isFinite(allIn) || allIn <= 0) {
      console.error('[combinedPayment] invalid pricing row', newPlan);
      return true;
    }

    const billingAmount = getChargeFromQuarterlyAllIn(allIn, newBp, pk);

    const { data: centerBefore } = await supabase
      .from('centers')
      .select('upgrade_count_this_period, next_payment_due')
      .eq('id', row.center_id)
      .maybeSingle();

    const prevCount = Number((centerBefore as { upgrade_count_this_period?: number } | null)?.upgrade_count_this_period ?? 0);
    const anchorYmd =
      meta.billingAnchorYmd ??
      (centerBefore as { next_payment_due?: string | null } | null)?.next_payment_due?.slice(0, 10) ??
      todayISO();

    await supabase
      .from('centers')
      .update({
        plan: newPlan,
        subscription_billing_period: newBp,
        billing_period: newBp,
        all_in_price: allIn,
        billing_amount: billingAmount,
        billing_status: 'paid',
        upgrade_count_this_period: prevCount + 1,
      })
      .eq('id', row.center_id);

    const invIds = Array.isArray(row.invoice_ids) ? row.invoice_ids : [];
    for (const invId of invIds) {
      await supabase
        .from('invoices')
        .update({
          status: 'paid',
          payment_method: 'paymob',
          payment_reference: paymobTransactionId,
          paymob_transaction_id: paymobTransactionId,
          paid_at: new Date().toISOString(),
        })
        .eq('id', invId)
        .eq('center_id', row.center_id);
    }

    await supabase.from('upgrade_log').insert({
      center_id: row.center_id,
      previous_plan: meta.previousPlan ?? '—',
      new_plan: newPlan,
      previous_period: meta.previousBillingPeriod ?? 'quarterly',
      new_period: newBp,
      days_remaining: Math.max(0, Math.floor(Number(meta.daysRemaining ?? 0))),
      daily_rate_difference: Number(meta.dailyRateDifference ?? 0),
      amount_charged: Number(meta.amountCharged ?? 0),
      paymob_order_id: paymobOrderId,
      billing_anchor_unchanged: anchorYmd,
      upgrade_count_this_cycle: prevCount + 1,
    });
  }

  if (st === 'reactivation_tier1' || st === 'reactivation_tier2') {
    await reactivateCenterFromSession(supabase, row.center_id);
  }

  await supabase
    .from('combined_payment_sessions')
    .update({ status: 'paid' })
    .eq('id', row.id);

  return true;
}
