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

// PATCH /api/admin/teacher-assignments/[id]
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { errorKey: 'teacherAssignments.errors.misconfigured' },
      { status: 500 },
    )
  }

  const ctx = await getAdminContext(request)
  if (!ctx) {
    return NextResponse.json({ errorKey: 'teacherAssignments.errors.unauthorized' }, { status: 401 })
  }

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>
  } catch {
    return NextResponse.json({ errorKey: 'teacherAssignments.errors.invalid_json' }, { status: 400 })
  }

  const { data: existing, error: loadErr } = await supabaseAdmin
    .from('teacher_assignments')
    .select('teacher_id, sourced_by, staff_id, manager_staff_id')
    .eq('id', id)
    .maybeSingle()

  if (loadErr || !existing) {
    return NextResponse.json({ errorKey: 'teacherAssignments.errors.not_found' }, { status: 404 })
  }

  const isFullAdmin = requireAdminRole(ctx, ['super_admin', 'admin']) === null

  // ── CEO / internal_admin override ──
  if (isFullAdmin) {
    const allowedFields = [
      'staff_id',
      'manager_staff_id',
      'sourced_by',
      'assignment_status',
    ] as const

    const updates: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (field in body) updates[field] = body[field]
    }

    const { data, error } = await supabaseAdmin
      .from('teacher_assignments')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { errorKey: 'teacherAssignments.errors.duplicate_primary' },
          { status: 409 },
        )
      }
      return NextResponse.json(
        { errorKey: 'teacherAssignments.errors.save_failed', detail: error.message },
        { status: 500 },
      )
    }

    // Commission refresh — mirrors the center full-admin branch EXACTLY so a teacher
    // reassignment behaves like a center one: on a rep change, transfer future commission +
    // loyalty to the new rep, void the old rep's still-unearned tiers, keep already-paid tiers
    // (no clawback, no double-pay), and recompute the manager override to the new chain.
    try {
      if (updates.staff_id !== undefined) {
        const nextStaffId = (data as { staff_id?: string | null } | null)?.staff_id ?? null
        const { reassignCommissions } = await import('@/lib/commissions')
        await reassignCommissions('teacher', existing.teacher_id, nextStaffId)
      } else {
        const { createCommissionsForTeacher } = await import('@/lib/commissions')
        await createCommissionsForTeacher(existing.teacher_id)
      }
    } catch (err) {
      console.error('[teacher-assignments] Commission refresh failed:', err)
    }

    return NextResponse.json({ assignment: data })
  }

  // ── Manager sub-assign: only the sales_manager who owns this row, only to their reps ──
  if (ctx.adminRole === 'sales_manager') {
    const { data: staffRow } = await supabaseAdmin
      .from('staff')
      .select('id')
      .eq('user_id', ctx.userId)
      .maybeSingle()
    const callerStaffId = (staffRow as { id?: string } | null)?.id ?? null

    if (!callerStaffId || existing.manager_staff_id !== callerStaffId) {
      return NextResponse.json(
        { errorKey: 'teacherAssignments.errors.forbidden_not_your_assignment' },
        { status: 403 },
      )
    }

    const repId = (body.staff_id as string | null | undefined) ?? null
    if (!repId) {
      return NextResponse.json(
        { errorKey: 'teacherAssignments.errors.rep_required' },
        { status: 400 },
      )
    }

    const { data: rep } = await supabaseAdmin
      .from('staff')
      .select('id, role, reports_to')
      .eq('id', repId)
      .maybeSingle()
    const repRow = rep as { reports_to?: string | null } | null
    if (!repRow || repRow.reports_to !== callerStaffId) {
      return NextResponse.json(
        { errorKey: 'teacherAssignments.errors.rep_not_your_report' },
        { status: 403 },
      )
    }

    const { data, error } = await supabaseAdmin
      .from('teacher_assignments')
      .update({ staff_id: repId, assignment_status: 'approved' })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { errorKey: 'teacherAssignments.errors.duplicate_primary' },
          { status: 409 },
        )
      }
      return NextResponse.json(
        { errorKey: 'teacherAssignments.errors.save_failed', detail: error.message },
        { status: 500 },
      )
    }

    return NextResponse.json({ assignment: data })
  }

  return NextResponse.json({ errorKey: 'teacherAssignments.errors.unauthorized' }, { status: 403 })
}

// DELETE /api/admin/teacher-assignments/[id]
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { errorKey: 'teacherAssignments.errors.misconfigured' },
      { status: 500 },
    )
  }

  const ctx = await getAdminContext(request)
  if (!ctx) {
    return NextResponse.json({ errorKey: 'teacherAssignments.errors.unauthorized' }, { status: 401 })
  }
  const roleErr = requireAdminRole(ctx, ['super_admin', 'admin'])
  if (roleErr) return roleErr

  const { id } = await params

  const { error } = await supabaseAdmin.from('teacher_assignments').delete().eq('id', id)
  if (error) {
    return NextResponse.json(
      { errorKey: 'teacherAssignments.errors.save_failed', detail: error.message },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true })
}
