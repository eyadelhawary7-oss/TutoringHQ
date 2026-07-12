import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
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

// Two FKs from center_assignments -> staff now exist (staff_id, manager_staff_id), so the
// embed must disambiguate by column, otherwise PostgREST errors on ambiguous embedding.
const ASSIGNMENT_SELECT = `
        *,
        centers (
          id, name, center_code, plan, status, city, referred_by
        ),
        staff:staff!staff_id (
          id, name, role, city
        ),
        manager:staff!manager_staff_id (
          id, name, role, city
        )
      `

// GET /api/admin/center-assignments
export async function GET(request: Request) {
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

  const isFullAdmin = requireAdminRole(ctx, ['super_admin', 'admin']) === null
  const isManager = ctx.adminRole === 'sales_manager'
  // Reps get nothing here; only CEO / internal_admin and the sales_manager view this page.
  if (!isFullAdmin && !isManager) {
    return NextResponse.json({ errorKey: 'centerAssignments.errors.unauthorized' }, { status: 403 })
  }

  // ── Manager view: only their own assigned accounts + their reps for sub-assign ──
  if (isManager && !isFullAdmin) {
    const { data: staffRow } = await supabaseAdmin
      .from('staff')
      .select('id')
      .eq('user_id', ctx.userId)
      .maybeSingle()
    const managerStaffId = (staffRow as { id?: string } | null)?.id ?? null
    // Fail closed: an unlinked manager sees nothing.
    if (!managerStaffId) {
      return NextResponse.json({
        assignments: [],
        unassigned_centers: [],
        all_active_centers: [],
        staff: [],
        reps: [],
        viewer: { role: 'sales_manager', staff_id: null },
      })
    }

    const { data: reps } = await supabaseAdmin
      .from('staff')
      .select('id, name, role, city, status')
      .eq('reports_to', managerStaffId)
      .eq('status', 'active')
      .order('name')
    const repList = reps ?? []
    const scopeIds = [managerStaffId, ...repList.map((r) => (r as { id: string }).id)]

    const { data: assignments, error } = await supabaseAdmin
      .from('center_assignments')
      .select(ASSIGNMENT_SELECT)
      .or(`manager_staff_id.eq.${managerStaffId},staff_id.in.(${scopeIds.join(',')})`)
      .order('assigned_at', { ascending: false })

    if (error) {
      return NextResponse.json(
        { errorKey: 'centerAssignments.errors.list_failed', detail: error.message },
        { status: 500 },
      )
    }

    return NextResponse.json({
      assignments: assignments ?? [],
      unassigned_centers: [],
      all_active_centers: [],
      staff: repList,
      reps: repList,
      viewer: { role: 'sales_manager', staff_id: managerStaffId },
    })
  }

  // ── CEO / internal_admin view: everything ──
  const [assignmentsRes, centersRes, staffRes] = await Promise.all([
    supabaseAdmin
      .from('center_assignments')
      .select(ASSIGNMENT_SELECT)
      .order('assigned_at', { ascending: false }),

    supabaseAdmin
      .from('centers')
      .select('id, name, center_code, plan, status, city, referred_by')
      .eq('status', 'active')
      .order('name'),

    supabaseAdmin
      .from('staff')
      .select('id, name, role, city, status')
      .eq('status', 'active')
      .order('name'),
  ])

  if (assignmentsRes.error) {
    return NextResponse.json(
      {
        errorKey: 'centerAssignments.errors.list_failed',
        detail: assignmentsRes.error.message,
      },
      { status: 500 },
    )
  }

  if (centersRes.error) {
    return NextResponse.json(
      {
        errorKey: 'centerAssignments.errors.list_failed',
        detail: centersRes.error.message,
      },
      { status: 500 },
    )
  }

  const assignments = assignmentsRes.data ?? []
  const allActiveCenters = centersRes.data ?? []
  const staffList = staffRes.data ?? []

  const assignedCenterIds = new Set(assignments.filter((a) => a.is_primary).map((a) => a.center_id))
  const unassignedCenters = allActiveCenters.filter((c) => !assignedCenterIds.has(c.id))

  return NextResponse.json({
    assignments,
    unassigned_centers: unassignedCenters,
    all_active_centers: allActiveCenters,
    staff: staffList,
    reps: [],
    viewer: { role: 'super_admin' },
  })
}

/**
 * Phase 4b — CEO batch-assigns a set of centers to a Manager. Each row is left in the
 * "assigned to manager, rep not yet chosen" state (manager_staff_id set, staff_id NULL,
 * status pending_sm_approval, sourced_by 'sm'). Because one_primary_per_center is a
 * partial unique index, a PostgREST upsert can't target it cleanly, so this does a manual
 * upsert: update the existing primary row per center, insert where none exists. Does NOT
 * touch commission logic.
 */
async function batchAssignCentersToManager(
  admin: SupabaseClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const centerIds = (body.center_ids as unknown[]).filter(
    (x): x is string => typeof x === 'string' && x.length > 0,
  )
  const managerStaffId = body.manager_staff_id as string | undefined

  if (!managerStaffId || centerIds.length === 0) {
    return NextResponse.json(
      { errorKey: 'centerAssignments.errors.batch_requires_manager_and_centers' },
      { status: 400 },
    )
  }

  const { data: mgr } = await admin
    .from('staff')
    .select('id, role')
    .eq('id', managerStaffId)
    .maybeSingle()
  if (!mgr || (mgr as { role?: string }).role !== 'sm') {
    return NextResponse.json(
      { errorKey: 'centerAssignments.errors.manager_not_sm' },
      { status: 400 },
    )
  }

  const { data: existing } = await admin
    .from('center_assignments')
    .select('id, center_id')
    .in('center_id', centerIds)
    .eq('is_primary', true)
  const existingByCenter = new Map(
    (existing ?? []).map((r) => [(r as { center_id: string }).center_id, (r as { id: string }).id]),
  )

  const patch = {
    manager_staff_id: managerStaffId,
    staff_id: null,
    assignment_status: 'pending_sm_approval',
    sourced_by: 'sm',
    assigned_by: userId,
  }

  const toInsert: Record<string, unknown>[] = []
  for (const cid of centerIds) {
    const existingId = existingByCenter.get(cid)
    if (existingId) {
      const { error } = await admin.from('center_assignments').update(patch).eq('id', existingId)
      if (error) {
        return NextResponse.json(
          { errorKey: 'centerAssignments.errors.save_failed', detail: error.message },
          { status: 500 },
        )
      }
    } else {
      toInsert.push({ center_id: cid, is_primary: true, ...patch })
    }
  }

  if (toInsert.length > 0) {
    const { error } = await admin.from('center_assignments').insert(toInsert)
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
  }

  return NextResponse.json({ success: true, assigned: centerIds.length }, { status: 201 })
}

// POST /api/admin/center-assignments
export async function POST(request: Request) {
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

  let body: Record<string, unknown>
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>
  } catch {
    return NextResponse.json({ errorKey: 'centerAssignments.errors.invalid_json' }, { status: 400 })
  }

  // Phase 4b: CEO batch-assigns a list of centers to a Manager (super_admin only).
  if (Array.isArray(body.center_ids)) {
    const roleErr = requireAdminRole(ctx, ['super_admin'])
    if (roleErr) return roleErr
    return batchAssignCentersToManager(supabaseAdmin, ctx.userId, body)
  }

  // Legacy single-assignment path (super_admin or admin role).
  const roleErr = requireAdminRole(ctx, ['super_admin', 'admin'])
  if (roleErr) return roleErr

  const center_id = body.center_id as string | undefined
  const staff_id = (body.staff_id as string | null | undefined) ?? null
  const sourced_by = body.sourced_by as string | undefined
  const territory_city = (body.territory_city as string | null | undefined) ?? null
  const territory_override_reason =
    (body.territory_override_reason as string | null | undefined) ?? null

  if (!center_id || !sourced_by) {
    return NextResponse.json(
      { errorKey: 'centerAssignments.errors.center_sourced_required' },
      { status: 400 },
    )
  }

  if (!['eyad', 'sm', 'sr'].includes(sourced_by)) {
    return NextResponse.json(
      { errorKey: 'centerAssignments.errors.sourced_by_invalid' },
      { status: 400 },
    )
  }

  if (sourced_by === 'eyad' && staff_id) {
    return NextResponse.json({ errorKey: 'centerAssignments.errors.eyad_no_staff' }, { status: 400 })
  }

  if (sourced_by !== 'eyad' && !staff_id) {
    return NextResponse.json(
      { errorKey: 'centerAssignments.errors.sm_sr_requires_staff' },
      { status: 400 },
    )
  }

  const { data: center } = await supabaseAdmin
    .from('centers')
    .select('referred_by')
    .eq('id', center_id)
    .single()
  const isReferral = !!center?.referred_by

  const { data, error } = await supabaseAdmin
    .from('center_assignments')
    .insert({
      center_id,
      staff_id: staff_id || null,
      assigned_by: ctx.userId,
      sourced_by,
      is_primary: true,
      assignment_status: 'approved',
      territory_city: territory_city || null,
      territory_override_reason: territory_override_reason || null,
      referred_by_center: isReferral,
    })
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
    const { createCommissionsForCenter } = await import('@/lib/commissions')
    await createCommissionsForCenter(center_id)
  } catch (err) {
    console.error('[center-assignments] Commission creation failed:', err)
  }

  return NextResponse.json({ assignment: data }, { status: 201 })
}

// DELETE /api/admin/center-assignments?id=<assignment_id>
export async function DELETE(request: Request) {
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

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) {
    return NextResponse.json({ errorKey: 'centerAssignments.errors.id_required' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('center_assignments').delete().eq('id', id)
  if (error) {
    return NextResponse.json(
      { errorKey: 'centerAssignments.errors.save_failed', detail: error.message },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true })
}
