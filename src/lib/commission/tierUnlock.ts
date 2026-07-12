// src/lib/commission/tierUnlock.ts
//
// Shared candidate loading + amount recompute for the T2 (180-day) and loyalty
// (365-day) unlock crons. Owner-polymorphic: centers embed their billing state via the
// existing FK; teachers are loaded in a second pass (commissions.teacher_id and
// teacher_subscriptions.teacher_id both FK teacher_profiles, so PostgREST can't embed
// one from the other). REQUIRES SIGN-OFF — feeds the amounts a rep/manager is paid.

import type { SupabaseClient } from '@supabase/supabase-js'
import { computeActiveDaysFromFirstPayment, parseClockPauseLog } from '@/lib/commissionActiveDays'
import { OVERRIDE_RATE, computeT2AtCurrentPrice, computeLoyalty, computeLoyaltyOverride } from '@/lib/commission/rates'
import { resolveOwnerMonthlyPrice, firstTwelveMonthsRevenue } from '@/lib/commission/ownerFinancials'

export type StatusField = 't2_status' | 'loyalty_bonus_status'

export interface TierCandidate {
  id: string
  staff_id: string
  commission_type: string
  ownerType: 'center' | 'teacher'
  ownerId: string
  firstPaymentDate: string
  activeDays: number
}

/** A row is "live enough" to unlock: billing active/paid AND not lapsed >14 days. */
function ownerIsLive(billingActive: boolean, nextDue: string | null): boolean {
  if (!billingActive) return false
  if (!nextDue) return false
  const due = new Date(nextDue)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 14)
  return !(due < cutoff)
}

/**
 * Locked candidate rows (centers + teachers) that have reached `threshold` active days.
 * The caller decides unlock vs forfeit (staff termination) and the recomputed amount.
 */
export async function loadTierCandidates(
  client: SupabaseClient,
  statusField: StatusField,
  threshold: number,
): Promise<TierCandidate[]> {
  const out: TierCandidate[] = []

  // ── Centers (embed billing state via the center_id FK) ──
  const { data: centerRows } = await client
    .from('commissions')
    .select(
      `id, staff_id, commission_type, center_id, center_first_payment_date, clock_pause_log,
       centers!inner(billing_status, next_payment_due)`,
    )
    .eq(statusField, 'locked')
    .not('center_first_payment_date', 'is', null)
    .not('staff_id', 'is', null)
    .not('center_id', 'is', null)

  for (const r of (centerRows ?? []) as Record<string, unknown>[]) {
    const center = (Array.isArray(r.centers) ? r.centers[0] : r.centers) as
      | { billing_status?: string; next_payment_due?: string | null }
      | undefined
    if (!center) continue
    if (!ownerIsLive(['active', 'paid'].includes(String(center.billing_status)), center.next_payment_due ?? null)) continue
    const firstPaymentDate = String(r.center_first_payment_date)
    const activeDays = computeActiveDaysFromFirstPayment(firstPaymentDate, parseClockPauseLog(r.clock_pause_log))
    if (activeDays < threshold) continue
    out.push({
      id: String(r.id),
      staff_id: String(r.staff_id),
      commission_type: String(r.commission_type),
      ownerType: 'center',
      ownerId: String(r.center_id),
      firstPaymentDate,
      activeDays,
    })
  }

  // ── Teachers (two-step: load rows, then their subscription state) ──
  const { data: teacherRows } = await client
    .from('commissions')
    .select('id, staff_id, commission_type, teacher_id, center_first_payment_date, clock_pause_log')
    .eq(statusField, 'locked')
    .not('center_first_payment_date', 'is', null)
    .not('staff_id', 'is', null)
    .not('teacher_id', 'is', null)

  const tRows = (teacherRows ?? []) as Record<string, unknown>[]
  if (tRows.length > 0) {
    const teacherIds = [...new Set(tRows.map((r) => String(r.teacher_id)))]
    const { data: subs } = await client
      .from('teacher_subscriptions')
      .select('teacher_id, status, next_billing_at')
      .in('teacher_id', teacherIds)
    const subMap = new Map(
      ((subs ?? []) as { teacher_id: string; status?: string; next_billing_at?: string | null }[]).map((s) => [
        String(s.teacher_id),
        s,
      ]),
    )
    for (const r of tRows) {
      const sub = subMap.get(String(r.teacher_id))
      if (!sub) continue
      // Teacher "live" = an active (paying) subscription, mirroring the center
      // active/paid gate; next_billing_at is the freshness anchor.
      if (!ownerIsLive(String(sub.status) === 'active', sub.next_billing_at ?? null)) continue
      const firstPaymentDate = String(r.center_first_payment_date)
      const activeDays = computeActiveDaysFromFirstPayment(firstPaymentDate, parseClockPauseLog(r.clock_pause_log))
      if (activeDays < threshold) continue
      out.push({
        id: String(r.id),
        staff_id: String(r.staff_id),
        commission_type: String(r.commission_type),
        ownerType: 'teacher',
        ownerId: String(r.teacher_id),
        firstPaymentDate,
        activeDays,
      })
    }
  }

  return out
}

/** T2 second-half amount recomputed at the owner's CURRENT price. */
export async function recomputeT2Amount(client: SupabaseClient, c: TierCandidate): Promise<number> {
  const priced = await resolveOwnerMonthlyPrice(client, c.ownerType, c.ownerId)
  const repT2 = computeT2AtCurrentPrice(priced?.monthly ?? 0)
  return c.commission_type === 'override' ? Math.round(repT2 * OVERRIDE_RATE * 100) / 100 : repT2
}

/** Loyalty amount = 1% of first-12-months revenue (override rows get 20% of that). */
export async function recomputeLoyaltyAmount(client: SupabaseClient, c: TierCandidate): Promise<number> {
  const revenue = await firstTwelveMonthsRevenue(client, c.ownerType, c.ownerId, c.firstPaymentDate)
  const repLoyalty = computeLoyalty(revenue)
  return c.commission_type === 'override' ? computeLoyaltyOverride(repLoyalty) : repLoyalty
}
