// Scheduled plan-change application for CENTERS (the teacher equivalent lives in
// midnightBillingAdapter). A plan change is recorded on centers.scheduled_plan /
// scheduled_billing_period and LANDS only at the renewal boundary (G1/G5): the
// renewal invoice bills the scheduled plan's amount, and the center's plan
// fields flip to it exactly when that invoice is paid — never sooner.
//
// Direction-agnostic: `scheduled_plan` holds whichever plan the customer most
// recently asked for, lower (a downgrade, scheduled by the downgrade route) or
// higher (a day-zero upgrade — see /api/billing/upgrade). A plain column write
// is naturally last-write-wins: scheduling one overwrites whatever the other
// had pending, since only one plan can occupy the renewal slot. A downgrade
// carries no credit ever (G3/G4); an upgrade's day-zero rule prices the full
// new-tier period with no proration, since there is nothing left to prorate.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getChargeFromQuarterlyAllIn,
  isPlanKey,
  normalizeBillingPeriod,
  PLANS,
  type BillingPeriod,
  type PlanKey,
} from '@/lib/pricing';

export interface ScheduledCenterPlanChange {
  plan: string;
  billingPeriod: BillingPeriod;
  allIn: number;
  /** One cycle's charge for the scheduled plan at the scheduled interval. */
  billingAmount: number;
}

/**
 * Resolve the scheduled plan's price (all_in + one-cycle billing amount) for a
 * center, or null if there is no pending schedule. Reads pricing_plans (live)
 * and falls back to the PLANS constant. Direction-agnostic: `scheduledPlan` may
 * be higher OR lower than the center's current plan — this only prices it.
 */
export async function resolveScheduledCenterPlanChange(
  supabase: SupabaseClient,
  scheduledPlan: string | null | undefined,
  scheduledBillingPeriod: string | null | undefined,
): Promise<ScheduledCenterPlanChange | null> {
  if (!scheduledPlan || !isPlanKey(scheduledPlan) || scheduledPlan === 'top_centers') return null;
  // Quarterly is retired — a stale scheduled_billing_period value coerces to
  // monthly so the apply-write below can't violate the centers CHECKs.
  const normalized = normalizeBillingPeriod(scheduledBillingPeriod);
  const bp = normalized === 'annual' ? 'annual' : 'monthly';
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
 * Flip a center to its scheduled plan at the renewal moment and clear the
 * schedule. Called from the subscription-invoice-paid finalize, so whichever
 * plan was in force before this point — higher or lower — stayed in force
 * right up to this moment (G5). No credit is ever involved for a downgrade
 * (G3/G4); an upgrade's charge was already collected via the (re)priced
 * renewal invoice itself, not here.
 */
export async function applyScheduledCenterPlanChange(
  supabase: SupabaseClient,
  centerId: string,
  sched: ScheduledCenterPlanChange,
): Promise<void> {
  await supabase
    .from('centers')
    .update({
      plan: sched.plan,
      // subscription_billing_period CHECK allows {monthly, yearly}; billing_period {monthly, annual}.
      subscription_billing_period: sched.billingPeriod === 'annual' ? 'yearly' : 'monthly',
      billing_period: sched.billingPeriod,
      all_in_price: sched.allIn,
      billing_amount: sched.billingAmount,
      scheduled_plan: null,
      scheduled_billing_period: null,
    })
    .eq('id', centerId);
}
