// Scheduled-downgrade application for CENTERS (the teacher equivalent lives in
// midnightBillingAdapter). A downgrade is recorded on centers.scheduled_plan /
// scheduled_billing_period by the downgrade route and LANDS only at the renewal
// boundary (G1/G5): the renewal invoice bills the scheduled (lower) plan's amount,
// and the center's plan fields flip to it exactly when that invoice is paid — never
// sooner. No credit is ever involved (G3/G4).

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getChargeFromQuarterlyAllIn,
  isPlanKey,
  normalizeBillingPeriod,
  PLANS,
  type BillingPeriod,
  type PlanKey,
} from '@/lib/pricing';

export interface ScheduledCenterDowngrade {
  plan: string;
  billingPeriod: BillingPeriod;
  allIn: number;
  /** One cycle's charge for the scheduled plan at the scheduled interval. */
  billingAmount: number;
}

/**
 * Resolve the scheduled plan's price (all_in + one-cycle billing amount) for a
 * center, or null if there is no pending downgrade. Reads pricing_plans (live) and
 * falls back to the PLANS constant.
 */
export async function resolveScheduledCenterDowngrade(
  supabase: SupabaseClient,
  scheduledPlan: string | null | undefined,
  scheduledBillingPeriod: string | null | undefined,
): Promise<ScheduledCenterDowngrade | null> {
  if (!scheduledPlan || !isPlanKey(scheduledPlan) || scheduledPlan === 'top_centers') return null;
  const bp = normalizeBillingPeriod(scheduledBillingPeriod);
  const { data } = await supabase
    .from('pricing_plans')
    .select('all_in_price')
    .eq('plan_key', scheduledPlan)
    .eq('is_active', true)
    .maybeSingle();
  const fromDb = Number((data as { all_in_price?: number } | null)?.all_in_price ?? 0);
  const allIn =
    (Number.isFinite(fromDb) && fromDb > 0 ? fromDb : PLANS[scheduledPlan as PlanKey]?.quarterlyAllIn) ?? 0;
  if (!Number.isFinite(allIn) || allIn <= 0) return null;
  const billingAmount = getChargeFromQuarterlyAllIn(allIn, bp, scheduledPlan as PlanKey);
  return { plan: scheduledPlan, billingPeriod: bp, allIn, billingAmount };
}

/**
 * Flip a center to its scheduled (lower) plan at the renewal moment and clear the
 * schedule. Called from the subscription-invoice-paid finalize, so the higher plan,
 * its limits and its price all stayed in force right up to this point (G5).
 */
export async function applyScheduledCenterDowngrade(
  supabase: SupabaseClient,
  centerId: string,
  sched: ScheduledCenterDowngrade,
): Promise<void> {
  await supabase
    .from('centers')
    .update({
      plan: sched.plan,
      subscription_billing_period: sched.billingPeriod,
      billing_period: sched.billingPeriod,
      all_in_price: sched.allIn,
      billing_amount: sched.billingAmount,
      scheduled_plan: null,
      scheduled_billing_period: null,
    })
    .eq('id', centerId);
}
