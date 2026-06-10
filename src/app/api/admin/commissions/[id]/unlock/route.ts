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

// PATCH - manual T2 unlock, super_admin only (verb is PATCH, not POST).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!supabaseAdmin) {
    return NextResponse.json({ errorKey: 'commissions.errors.saveFailed' }, { status: 500 })
  }

  const ctx = await getAdminContext(request)
  if (!ctx) {
    return NextResponse.json({ errorKey: 'commissions.errors.unauthorized' }, { status: 401 })
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
  const { reason } = body as { reason?: unknown }

  if (!reason || String(reason).trim().length < 10) {
    return NextResponse.json({ errorKey: 'commissions.errors.reasonTooShort' }, { status: 400 })
  }

  const { data: commission, error: fetchErr } = await supabaseAdmin
    .from('commissions')
    .select('id, t2_status, t2_amount')
    .eq('id', id)
    .single()

  if (fetchErr || !commission) {
    return NextResponse.json({ errorKey: 'commissions.errors.notFound' }, { status: 404 })
  }
  if (commission.t2_status !== 'locked') {
    return NextResponse.json(
      {
        errorKey: 'commissions.errors.cannotUnlock',
        errorParams: { status: commission.t2_status },
      },
      { status: 400 },
    )
  }

  const today = new Date().toISOString().split('T')[0]

  const { error: upErr } = await supabaseAdmin
    .from('commissions')
    .update({ t2_status: 'eligible', t2_eligible_at: today })
    .eq('id', id)

  if (upErr) {
    return NextResponse.json(
      { errorKey: 'commissions.errors.saveFailed', error: upErr.message },
      { status: 500 },
    )
  }

  const { error: auditErr } = await supabaseAdmin.from('commission_audit_log').insert({
    commission_id: id,
    action: 't2_manual_unlock',
    performed_by: ctx.userId,
    triggered_by: 'manual',
    reason: String(reason).trim(),
    previous_value: { t2_status: 'locked' },
    new_value: { t2_status: 'eligible', t2_eligible_at: today },
  })

  if (auditErr) {
    return NextResponse.json(
      { errorKey: 'commissions.errors.saveFailed', error: auditErr.message },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, t2_status: 'eligible', t2_eligible_at: today })
}
