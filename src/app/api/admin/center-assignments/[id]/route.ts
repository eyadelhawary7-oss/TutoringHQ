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

// Mirrors the relaxed DB CHECK sourced_by_eyad_no_staff: an eyad row must have no staff;
// a non-eyad row must carry either a rep (staff_id) or a manager (manager_staff_id).
function validateSourcedStaff(
  sourced_by: string,
  staff_id: string | null,
  manager_staff_id: string | null,
): string | null {
  if (!['eyad', 'sm', 'sr'].includes(sourced_by)) return 'centerAssignments.errors.sourced_by_invalid'
  if (sourced_by === 'eyad' && staff_id) return 'centerAssignments.errors.eyad_no_staff'
  if (sourced_by !== 'eyad' && !staff_id && !manager_staff_id)
    return 'centerAssignments.errors.sm_sr_requires_staff'
  return null
}

// PATCH /api/admin/center-assignments/[id]
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { errorKey: 'centerAssignments.errors.misconfigured' },
      { status: 500 },
    )
  }

  const ctx = await getAdminContext(request)
  if (!ctx) {
    return NextResponse.json({ errorKey: 'centerAssignments.errors.unauthorized' }, { status: 401 })
  }

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>
  } catch {
    return NextResponse.json({ errorKey: 'centerAssignments.errors.invalid_json' }, { status: 400 })
  }

  const { data: existing, error: loadErr } = await supabaseAdmin
    .from('center_assignments')
    .select('center_id, sourced_by, staff_id, manager_staff_id')
    .eq('id', id)
    .maybeSingle()

  if (loadErr || !existing) {
    return NextResponse.json({ errorKey: 'centerAssignments.errors.not_found' }, { status: 404 })
  }

  const isFullAdmin = requireAdminRole(ctx, ['super_admin', 'admin']) === null

  // ── CEO / internal_admin override: may set/replace staff_id, manager_staff_id, etc. ──
  if (isFullAdmin) {
    const allowedFields = [
      'staff_id',
      'manager_staff_id',
      'sourced_by',
      'territory_city',
      'territory_override_reason',
      'assignment_status',
      'assignment_disputed',
      'dispute_notes',
    ] as const

    const updates: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (field in body) updates[field] = body[field]
    }

    const mergedSourced = (updates.sourced_by as string | undefined) ?? existing.sourced_by
    const mergedStaff =
      'staff_id' in updates ? ((updates.staff_id as string | null) ?? null) : existing.staff_id
    const mergedManager =
      'manager_staff_id' in updates
        ? ((updates.manager_staff_id as string | null) ?? null)
        : existing.manager_staff_id

    if (
      updates.sourced_by !== undefined ||
      updates.staff_id !== undefined ||
      updates.manager_staff_id !== undefined
    ) {
      const errKey = validateSourcedStaff(mergedSourced, mergedStaff, mergedManager)
      if (errKey) {
        return NextResponse.json({ errorKey: errKey }, { status: 400 })
      }
    }

    const { data, error } = await supabaseAdmin
      .from('center_assignments')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { errorKey: 'centerAssignments.errors.duplicate_primary' },
          { status: 409 },
        )
      }
      return NextResponse.json(
        { errorKey: 'centerAssignments.errors.save_failed', detail: error.message },
        { status: 500 },
      )
    }

    try {
      if (updates.staff_id !== undefined) {
        // Rep reassignment: void the previous rep's still-unearned tiers, transfer the
        // clock, create the new rep's rows + manager override (never double-pay).
        const nextStaffId = (data as { staff_id?: string | null } | null)?.staff_id ?? null
        const { reassignCommissions } = await import('@/lib/commissions')
        await reassignCommissions('center', existing.center_id, nextStaffId)
      } else {
        const { createCommissionsForCenter } = await import('@/lib/commissions')
        await createCommissionsForCenter(existing.center_id)
      }
    } catch (err) {
      console.error('[center-assignments] Commission refresh failed:', err)
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

    // Must be the manager this row is assigned to (fail closed otherwise).
    if (!callerStaffId || existing.manager_staff_id !== callerStaffId) {
      return NextResponse.json(
        { errorKey: 'centerAssignments.errors.forbidden_not_your_assignment' },
        { status: 403 },
      )
    }

    const repId = (body.staff_id as string | null | undefined) ?? null
    if (!repId) {
      return NextResponse.json(
        { errorKey: 'centerAssignments.errors.rep_required' },
        { status: 400 },
      )
    }

    // The rep must actually report to this manager.
    const { data: rep } = await supabaseAdmin
      .from('staff')
      .select('id, role, reports_to')
      .eq('id', repId)
      .maybeSingle()
    const repRow = rep as { reports_to?: string | null } | null
    if (!repRow || repRow.reports_to !== callerStaffId) {
      return NextResponse.json(
        { errorKey: 'centerAssignments.errors.rep_not_your_report' },
        { status: 403 },
      )
    }

    const { data, error } = await supabaseAdmin
      .from('center_assignments')
      .update({ staff_id: repId, assignment_status: 'approved' })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { errorKey: 'centerAssignments.errors.duplicate_primary' },
          { status: 409 },
        )
      }
      return NextResponse.json(
        { errorKey: 'centerAssignments.errors.save_failed', detail: error.message },
        { status: 500 },
      )
    }

    return NextResponse.json({ assignment: data })
  }

  return NextResponse.json({ errorKey: 'centerAssignments.errors.unauthorized' }, { status: 403 })
}

// DELETE /api/admin/center-assignments/[id]
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { errorKey: 'centerAssignments.errors.misconfigured' },
      { status: 500 },
    )
  }

  const ctx = await getAdminContext(request)
  if (!ctx) {
    return NextResponse.json({ errorKey: 'centerAssignments.errors.unauthorized' }, { status: 401 })
  }
  // Role gate added per docs/AUDIT_v22.md Phase 3 / Phase 8 P0 (Task 9)
  const roleErr = requireAdminRole(ctx, ['super_admin', 'admin'])
  if (roleErr) return roleErr

  const { id } = await params

  const { error } = await supabaseAdmin.from('center_assignments').delete().eq('id', id)
  if (error) {
    return NextResponse.json(
      { errorKey: 'centerAssignments.errors.save_failed', detail: error.message },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true })
}
