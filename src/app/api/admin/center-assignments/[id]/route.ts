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

function validateSourcedStaff(sourced_by: string, staff_id: string | null): string | null {
  if (sourced_by === 'eyad' && staff_id) return 'centerAssignments.errors.eyad_no_staff'
  if (sourced_by !== 'eyad' && !staff_id) return 'centerAssignments.errors.sm_sr_requires_staff'
  if (!['eyad', 'sm', 'sr'].includes(sourced_by)) return 'centerAssignments.errors.sourced_by_invalid'
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
  // Role gate added per docs/AUDIT_v22.md Phase 3 / Phase 8 P0 (Task 9)
  const roleErr = requireAdminRole(ctx, ['super_admin', 'admin'])
  if (roleErr) return roleErr

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>
  } catch {
    return NextResponse.json({ errorKey: 'centerAssignments.errors.invalid_json' }, { status: 400 })
  }

  const { data: existing, error: loadErr } = await supabaseAdmin
    .from('center_assignments')
    .select('center_id, sourced_by, staff_id')
    .eq('id', id)
    .maybeSingle()

  if (loadErr || !existing) {
    return NextResponse.json({ errorKey: 'centerAssignments.errors.not_found' }, { status: 404 })
  }

  const allowedFields = [
    'staff_id',
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
  let mergedStaff: string | null
  if ('staff_id' in updates) {
    mergedStaff = (updates.staff_id as string | null) ?? null
  } else {
    mergedStaff = existing.staff_id
  }

  if (updates.sourced_by !== undefined || updates.staff_id !== undefined) {
    const errKey = validateSourcedStaff(mergedSourced, mergedStaff)
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
    const { createCommissionsForCenter } = await import('@/lib/commissions')
    await createCommissionsForCenter(existing.center_id)
  } catch (err) {
    console.error('[center-assignments] Commission refresh failed:', err)
  }

  return NextResponse.json({ assignment: data })
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
