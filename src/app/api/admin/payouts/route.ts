import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { parseBodyWithLimit } from '@/lib/validate';
import { getAdminContext, requireAdminRole } from '@/lib/admin-auth';
import { getInternalScope } from '@/lib/internalScope';

// Sentinel that matches no row - used so a scoped role with an EMPTY scope sees
// nothing (fail closed) rather than everything.
const NO_MATCH_SENTINEL = '00000000-0000-0000-0000-000000000000';

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

  const ctx = await getAdminContext(request)
  if (!ctx) {
    return NextResponse.json({ errorKey: 'payouts.errors.unauthorized' }, { status: 401 })
  }
  // GET stays open to all admin_users members - no role gate per AUDIT_v22.md Phase 3.
  // Phase 4a: salary is CEO-only, and sales_manager/sales_rep only see their own /
  // team's payouts (fail closed when the scope is empty).
  const isCEO = ctx.internalRole === 'super_admin'
  const staffSelect = isCEO ? 'staff(id, name, role, base_salary)' : 'staff(id, name, role)'

  const scope = await getInternalScope(ctx)

  let query = supabaseAdmin
    .from('commission_payouts')
    .select(`*, ${staffSelect}`)
    .order('period', { ascending: false })

  if (scope.level !== 'all') {
    query = query.in(
      'staff_id',
      scope.staffIds.length ? scope.staffIds : [NO_MATCH_SENTINEL],
    )
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json(
      { errorKey: 'payouts.errors.listFailed', error: error.message },
      { status: 500 },
    )
  }

  // Salary privacy (Phase 5). The CEO gets the full row unchanged. A NON-CEO caller
  // (manager/rep) must never receive `base_salary` OR the salary-inclusive `total_amount`
  // (from which base_salary is trivially derivable), nor any adjustment/breakdown field.
  // For them we build a fresh whitelist object: staff id/name/role, period, status and the
  // commission components only, plus a derived `commission_total` (commissions, no salary).
  const payouts = (data ?? []).map((row) => {
    const r = row as Record<string, unknown>
    if (isCEO) return r
    const t1 = Number(r.t1_commissions ?? 0)
    const t2 = Number(r.t2_commissions ?? 0)
    const loyalty = Number(r.loyalty_bonuses ?? 0)
    const override = Number(r.override_commissions ?? 0)
    return {
      id: r.id,
      staff_id: r.staff_id,
      staff: r.staff, // already selected without base_salary for non-CEO
      period: r.period,
      status: r.status,
      t1_commissions: t1,
      t2_commissions: t2,
      loyalty_bonuses: loyalty,
      override_commissions: override,
      commission_count: r.commission_count,
      commission_total: t1 + t2 + loyalty + override,
      paid_at: r.paid_at ?? null,
    }
  })

  return NextResponse.json({ payouts })
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

  // Every tier query excludes rows already CLAIMED by another payout
  // (`<tier>_payout_id IS NULL`) — a tier can only ever be swept into ONE payout.
  // Claims are written right after the payout row is created (below) and released
  // by the DELETE/void handler, so generate→void→regenerate still works.
  const { data: t1Commissions } = await supabaseAdmin
    .from('commissions')
    .select('id, t1_amount, commission_type, plan_at_signing, center_id')
    .eq('staff_id', staff_id)
    .eq('t1_status', 'eligible')
    .is('t1_payout_id', null)
    .neq('commission_type', 'override')

  const { data: t2Commissions } = await supabaseAdmin
    .from('commissions')
    .select('id, t2_amount, commission_type, plan_at_signing, center_id')
    .eq('staff_id', staff_id)
    .eq('t2_status', 'eligible')
    .is('t2_payout_id', null)
    .neq('commission_type', 'override')

  const { data: loyaltyCommissions } = await supabaseAdmin
    .from('commissions')
    .select('id, loyalty_bonus_amount, center_id')
    .eq('staff_id', staff_id)
    .eq('loyalty_bonus_status', 'eligible')
    .is('loyalty_payout_id', null)
    .neq('commission_type', 'override')

  const { data: overrideCommissions } = await supabaseAdmin
    .from('commissions')
    .select(
      'id, t1_amount, t2_amount, loyalty_bonus_amount, t1_status, t2_status, loyalty_bonus_status, t1_payout_id, t2_payout_id, loyalty_payout_id, center_id',
    )
    .eq('staff_id', staff_id)
    .eq('commission_type', 'override')

  const t1Total = (t1Commissions ?? []).reduce((s, c) => s + Number(c.t1_amount), 0)
  const t2Total = (t2Commissions ?? []).reduce((s, c) => s + Number(c.t2_amount), 0)
  const loyaltyTotal = (loyaltyCommissions ?? []).reduce(
    (s, c) => s + Number(c.loyalty_bonus_amount),
    0,
  )
  // Per-tier claim filter on override rows (a single override row carries all three tiers).
  const ovT1Rows = (overrideCommissions ?? []).filter((c) => c.t1_status === 'eligible' && !c.t1_payout_id)
  const ovT2Rows = (overrideCommissions ?? []).filter((c) => c.t2_status === 'eligible' && !c.t2_payout_id)
  // Money-track: the manager also earns 20% override on the rep's LOYALTY bonus.
  const ovLoyaltyRows = (overrideCommissions ?? []).filter(
    (c) => c.loyalty_bonus_status === 'eligible' && !c.loyalty_payout_id,
  )
  const overrideT1 = ovT1Rows.reduce((s, c) => s + Number(c.t1_amount), 0)
  const overrideT2 = ovT2Rows.reduce((s, c) => s + Number(c.t2_amount), 0)
  const overrideLoyalty = ovLoyaltyRows.reduce((s, c) => s + Number(c.loyalty_bonus_amount ?? 0), 0)
  const overrideTotal = overrideT1 + overrideT2 + overrideLoyalty

  // NOTE: the previous-payout `adjustment_amount` carryover was REMOVED (money fix):
  // the adjust action already bumps the payout it is applied to, so re-adding it to the
  // NEXT payout paid every adjustment twice. A cross-period correction is now applied by
  // adjusting the next payout directly.
  const commissionIds = new Set<string>()
  for (const c of t1Commissions ?? []) commissionIds.add(c.id)
  for (const c of t2Commissions ?? []) commissionIds.add(c.id)
  for (const c of loyaltyCommissions ?? []) commissionIds.add(c.id)
  for (const c of overrideCommissions ?? []) commissionIds.add(c.id)
  const commissionCount = commissionIds.size

  const totalAmount = baseSalary + t1Total + t2Total + loyaltyTotal + overrideTotal
  const requiresReview = totalAmount > Number(staffMember.base_salary) * 5

  const ovT1Ids = new Set(ovT1Rows.map((c) => c.id))
  const ovT2Ids = new Set(ovT2Rows.map((c) => c.id))
  const ovLoyaltyIds = new Set(ovLoyaltyRows.map((c) => c.id))

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
    override_detail: { t1: overrideT1, t2: overrideT2, loyalty: overrideLoyalty },
    // Only the tiers THIS payout swept — mark_paid pays exactly these, so a tier
    // claimed by another payout can never be flipped 'paid' from here.
    override_details: (overrideCommissions ?? [])
      .filter((c) => ovT1Ids.has(c.id) || ovT2Ids.has(c.id) || ovLoyaltyIds.has(c.id))
      .map((c) => ({
        id: c.id,
        t1_status: ovT1Ids.has(c.id) ? 'eligible' : 'not_swept',
        t2_status: ovT2Ids.has(c.id) ? 'eligible' : 'not_swept',
        loyalty_bonus_status: ovLoyaltyIds.has(c.id) ? 'eligible' : 'not_swept',
      })),
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

  // CLAIM the swept tiers for this payout (released again by DELETE/void). The
  // `.is(<tier>_payout_id, null)` guard means a concurrent generation cannot steal
  // an already-claimed tier — each tier is only ever disbursed by ONE payout.
  const t1ClaimIds = [...(t1Commissions ?? []).map((c) => c.id), ...ovT1Rows.map((c) => c.id)]
  const t2ClaimIds = [...(t2Commissions ?? []).map((c) => c.id), ...ovT2Rows.map((c) => c.id)]
  const loyaltyClaimIds = [
    ...(loyaltyCommissions ?? []).map((c) => c.id),
    ...ovLoyaltyRows.map((c) => c.id),
  ]
  if (t1ClaimIds.length) {
    await supabaseAdmin
      .from('commissions')
      .update({ t1_payout_id: payout.id })
      .in('id', t1ClaimIds)
      .is('t1_payout_id', null)
  }
  if (t2ClaimIds.length) {
    await supabaseAdmin
      .from('commissions')
      .update({ t2_payout_id: payout.id })
      .in('id', t2ClaimIds)
      .is('t2_payout_id', null)
  }
  if (loyaltyClaimIds.length) {
    await supabaseAdmin
      .from('commissions')
      .update({ loyalty_payout_id: payout.id })
      .in('id', loyaltyClaimIds)
      .is('loyalty_payout_id', null)
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
