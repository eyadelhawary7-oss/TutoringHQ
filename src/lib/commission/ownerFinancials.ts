// src/lib/commission/ownerFinancials.ts
//
// Money-track owner financials — the two DB reads the commission engine + crons need,
// as client-param functions (so the cron's own service client and the engine's admin
// proxy can both call them). REQUIRES SIGN-OFF (feeds paid amounts).

import type { SupabaseClient } from '@supabase/supabase-js'
import { getImpliedMonthlyMrr, type ImpliedMrrCenterFields } from '@/lib/pricing'
import { getTeacherPlan } from '@/lib/teacherPlans'
import { addMonthsToDateStr } from '@/lib/subscriptionAnchor'

export type OwnerType = 'center' | 'teacher'

const CENTER_MRR_FIELDS =
  'id, plan, all_in_price, billing_period, status, billing_type, is_early_adopter, early_adopter_price, is_test'

/**
 * The customer's current monthly plan price (post-discount) — the 20% commission base.
 * Center: canonical implied MRR (period + discount aware; 0 for test/ineligible).
 * Teacher: live `price_gross`, falling back to the plan list price.
 */
export async function resolveOwnerMonthlyPrice(
  client: SupabaseClient,
  ownerType: OwnerType,
  ownerId: string,
): Promise<{ monthly: number; planKey: string } | null> {
  if (ownerType === 'center') {
    const { data } = await client.from('centers').select(CENTER_MRR_FIELDS).eq('id', ownerId).maybeSingle()
    if (!data) return null
    const row = data as ImpliedMrrCenterFields & { plan?: string | null }
    return { monthly: getImpliedMonthlyMrr(row), planKey: String(row.plan ?? 'starter') }
  }
  const { data } = await client
    .from('teacher_subscriptions')
    .select('plan_key, price_gross')
    .eq('teacher_id', ownerId)
    .maybeSingle()
  if (!data) return null
  const row = data as { plan_key?: string | null; price_gross?: number | string | null }
  const planKey = String(row.plan_key ?? 'teacher_standard')
  const priceGross = Number(row.price_gross ?? 0)
  const monthly = priceGross > 0 ? priceGross : getTeacherPlan(planKey).priceGross
  return { monthly, planKey }
}

/**
 * Realized revenue in the owner's first 12 months = Σ COALESCE(payment_amount,
 * total_amount) over PAID invoices with paid_at in [firstPaymentDate, +12 months).
 * The base for the 1% loyalty bonus. Returns 0 when the window/owner is unresolved.
 */
export async function firstTwelveMonthsRevenue(
  client: SupabaseClient,
  ownerType: OwnerType,
  ownerId: string,
  firstPaymentDate: string | null | undefined,
): Promise<number> {
  if (!firstPaymentDate) return 0
  const endExclusive = addMonthsToDateStr(firstPaymentDate, 12)
  const ownerCol = ownerType === 'center' ? 'center_id' : 'teacher_id'
  const { data } = await client
    .from('invoices')
    .select('payment_amount, total_amount, paid_at')
    .eq(ownerCol, ownerId)
    .eq('status', 'paid')
    .gte('paid_at', firstPaymentDate)
    .lt('paid_at', endExclusive)
  let sum = 0
  for (const r of (data ?? []) as { payment_amount?: number | string | null; total_amount?: number | string | null }[]) {
    const amt = r.payment_amount != null ? Number(r.payment_amount) : Number(r.total_amount ?? 0)
    if (Number.isFinite(amt) && amt > 0) sum += amt
  }
  return sum
}
