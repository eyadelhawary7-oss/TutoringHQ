// src/lib/commissions.ts
//
// Money-track commission engine (v2). REQUIRES SIGN-OFF — every amount here changes
// what a rep/manager is PAID. The pure amount math lives in `@/lib/commission/rates`;
// this file is the DB layer (create / convert / clawback / clock / reassign).
//
// Model (replaces the old fixed-EGP COMMISSION_TABLE):
//   • rep      = 20% of the customer's monthly plan price (post-discount), split into
//                two equal halves — T1 at conversion, T2 at 180 active days recomputed
//                at the CURRENT plan price (the T2 cron does the recompute).
//   • loyalty  = 1% of realized first-12-months revenue, unlocked at 365 active days
//                (the loyalty cron computes the amount from real paid invoices).
//   • override = manager gets 20% of the rep's commission AND 20% of the rep's loyalty.
//   • Owners are polymorphic: 'center' (center_id) or 'teacher' (teacher_id). Same rules.
//
// Dedup: uses explicit INSERT + 23505-catch against the partial unique indexes
// (one_commission_per_{center,teacher}_staff_type / one_eyad_commission_per_*), NOT
// PostgREST upsert onConflict — a partial index can't be inferred by column list, which
// is what let the old `ignoreDuplicates` upsert fall through to a duplicate INSERT.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { computeRepCommission, computeOverride } from '@/lib/commission/rates'
import { resolveOwnerMonthlyPrice, type OwnerType as _OwnerType } from '@/lib/commission/ownerFinancials'

let cachedAdmin: SupabaseClient | null = null

function getAdminClient(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin
  cachedAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  return cachedAdmin
}

const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getAdminClient()
    const value = Reflect.get(client, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

export type OwnerType = _OwnerType

interface OwnerAssignment {
  staff_id: string | null
  sourced_by: string | null
  assignment_status: string | null
  referred_by_center: boolean
}

async function getOwnerAssignment(ownerType: OwnerType, ownerId: string): Promise<OwnerAssignment | null> {
  // Literal select strings per branch (a union select string trips the typed parser).
  const query =
    ownerType === 'center'
      ? supabaseAdmin
          .from('center_assignments')
          .select('staff_id, sourced_by, referred_by_center, assignment_status')
          .eq('center_id', ownerId)
      : supabaseAdmin.from('teacher_assignments').select('staff_id, sourced_by, assignment_status').eq('teacher_id', ownerId)
  const { data } = await query.eq('is_primary', true).maybeSingle()
  if (!data) return null
  const r = data as Record<string, unknown>
  return {
    staff_id: (r.staff_id as string | null) ?? null,
    sourced_by: (r.sourced_by as string | null) ?? null,
    assignment_status: (r.assignment_status as string | null) ?? null,
    referred_by_center: r.referred_by_center === true,
  }
}

/** owner_type-aware column pair for a commissions row. */
function ownerCols(ownerType: OwnerType, ownerId: string): Record<string, unknown> {
  return ownerType === 'center'
    ? { owner_type: 'center', center_id: ownerId, teacher_id: null }
    : { owner_type: 'teacher', center_id: null, teacher_id: ownerId }
}

/**
 * Insert a commission row, tolerating the unique-index race (idempotent re-runs).
 * Returns the new id, or null when an equivalent row already exists (23505).
 */
async function insertCommission(row: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('commissions').insert(row).select('id').single()
  if (error) {
    if ((error as { code?: string }).code === '23505') return null // already exists
    throw error
  }
  return (data as { id: string }).id
}

async function findCommissionId(
  ownerType: OwnerType,
  ownerId: string,
  staffId: string | null,
  commissionType: string,
): Promise<string | null> {
  const ownerCol = ownerType === 'center' ? 'center_id' : 'teacher_id'
  let q = supabaseAdmin.from('commissions').select('id').eq(ownerCol, ownerId).eq('commission_type', commissionType)
  q = staffId === null ? q.is('staff_id', null) : q.eq('staff_id', staffId)
  const { data } = await q.maybeSingle()
  return (data as { id?: string } | null)?.id ?? null
}

/**
 * Create the commission rows for an owner (center or teacher) at (re)assignment.
 * Idempotent: an existing row for (owner, staff, type) is left untouched. Amounts are
 * v2 (20% of monthly price, halved). Loyalty starts at 0/locked — the loyalty cron sets
 * the real 1%-of-12-months amount when it unlocks.
 */
export async function createCommissionsForOwner(ownerType: OwnerType, ownerId: string): Promise<void> {
  const priced = await resolveOwnerMonthlyPrice(supabaseAdmin, ownerType, ownerId)
  if (!priced) return
  const { monthly, planKey } = priced

  const assignment = await getOwnerAssignment(ownerType, ownerId)

  // Eyad-sourced (or unassigned) → a zero self-sourced row, so the owner still has a
  // single canonical commission record.
  if (!assignment || assignment.sourced_by === 'eyad') {
    await insertCommission({
      ...ownerCols(ownerType, ownerId),
      staff_id: null,
      role_at_time: 'eyad',
      commission_type: 'self_sourced',
      plan_at_signing: planKey,
      total_commission: 0,
      t1_amount: 0,
      t2_amount: 0,
      loyalty_bonus_amount: 0,
      t1_status: 'paid',
      t2_status: 'paid',
      loyalty_bonus_status: 'paid',
    })
    await logAudit({ action: 'commission_created_eyad', triggeredBy: 'system', newValue: { ownerType, sourced_by: 'eyad' } })
    return
  }

  // A center that was referred by another center pays no acquisition commission.
  if (ownerType === 'center' && assignment.referred_by_center) return

  if (assignment.assignment_status !== 'approved') return
  if (!assignment.staff_id) return

  const { data: staffMember } = await supabaseAdmin
    .from('staff')
    .select('id, role, reports_to')
    .eq('id', assignment.staff_id)
    .single()
  if (!staffMember) return

  const role = String((staffMember as { role?: string }).role ?? 'sr') as 'sm' | 'sr'
  const rep = computeRepCommission(monthly)

  const repId = await insertCommission({
    ...ownerCols(ownerType, ownerId),
    staff_id: staffMember.id,
    role_at_time: role,
    commission_type: 'self_sourced',
    plan_at_signing: planKey,
    total_commission: rep.total,
    t1_amount: rep.t1,
    t2_amount: rep.t2,
    loyalty_bonus_amount: 0,
  })
  const repCommissionId = repId ?? (await findCommissionId(ownerType, ownerId, staffMember.id, 'self_sourced'))
  if (repId) {
    await logAudit({
      commissionId: repId,
      action: 'commission_created',
      triggeredBy: 'system',
      newValue: { ownerType, role, plan: planKey, monthly, total: rep.total, t1: rep.t1, t2: rep.t2 },
    })
  }

  // Manager override — 20% of the rep's two halves. The loyalty override (20% of the
  // rep's loyalty) is added by the loyalty cron when the amount is known.
  const reportsTo = (staffMember as { reports_to?: string | null }).reports_to
  if (role === 'sr' && reportsTo) {
    const ov = computeOverride(rep.t1, rep.t2)
    const overrideId = await insertCommission({
      ...ownerCols(ownerType, ownerId),
      staff_id: reportsTo,
      role_at_time: 'sm',
      commission_type: 'override',
      parent_commission_id: repCommissionId,
      plan_at_signing: planKey,
      total_commission: ov.t1 + ov.t2,
      t1_amount: ov.t1,
      t2_amount: ov.t2,
      loyalty_bonus_amount: 0,
    })
    if (overrideId) {
      await logAudit({
        commissionId: overrideId,
        action: 'commission_created',
        triggeredBy: 'system',
        newValue: { ownerType, type: 'override', parent: repCommissionId, t1: ov.t1, t2: ov.t2 },
      })
    }
  }
}

/** Back-compat wrapper — existing callers pass a centerId. */
export async function createCommissionsForCenter(centerId: string): Promise<void> {
  return createCommissionsForOwner('center', centerId)
}

/** New: teacher conversion entry point (used by the payment finalizer). */
export async function createCommissionsForTeacher(teacherId: string): Promise<void> {
  return createCommissionsForOwner('teacher', teacherId)
}

/**
 * First real payment → T1 becomes eligible and the T2/loyalty clock starts
 * (center_first_payment_date). Idempotent: rows that already have a first-payment date
 * are skipped, so re-delivery (webhook + finalizer + autocharge) never re-triggers.
 */
export async function triggerT1EligibleForOwner(ownerType: OwnerType, ownerId: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  const ownerCol = ownerType === 'center' ? 'center_id' : 'teacher_id'
  const { data: rows } = await supabaseAdmin
    .from('commissions')
    .select('id, t1_status, center_first_payment_date')
    .eq(ownerCol, ownerId)
    .eq('t1_status', 'pending')
  for (const row of rows ?? []) {
    if ((row as { center_first_payment_date?: string | null }).center_first_payment_date) continue
    await supabaseAdmin
      .from('commissions')
      .update({ center_first_payment_date: today, t1_status: 'eligible' })
      .eq('id', (row as { id: string }).id)
    await logAudit({
      commissionId: (row as { id: string }).id,
      action: 't1_eligible_set',
      triggeredBy: 'webhook',
      previousValue: { t1_status: 'pending' },
      newValue: { t1_status: 'eligible', center_first_payment_date: today },
    })
  }
}

export async function triggerT1Eligible(centerId: string): Promise<void> {
  return triggerT1EligibleForOwner('center', centerId)
}

export async function triggerT1EligibleTeacher(teacherId: string): Promise<void> {
  return triggerT1EligibleForOwner('teacher', teacherId)
}

/**
 * Reassign an owner to a new rep: void the previous rep's still-UNEARNED tiers (never a
 * paid one — no double-pay, no clawing back earned money), then create fresh rows for the
 * new rep that INHERIT the first-payment clock (future eligibility transfers), and the new
 * rep's manager override. Idempotent-ish: a no-op when the new rep already owns the row.
 */
export async function reassignCommissions(
  ownerType: OwnerType,
  ownerId: string,
  newStaffId: string | null,
): Promise<void> {
  const ownerCol = ownerType === 'center' ? 'center_id' : 'teacher_id'

  // Preserve the clock anchor so the new rep inherits accrued active time.
  const { data: existing } = await supabaseAdmin
    .from('commissions')
    .select('id, staff_id, commission_type, t1_status, t2_status, loyalty_bonus_status, center_first_payment_date, role_at_time')
    .eq(ownerCol, ownerId)
  const rows = (existing ?? []) as {
    id: string
    staff_id: string | null
    commission_type: string
    t1_status: string
    t2_status: string
    loyalty_bonus_status: string
    center_first_payment_date: string | null
    role_at_time: string
  }[]

  const firstPaymentDate =
    rows.map((r) => r.center_first_payment_date).find((d) => d != null) ?? null

  // The incoming rep's manager: their override survives a SAME-manager reassignment
  // (rep A → rep B, both under M): voiding it would orphan M's override forever,
  // because the re-insert collides on the unique index and never revives the row.
  let newRepManager: string | null = null
  if (newStaffId) {
    const { data: st } = await supabaseAdmin
      .from('staff')
      .select('reports_to')
      .eq('id', newStaffId)
      .maybeSingle()
    newRepManager = (st as { reports_to?: string | null } | null)?.reports_to ?? null
  }

  // ONCE-PER-CUSTOMER guard: a tier already PAID to a prior rep/manager (incl. the
  // eyad zero-row, settled at 0 by design) must never become payable again on the
  // incoming rep's fresh row. Computed per family (rep vs override) from the
  // pre-reassignment snapshot.
  const priorPaid = (isOverride: boolean, tier: 't1_status' | 't2_status' | 'loyalty_bonus_status') =>
    rows.some(
      (r) =>
        (r.commission_type === 'override') === isOverride &&
        r.staff_id !== newStaffId &&
        r[tier] === 'paid',
    )

  // Void the OLD rep's + old manager's unearned tiers. A 'paid' tier is left as-is
  // (already earned money is never clawed back here); only pending/eligible/locked
  // tiers flip to 'reassigned'. The incoming rep's own rows and the (unchanged)
  // manager's override are untouched.
  for (const r of rows) {
    if (r.staff_id === newStaffId) continue // the incoming rep — nothing to void
    if (r.commission_type === 'override' && r.staff_id != null && r.staff_id === newRepManager) continue // same manager — keep
    const patch: Record<string, unknown> = {}
    if (r.t1_status !== 'paid') patch.t1_status = 'reassigned'
    if (r.t2_status !== 'paid') patch.t2_status = 'reassigned'
    if (r.loyalty_bonus_status !== 'paid') patch.loyalty_bonus_status = 'reassigned'
    if (Object.keys(patch).length === 0) continue
    await supabaseAdmin.from('commissions').update(patch).eq('id', r.id)
    await logAudit({
      commissionId: r.id,
      action: 'commission_reassigned_void',
      triggeredBy: 'manual',
      previousValue: { t1_status: r.t1_status, t2_status: r.t2_status, loyalty_bonus_status: r.loyalty_bonus_status },
      newValue: patch,
    })
  }

  if (!newStaffId) return

  // Build fresh rows for the incoming rep. Reuse createCommissionsForOwner for the amounts
  // + override, then transfer the clock anchor. Tiers a prior rep was ALREADY PAID are
  // suppressed to 'reassigned' on the fresh rows (never double-pay); only genuinely
  // unearned tiers transfer as earnable.
  await createCommissionsForOwner(ownerType, ownerId)

  if (firstPaymentDate) {
    const { data: fresh } = await supabaseAdmin
      .from('commissions')
      .select('id, staff_id, commission_type, t1_status, center_first_payment_date')
      .eq(ownerCol, ownerId)
    for (const r of (fresh ?? []) as {
      id: string
      staff_id: string | null
      commission_type: string
      t1_status: string
      center_first_payment_date: string | null
    }[]) {
      if (r.center_first_payment_date) continue // pre-existing row — not a fresh one
      const isOv = r.commission_type === 'override'
      const patch: Record<string, unknown> = {
        center_first_payment_date: firstPaymentDate,
        // T1: already paid to a prior rep → terminally suppressed; else the owner
        // has converted, so the (unearned, voided-off-the-old-rep) T1 transfers eligible.
        t1_status: priorPaid(isOv, 't1_status')
          ? 'reassigned'
          : r.t1_status === 'pending'
            ? 'eligible'
            : r.t1_status,
      }
      // T2 / loyalty: if already paid out once, the crons must never unlock the
      // fresh row — suppress; otherwise leave 'locked' for the normal 180/365-day unlock.
      if (priorPaid(isOv, 't2_status')) patch.t2_status = 'reassigned'
      if (priorPaid(isOv, 'loyalty_bonus_status')) patch.loyalty_bonus_status = 'reassigned'
      await supabaseAdmin.from('commissions').update(patch).eq('id', r.id)
      await logAudit({
        commissionId: r.id,
        action: 'commission_reassigned_transfer',
        triggeredBy: 'manual',
        newValue: { ...patch, once_per_customer_suppressed: priorPaid(isOv, 't1_status') || priorPaid(isOv, 't2_status') || priorPaid(isOv, 'loyalty_bonus_status') },
      })
    }
  }
}

export async function clawbackCommissions(centerId: string, adminId: string, reason: string): Promise<void> {
  const { data: rows } = await supabaseAdmin
    .from('commissions')
    .select('id, t1_status')
    .eq('center_id', centerId)
    .in('t1_status', ['pending', 'eligible', 'paid'])
  for (const row of rows ?? []) {
    await supabaseAdmin.from('commissions').update({ t1_status: 'clawed_back' }).eq('id', row.id)
    await logAudit({
      commissionId: row.id,
      action: 't1_clawback',
      triggeredBy: 'manual',
      performedBy: adminId,
      reason,
      previousValue: { t1_status: row.t1_status },
      newValue: { t1_status: 'clawed_back' },
    })
  }
}

export async function pauseCommissionClocks(centerId: string): Promise<void> {
  await supabaseAdmin.rpc('append_commission_pause', { p_center_id: centerId })
  const { data: rows } = await supabaseAdmin
    .from('commissions')
    .select('id')
    .eq('center_id', centerId)
    .in('t2_status', ['locked', 'eligible'])
  for (const row of rows ?? []) {
    await logAudit({ commissionId: row.id, action: 'clock_pause', triggeredBy: 'cron', newValue: { paused_at: new Date().toISOString() } })
  }
}

export async function resumeCommissionClocks(centerId: string): Promise<void> {
  await supabaseAdmin.rpc('close_commission_pause', { p_center_id: centerId })
  const { data: rows } = await supabaseAdmin
    .from('commissions')
    .select('id')
    .eq('center_id', centerId)
    .in('t2_status', ['locked', 'eligible'])
  for (const row of rows ?? []) {
    await logAudit({ commissionId: row.id, action: 'clock_resume', triggeredBy: 'webhook', newValue: { resumed_at: new Date().toISOString() } })
  }
}

interface AuditParams {
  commissionId?: string
  centerId?: string
  payoutId?: string
  action: string
  triggeredBy: 'cron' | 'manual' | 'webhook' | 'system'
  performedBy?: string
  reason?: string
  previousValue?: Record<string, unknown>
  newValue?: Record<string, unknown>
}

async function logAudit(p: AuditParams): Promise<void> {
  let commissionId = p.commissionId
  if (!commissionId && p.centerId) {
    const { data } = await supabaseAdmin.from('commissions').select('id').eq('center_id', p.centerId).limit(1).maybeSingle()
    commissionId = data?.id
  }
  await supabaseAdmin.from('commission_audit_log').insert({
    commission_id: commissionId ?? null,
    payout_id: p.payoutId ?? null,
    action: p.action,
    performed_by: p.performedBy ?? null,
    triggered_by: p.triggeredBy,
    reason: p.reason ?? null,
    previous_value: p.previousValue ?? null,
    new_value: p.newValue ?? null,
  })
}
