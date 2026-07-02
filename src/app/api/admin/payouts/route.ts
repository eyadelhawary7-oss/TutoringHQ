import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { parseBodyWithLimit } from '@/lib/validate';
import { getAdminContext, requireAdminRole } from '@/lib/admin-auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// GET /api/admin/payouts - list all payouts
export async function GET(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ errorKey: 'payouts.errors.listFailed' }, { status: 500 })
  }

  if (!(await getAdminContext(request))) {
    return NextResponse.json({ errorKey: 'payouts.errors.unauthorized' }, { status: 401 })
  }
  // GET stays open to all admin_users members - no role gate per AUDIT_v22.md Phase 3

  const { data, error } = await supabaseAdmin
    .from('commission_payouts')
    .select(`*, staff(id, name, role, base_salary)`)
    .order('period', { ascending: false })

  if (error) {
    return NextResponse.json(
      { errorKey: 'payouts.errors.listFailed', error: error.message },
      { status: 500 },
    )
  }
  return NextResponse.json({ payouts: data ?? [] })
}

// POST - generate payout for a period (super_admin only)
export async function POST(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ errorKey: 'payouts.errors.saveFailed' }, { status: 500 })
  }

  const ctx = await getAdminContext(request)
  if (!ctx) {
    return NextResponse.json({ errorKey: 'payouts.errors.unauthorized' }, { status: 401 })
  }
  // Role gate added per docs/AUDIT_v22.md Phase 3 / Phase 8 P0 (Task 9)
  const roleErr = requireAdminRole(ctx, ['super_admin'])
  if (roleErr) return roleErr

  let body: unknown
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { period: periodRaw, staff_id: staffIdRaw } = body as { period?: unknown; staff_id?: unknown }
  const period = periodRaw != null ? String(periodRaw) : ''
  const staff_id = staffIdRaw != null ? String(staffIdRaw) : ''

  if (!period || !PERIOD_RE.test(period)) {
    return NextResponse.json({ errorKey: 'payouts.errors.invalidPeriod' }, { status: 400 })
  }
  if (!staff_id) {
    return NextResponse.json({ errorKey: 'payouts.errors.staffRequired' }, { status: 400 })
  }

  const { data: existing } = await supabaseAdmin
    .from('commission_payouts')
    .select('id, status')
    .eq('staff_id', staff_id)
    .eq('period', period)
    .neq('status', 'void')
    .limit(1)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      {
        errorKey: 'payouts.errors.exists',
        existing_status: existing.status,
        payout_id: existing.id,
      },
      { status: 409 },
    )
  }

  const { data: staffMember, error: staffErr } = await supabaseAdmin
    .from('staff')
    .select('*')
    .eq('id', staff_id)
    .single()
  if (staffErr || !staffMember) {
    return NextResponse.json({ errorKey: 'payouts.errors.staffNotFound' }, { status: 404 })
  }

  const [year, month] = period.split('-').map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  const hireDate = new Date(staffMember.hire_date as string)
  let baseSalary = Number(staffMember.base_salary)

  if (
    hireDate.getFullYear() === year &&
    hireDate.getMonth() + 1 === month &&
    hireDate.getDate() > 1
  ) {
    const daysWorked = daysInMonth - hireDate.getDate() + 1
    baseSalary = Math.round(baseSalary * (daysWorked / daysInMonth))
  }

  const { data: t1Commissions } = await supabaseAdmin
    .from('commissions')
    .select('id, t1_amount, commission_type, plan_at_signing, center_id')
    .eq('staff_id', staff_id)
    .eq('t1_status', 'eligible')
    .neq('commission_type', 'override')

  const { data: t2Commissions } = await supabaseAdmin
    .from('commissions')
    .select('id, t2_amount, commission_type, plan_at_signing, center_id')
    .eq('staff_id', staff_id)
    .eq('t2_status', 'eligible')
    .neq('commission_type', 'override')

  const { data: loyaltyCommissions } = await supabaseAdmin
    .from('commissions')
    .select('id, loyalty_bonus_amount, center_id')
    .eq('staff_id', staff_id)
    .eq('loyalty_bonus_status', 'eligible')
    .neq('commission_type', 'override')

  const { data: overrideCommissions } = await supabaseAdmin
    .from('commissions')
    .select('id, t1_amount, t2_amount, t1_status, t2_status, center_id')
    .eq('staff_id', staff_id)
    .eq('commission_type', 'override')

  const t1Total = (t1Commissions ?? []).reduce((s, c) => s + Number(c.t1_amount), 0)
  const t2Total = (t2Commissions ?? []).reduce((s, c) => s + Number(c.t2_amount), 0)
  const loyaltyTotal = (loyaltyCommissions ?? []).reduce(
    (s, c) => s + Number(c.loyalty_bonus_amount),
    0,
  )
  const overrideT1 = (overrideCommissions ?? [])
    .filter((c) => c.t1_status === 'eligible')
    .reduce((s, c) => s + Number(c.t1_amount), 0)
  const overrideT2 = (overrideCommissions ?? [])
    .filter((c) => c.t2_status === 'eligible')
    .reduce((s, c) => s + Number(c.t2_amount), 0)
  const overrideTotal = overrideT1 + overrideT2

  const { data: prevPayout } = await supabaseAdmin
    .from('commission_payouts')
    .select('adjustment_amount')
    .eq('staff_id', staff_id)
    .in('status', ['confirmed', 'paid'])
    .order('period', { ascending: false })
    .limit(1)
    .maybeSingle()

  const carryover = Number(prevPayout?.adjustment_amount ?? 0)
  const commissionIds = new Set<string>()
  for (const c of t1Commissions ?? []) commissionIds.add(c.id)
  for (const c of t2Commissions ?? []) commissionIds.add(c.id)
  for (const c of loyaltyCommissions ?? []) commissionIds.add(c.id)
  for (const c of overrideCommissions ?? []) commissionIds.add(c.id)
  const commissionCount = commissionIds.size

  const totalAmount =
    baseSalary + t1Total + t2Total + loyaltyTotal + overrideTotal + carryover
  const requiresReview = totalAmount > Number(staffMember.base_salary) * 5

  const breakdown = {
    t1_details: (t1Commissions ?? []).map((c) => ({
      id: c.id,
      amount: Number(c.t1_amount),
      plan: c.plan_at_signing,
    })),
    t2_details: (t2Commissions ?? []).map((c) => ({
      id: c.id,
      amount: Number(c.t2_amount),
      plan: c.plan_at_signing,
    })),
    loyalty_details: (loyaltyCommissions ?? []).map((c) => ({
      id: c.id,
      amount: Number(c.loyalty_bonus_amount),
    })),
    override_detail: { t1: overrideT1, t2: overrideT2 },
    override_details: (overrideCommissions ?? []).map((c) => ({
      id: c.id,
      t1_status: c.t1_status,
      t2_status: c.t2_status,
    })),
    carryover_from_prev: carryover,
  }

  const { data: payout, error } = await supabaseAdmin
    .from('commission_payouts')
    .insert({
      staff_id,
      period,
      total_amount: totalAmount,
      base_salary: baseSalary,
      t1_commissions: t1Total,
      t2_commissions: t2Total,
      loyalty_bonuses: loyaltyTotal,
      override_commissions: overrideTotal,
      commission_count: commissionCount,
      breakdown,
      requires_review: requiresReview,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json(
      { errorKey: 'payouts.errors.saveFailed', error: error.message },
      { status: 500 },
    )
  }

  const firstCommissionId =
    t1Commissions?.[0]?.id ?? t2Commissions?.[0]?.id ?? loyaltyCommissions?.[0]?.id ?? null

  await supabaseAdmin.from('commission_audit_log').insert({
    payout_id: payout.id,
    commission_id: firstCommissionId,
    action: 'payout_confirmed',
    triggered_by: 'system',
    performed_by: ctx.userId,
    new_value: { period, total: totalAmount, requires_review: requiresReview, status: 'draft' },
  })

  return NextResponse.json({ payout }, { status: 201 })
}
