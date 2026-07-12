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

type Breakdown = {
  t1_details?: Array<{ id: string }>
  t2_details?: Array<{ id: string }>
  loyalty_details?: Array<{ id: string }>
  override_details?: Array<{ id: string; t1_status?: string; t2_status?: string }>
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!supabaseAdmin) {
    return NextResponse.json({ errorKey: 'payouts.errors.listFailed' }, { status: 500 })
  }

  const ctx = await getAdminContext(request)
  if (!ctx) {
    return NextResponse.json({ errorKey: 'payouts.errors.unauthorized' }, { status: 401 })
  }
  // GET stays open to all admin_users members - no role gate per AUDIT_v22.md Phase 3.
  // Phase 4a: base_salary (salary) is CEO-only.
  const isCEO = ctx.internalRole === 'super_admin'
  const staffSelect = isCEO ? 'staff(id, name, role, base_salary)' : 'staff(id, name, role)'

  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from('commission_payouts')
    .select(`*, ${staffSelect}`)
    .eq('id', id)
    .single()
  if (error) {
    return NextResponse.json({ errorKey: 'payouts.errors.notFound' }, { status: 404 })
  }
  const payout = { ...(data as Record<string, unknown>) }
  if (!isCEO) delete payout.base_salary
  return NextResponse.json({ payout })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params
  let body: unknown
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { action, adjustment_amount, adjustment_reason, review_override } = body as {
    action?: unknown
    adjustment_amount?: unknown
    adjustment_reason?: unknown
    review_override?: unknown
  }

  const { data: payout, error: fetchErr } = await supabaseAdmin
    .from('commission_payouts')
    .select('*')
    .eq('id', id)
    .single()
  if (fetchErr || !payout) {
    return NextResponse.json({ errorKey: 'payouts.errors.notFound' }, { status: 404 })
  }
  if (payout.status === 'paid') {
    return NextResponse.json({ errorKey: 'payouts.errors.paidLocked' }, { status: 400 })
  }

  let updates: Record<string, unknown> = {}
  let auditAction = ''

  if (action === 'confirm') {
    if (payout.status !== 'draft') {
      return NextResponse.json({ errorKey: 'payouts.errors.confirmDraftOnly' }, { status: 400 })
    }
    if (payout.requires_review && !review_override) {
      return NextResponse.json({ errorKey: 'payouts.errors.reviewRequired' }, { status: 400 })
    }
    updates = { status: 'confirmed' }
    auditAction = 'payout_confirmed'
  } else if (action === 'mark_paid') {
    if (payout.status !== 'confirmed') {
      return NextResponse.json({ errorKey: 'payouts.errors.markPaidConfirmedOnly' }, { status: 400 })
    }
    const paidAt = new Date().toISOString()
    updates = { status: 'paid', paid_at: paidAt, paid_by: ctx.userId }
    auditAction = 'payout_paid'

    const breakdown = payout.breakdown as Breakdown
    const t1Ids = (breakdown?.t1_details ?? []).map((d) => d.id)
    const t2Ids = (breakdown?.t2_details ?? []).map((d) => d.id)
    const loyaltyIds = (breakdown?.loyalty_details ?? []).map((d) => d.id)

    if (t1Ids.length) {
      await supabaseAdmin
        .from('commissions')
        .update({ t1_status: 'paid', t1_paid_at: paidAt, t1_payout_id: id })
        .in('id', t1Ids)
    }
    if (t2Ids.length) {
      await supabaseAdmin
        .from('commissions')
        .update({ t2_status: 'paid', t2_paid_at: paidAt, t2_payout_id: id })
        .in('id', t2Ids)
    }
    if (loyaltyIds.length) {
      await supabaseAdmin
        .from('commissions')
        .update({
          loyalty_bonus_status: 'paid',
          loyalty_bonus_paid_at: paidAt,
          loyalty_payout_id: id,
        })
        .in('id', loyaltyIds)
    }

    for (const o of breakdown?.override_details ?? []) {
      if (o.t1_status === 'eligible') {
        await supabaseAdmin
          .from('commissions')
          .update({ t1_status: 'paid', t1_paid_at: paidAt, t1_payout_id: id })
          .eq('id', o.id)
      }
      if (o.t2_status === 'eligible') {
        await supabaseAdmin
          .from('commissions')
          .update({ t2_status: 'paid', t2_paid_at: paidAt, t2_payout_id: id })
          .eq('id', o.id)
      }
    }
  } else if (action === 'adjust') {
    if (!adjustment_reason || String(adjustment_reason).trim().length < 5) {
      return NextResponse.json({ errorKey: 'payouts.errors.adjustReason' }, { status: 400 })
    }
    const adj = Number(adjustment_amount)
    if (!Number.isFinite(adj)) {
      return NextResponse.json({ errorKey: 'payouts.errors.saveFailed' }, { status: 400 })
    }
    updates = {
      adjustment_amount: adj,
      adjustment_reason: String(adjustment_reason).trim(),
      total_amount: Number(payout.total_amount) + adj,
    }
    auditAction = 'payout_adjusted'
  } else {
    return NextResponse.json({ errorKey: 'payouts.errors.badAction' }, { status: 400 })
  }

  const { data: updated, error } = await supabaseAdmin
    .from('commission_payouts')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json(
      { errorKey: 'payouts.errors.saveFailed', error: error.message },
      { status: 500 },
    )
  }

  await supabaseAdmin.from('commission_audit_log').insert({
    payout_id: id,
    commission_id: null,
    action: auditAction,
    triggered_by: 'manual',
    performed_by: ctx.userId,
    previous_value: { status: payout.status, total_amount: payout.total_amount },
    new_value: updates,
  })

  return NextResponse.json({ payout: updated })
}

// DELETE - void a draft payout (super_admin only). The row is kept: it moves
// to status 'void' and any commissions linked to it are released, so the
// payout trail survives the never-permanently-delete rule.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params

  const { data: payout, error: fetchErr } = await supabaseAdmin
    .from('commission_payouts')
    .select('status, period')
    .eq('id', id)
    .single()
  if (fetchErr || !payout) {
    return NextResponse.json({ errorKey: 'payouts.errors.notFound' }, { status: 404 })
  }
  if (payout.status !== 'draft') {
    return NextResponse.json({ errorKey: 'payouts.errors.cannotDeleteNonDraft' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('commission_payouts')
    .update({ status: 'void' })
    .eq('id', id)
    .eq('status', 'draft')
  if (error) {
    return NextResponse.json(
      { errorKey: 'payouts.errors.saveFailed', error: error.message },
      { status: 500 },
    )
  }

  // Release commissions that were attached to this payout so a future payout
  // for the same period can pick them up again.
  for (const col of ['t1_payout_id', 't2_payout_id', 'loyalty_payout_id'] as const) {
    await supabaseAdmin.from('commissions').update({ [col]: null }).eq(col, id)
  }

  await supabaseAdmin.from('commission_audit_log').insert({
    payout_id: id,
    commission_id: null,
    action: 'payout_voided',
    triggered_by: 'manual',
    performed_by: ctx.userId,
    new_value: { period: payout.period, status: 'void' },
  })

  return NextResponse.json({ success: true })
}
