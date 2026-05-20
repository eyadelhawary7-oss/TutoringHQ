import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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

export const COMMISSION_TABLE = {
  sr: {
    solo: 200,
    nano: 500,
    starter: 1000,
    pro: 2000,
    business: 3000,
    enterprise: 5000,
    top_centers: 5000,
  },
  sm: {
    solo: 400,
    nano: 800,
    starter: 1800,
    pro: 3200,
    business: 5200,
    enterprise: 7500,
    top_centers: 7500,
  },
} as const

export const SM_OVERRIDE_RATE = 0.2
export const T1_RATE = 0.6
export const T2_RATE = 0.4
export const LOYALTY_BONUS = 200
export const T2_ACTIVE_DAYS = 180

type PlanKey = keyof typeof COMMISSION_TABLE.sr
type StaffRole = 'sm' | 'sr'

export async function createCommissionsForCenter(centerId: string): Promise<void> {
  const { data: center } = await supabaseAdmin
    .from('centers')
    .select('id, plan, referred_by')
    .eq('id', centerId)
    .single()
  if (!center) return

  const confirmedPlan = center.plan as PlanKey

  const { data: assignment } = await supabaseAdmin
    .from('center_assignments')
    .select('staff_id, sourced_by, referred_by_center, assignment_status')
    .eq('center_id', centerId)
    .eq('is_primary', true)
    .maybeSingle()

  if (!assignment || assignment.sourced_by === 'eyad') {
    await supabaseAdmin.from('commissions').upsert(
      {
        center_id: centerId,
        staff_id: null,
        role_at_time: 'eyad',
        commission_type: 'self_sourced',
        plan_at_signing: confirmedPlan,
        total_commission: 0,
        t1_amount: 0,
        t2_amount: 0,
        t1_status: 'paid',
        t2_status: 'paid',
        loyalty_bonus_status: 'paid',
      },
      { onConflict: 'center_id', ignoreDuplicates: true },
    )
    await logAudit({
      centerId,
      action: 'commission_created_eyad',
      triggeredBy: 'system',
      newValue: { sourced_by: 'eyad', total_commission: 0 },
    })
    return
  }

  if (assignment.referred_by_center || center.referred_by) {
    await supabaseAdmin
      .from('center_assignments')
      .update({ referred_by_center: true })
      .eq('center_id', centerId)
      .eq('is_primary', true)
    return
  }

  if (assignment.assignment_status !== 'approved') return

  const { data: staffMember } = await supabaseAdmin
    .from('staff')
    .select('id, role, reports_to')
    .eq('id', assignment.staff_id)
    .single()
  if (!staffMember) return

  const role = staffMember.role as StaffRole
  const totalCommission = COMMISSION_TABLE[role][confirmedPlan]
  const t1 = Math.round(totalCommission * T1_RATE)
  const t2 = totalCommission - t1

  const { data: commissionRow } = await supabaseAdmin
    .from('commissions')
    .upsert(
      {
        center_id: centerId,
        staff_id: staffMember.id,
        role_at_time: role,
        commission_type: 'self_sourced',
        plan_at_signing: confirmedPlan,
        total_commission: totalCommission,
        t1_amount: t1,
        t2_amount: t2,
      },
      { onConflict: 'center_id,staff_id,commission_type', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle()

  if (commissionRow) {
    await logAudit({
      commissionId: commissionRow.id,
      action: 'commission_created',
      triggeredBy: 'system',
      newValue: { role, plan: confirmedPlan, total: totalCommission, t1, t2 },
    })
  }

  if (role === 'sr' && staffMember.reports_to) {
    const overrideTotal = Math.round(totalCommission * SM_OVERRIDE_RATE)
    const overrideT1 = Math.round(overrideTotal * T1_RATE)
    const overrideT2 = overrideTotal - overrideT1

    const { data: overrideRow } = await supabaseAdmin
      .from('commissions')
      .upsert(
        {
          center_id: centerId,
          staff_id: staffMember.reports_to,
          role_at_time: 'sm',
          commission_type: 'override',
          parent_commission_id: commissionRow?.id ?? null,
          plan_at_signing: confirmedPlan,
          total_commission: overrideTotal,
          t1_amount: overrideT1,
          t2_amount: overrideT2,
        },
        { onConflict: 'center_id,staff_id,commission_type', ignoreDuplicates: true },
      )
      .select('id')
      .maybeSingle()

    if (overrideRow) {
      await logAudit({
        commissionId: overrideRow.id,
        action: 'commission_created',
        triggeredBy: 'system',
        newValue: { type: 'override', parent: commissionRow?.id, total: overrideTotal },
      })
    }
  }
}

export async function triggerT1Eligible(centerId: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  const { data: rows } = await supabaseAdmin
    .from('commissions')
    .select('id, t1_status, center_first_payment_date')
    .eq('center_id', centerId)
    .eq('t1_status', 'pending')
  for (const row of rows ?? []) {
    if (row.center_first_payment_date) continue
    await supabaseAdmin
      .from('commissions')
      .update({ center_first_payment_date: today, t1_status: 'eligible' })
      .eq('id', row.id)
    await logAudit({
      commissionId: row.id,
      action: 't1_eligible_set',
      triggeredBy: 'webhook',
      previousValue: { t1_status: 'pending' },
      newValue: { t1_status: 'eligible', center_first_payment_date: today },
    })
  }
}

export async function clawbackCommissions(
  centerId: string,
  adminId: string,
  reason: string,
): Promise<void> {
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
    await logAudit({
      commissionId: row.id,
      action: 'clock_pause',
      triggeredBy: 'cron',
      newValue: { paused_at: new Date().toISOString() },
    })
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
    await logAudit({
      commissionId: row.id,
      action: 'clock_resume',
      triggeredBy: 'webhook',
      newValue: { resumed_at: new Date().toISOString() },
    })
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
    const { data } = await supabaseAdmin
      .from('commissions')
      .select('id')
      .eq('center_id', p.centerId)
      .limit(1)
      .maybeSingle()
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
