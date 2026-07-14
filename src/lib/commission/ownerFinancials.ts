// src/lib/commission/ownerFinancials.ts
//
// Money-track owner financials — the two DB reads the commission engine + crons need,
// as client-param functions (so the cron's own service client and the engine's admin
// proxy can both call them). REQUIRES SIGN-OFF (feeds paid amounts).

import type { SupabaseClient } from '@supabase/supabase-js'
import { getImpliedMonthlyMrr, type ImpliedMrrCenterFields } from '@/lib/pricing'
import { getTeacherPlan } from '@/lib/teacherPlans'
import { addMonthsToDateStr } from '@/lib/subscriptionAnchor'
import { round2 } from '@/lib/commission/rates'

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
 * Effective one-time promo discount FRACTION [0,1) actually charged on the owner's FIRST paid
 * invoice, derived from real amounts: (promo_original_amount − total_amount) / promo_original_amount.
 * 0 when there was no promo. Promo codes apply ONLY to the signup first payment
 * (`redeemPromoCodeForPaymobOrder` → `invoice_type='signup_first_payment'`), so this fraction
 * is a one-time signup discount — it never touches renewals.
 *
 * For a percentage promo charged on the whole first invoice the flat processing fee scales with
 * it, so this fraction equals the promo %, and `planPrice × (1 − fraction)` is the plan price
 * actually paid after the promo. (If a promo were ever applied to the plan only, this fraction
 * is marginally smaller than the promo %, i.e. conservative — it can only reduce the rep base.)
 */
async function firstPaymentPromoFraction(
  client: SupabaseClient,
  ownerType: OwnerType,
  ownerId: string,
): Promise<number> {
  const ownerCol = ownerType === 'center' ? 'center_id' : 'teacher_id'
  const { data } = await client
    .from('invoices')
    .select('promo_code, promo_original_amount, total_amount, paid_at')
    .eq(ownerCol, ownerId)
    .eq('status', 'paid')
    .not('promo_code', 'is', null)
    .order('paid_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!data) return 0
  const row = data as {
    promo_code?: string | null
    promo_original_amount?: number | string | null
    total_amount?: number | string | null
  }
  if (!row.promo_code) return 0
  const original = Number(row.promo_original_amount ?? 0)
  const total = Number(row.total_amount ?? 0)
  // Only a real, sane discount counts (0 < discount < original).
  if (!(original > 0) || !(total >= 0) || total >= original) return 0
  const fraction = (original - total) / original
  return fraction > 0 && fraction < 1 ? fraction : 0
}

/**
 * The per-month plan price the owner ACTUALLY paid at CONVERSION, after any one-time promo —
 * the base for the rep's FIRST half (T1). It starts from the standing monthly rate
 * (`resolveOwnerMonthlyPrice`: post-negotiation `all_in_price` / `early_adopter_price`,
 * annual-aware) and scales it down by the promo fraction charged on the first invoice.
 *
 * The SECOND half (T2) is deliberately NOT computed here: the T2 cron recomputes it from the
 * CURRENT standing price at the 6-month mark, and since the promo is one-time (signup only) the
 * customer is paying full price by then — exactly "the actual price at that point".
 */
export async function resolveOwnerConversionMonthlyPrice(
  client: SupabaseClient,
  ownerType: OwnerType,
  ownerId: string,
): Promise<{ monthly: number; planKey: string; promoFraction: number } | null> {
  const standing = await resolveOwnerMonthlyPrice(client, ownerType, ownerId)
  if (!standing) return null
  const promoFraction = await firstPaymentPromoFraction(client, ownerType, ownerId)
  const monthly = promoFraction > 0 ? round2(standing.monthly * (1 - promoFraction)) : standing.monthly
  return { monthly, planKey: standing.planKey, promoFraction }
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
