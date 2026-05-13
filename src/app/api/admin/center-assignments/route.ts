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

// GET /api/admin/center-assignments
export async function GET(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { errorKey: 'centerAssignments.errors.misconfigured' },
      { status: 500 },
    )
  }

  if (!(await getAdminContext(request))) {
    return NextResponse.json({ errorKey: 'centerAssignments.errors.unauthorized' }, { status: 401 })
  }

  const [assignmentsRes, centersRes, staffRes] = await Promise.all([
    supabaseAdmin
      .from('center_assignments')
      .select(
        `
        *,
        centers (
          id, name, center_code, plan, status, city, referred_by
        ),
        staff (
          id, name, role, city
        )
      `,
      )
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
  })
}

// POST /api/admin/center-assignments — create assignment (super_admin or admin role)
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
  // Role gate added per docs/AUDIT_v22.md Phase 3 / Phase 8 P0 (Task 9)
  const roleErr = requireAdminRole(ctx, ['super_admin', 'admin'])
  if (roleErr) return roleErr

  let body: Record<string, unknown>
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>
  } catch {
    return NextResponse.json({ errorKey: 'centerAssignments.errors.invalid_json' }, { status: 400 })
  }

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
