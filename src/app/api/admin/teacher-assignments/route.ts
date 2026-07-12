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

// Two FKs from teacher_assignments -> staff (staff_id, manager_staff_id), so the staff
// embed must disambiguate by column. Teacher display info is enriched in JS below.
const TEACHER_ASSIGNMENT_SELECT = `
        *,
        staff:staff!staff_id (
          id, name, role, city
        ),
        manager:staff!manager_staff_id (
          id, name, role, city
        )
      `

type AssignmentRow = Record<string, unknown> & { teacher_id?: string | null }

/** Attach a { teacher_id, name, subject } object to each assignment row. */
async function enrichTeacherInfo(
  admin: SupabaseClient,
  rows: AssignmentRow[],
): Promise<AssignmentRow[]> {
  const teacherIds = [
    ...new Set(rows.map((r) => r.teacher_id).filter((x): x is string => typeof x === 'string')),
  ]
  if (teacherIds.length === 0) return rows

  const [{ data: profiles }, { data: users }] = await Promise.all([
    admin.from('teacher_profiles').select('user_id, display_name, subject').in('user_id', teacherIds),
    admin.from('users').select('id, name').in('id', teacherIds),
  ])
  const profileById = new Map(
    (profiles ?? []).map((p) => [
      (p as { user_id: string }).user_id,
      p as { display_name: string | null; subject: string | null },
    ]),
  )
  const nameById = new Map(
    (users ?? []).map((u) => [(u as { id: string }).id, (u as { name: string | null }).name]),
  )

  return rows.map((r) => {
    const tid = typeof r.teacher_id === 'string' ? r.teacher_id : null
    const prof = tid ? profileById.get(tid) : undefined
    const name = (prof?.display_name || (tid ? nameById.get(tid) : null) || null) as string | null
    return { ...r, teacher: { teacher_id: tid, name, subject: prof?.subject ?? null } }
  })
}

// GET /api/admin/teacher-assignments
export async function GET(request: Request) {
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

  const isFullAdmin = requireAdminRole(ctx, ['super_admin', 'admin']) === null
  const isManager = ctx.adminRole === 'sales_manager'
  if (!isFullAdmin && !isManager) {
    return NextResponse.json({ errorKey: 'teacherAssignments.errors.unauthorized' }, { status: 403 })
  }

  // ── Manager view ──
  if (isManager && !isFullAdmin) {
    const { data: staffRow } = await supabaseAdmin
      .from('staff')
      .select('id')
      .eq('user_id', ctx.userId)
      .maybeSingle()
    const managerStaffId = (staffRow as { id?: string } | null)?.id ?? null
    if (!managerStaffId) {
      return NextResponse.json({
        assignments: [],
        all_teachers: [],
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
      .from('teacher_assignments')
      .select(TEACHER_ASSIGNMENT_SELECT)
      .or(`manager_staff_id.eq.${managerStaffId},staff_id.in.(${scopeIds.join(',')})`)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json(
        { errorKey: 'teacherAssignments.errors.list_failed', detail: error.message },
        { status: 500 },
      )
    }

    const enriched = await enrichTeacherInfo(supabaseAdmin, (assignments ?? []) as AssignmentRow[])
    return NextResponse.json({
      assignments: enriched,
      all_teachers: [],
      staff: repList,
      reps: repList,
      viewer: { role: 'sales_manager', staff_id: managerStaffId },
    })
  }

  // ── CEO / internal_admin view ──
  const [assignmentsRes, teacherProfilesRes, staffRes] = await Promise.all([
    supabaseAdmin
      .from('teacher_assignments')
      .select(TEACHER_ASSIGNMENT_SELECT)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('teacher_profiles')
      .select('user_id, display_name, subject, is_test')
      .eq('is_test', false),
    supabaseAdmin
      .from('staff')
      .select('id, name, role, city, status')
      .eq('status', 'active')
      .order('name'),
  ])

  if (assignmentsRes.error) {
    return NextResponse.json(
      { errorKey: 'teacherAssignments.errors.list_failed', detail: assignmentsRes.error.message },
      { status: 500 },
    )
  }

  const assignments = (assignmentsRes.data ?? []) as AssignmentRow[]
  const enriched = await enrichTeacherInfo(supabaseAdmin, assignments)

  const profiles = teacherProfilesRes.data ?? []
  const teacherUserIds = profiles.map((p) => (p as { user_id: string }).user_id)
  const { data: teacherUsers } =
    teacherUserIds.length > 0
      ? await supabaseAdmin.from('users').select('id, name').in('id', teacherUserIds)
      : { data: [] as { id: string; name: string | null }[] }
  const nameById = new Map(
    (teacherUsers ?? []).map((u) => [(u as { id: string }).id, (u as { name: string | null }).name]),
  )
  const allTeachers = profiles.map((p) => {
    const row = p as { user_id: string; display_name: string | null; subject: string | null }
    return {
      user_id: row.user_id,
      name: row.display_name || nameById.get(row.user_id) || row.user_id,
      subject: row.subject,
    }
  })

  const assignedTeacherIds = new Set(
    enriched.filter((a) => a.is_primary).map((a) => a.teacher_id),
  )
  const unassignedTeachers = allTeachers.filter((tch) => !assignedTeacherIds.has(tch.user_id))

  return NextResponse.json({
    assignments: enriched,
    all_teachers: allTeachers,
    unassigned_teachers: unassignedTeachers,
    staff: staffRes.data ?? [],
    reps: [],
    viewer: { role: 'super_admin' },
  })
}

/**
 * CEO batch-assigns a set of teachers to a Manager (super_admin only). Mirrors the center
 * batch flow: manager_staff_id set, staff_id NULL, status pending_sm_approval, sourced_by
 * 'sm'. Manual upsert against the one_primary_per_teacher partial unique index. No commission
 * logic is touched.
 */
async function batchAssignTeachersToManager(
  admin: SupabaseClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const teacherIds = (body.teacher_ids as unknown[]).filter(
    (x): x is string => typeof x === 'string' && x.length > 0,
  )
  const managerStaffId = body.manager_staff_id as string | undefined

  if (!managerStaffId || teacherIds.length === 0) {
    return NextResponse.json(
      { errorKey: 'teacherAssignments.errors.batch_requires_manager_and_teachers' },
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
      { errorKey: 'teacherAssignments.errors.manager_not_sm' },
      { status: 400 },
    )
  }

  const { data: existing } = await admin
    .from('teacher_assignments')
    .select('id, teacher_id')
    .in('teacher_id', teacherIds)
    .eq('is_primary', true)
  const existingByTeacher = new Map(
    (existing ?? []).map((r) => [(r as { teacher_id: string }).teacher_id, (r as { id: string }).id]),
  )

  const patch = {
    manager_staff_id: managerStaffId,
    staff_id: null,
    assignment_status: 'pending_sm_approval',
    sourced_by: 'sm',
    assigned_by: userId,
  }

  const toInsert: Record<string, unknown>[] = []
  for (const tid of teacherIds) {
    const existingId = existingByTeacher.get(tid)
    if (existingId) {
      const { error } = await admin.from('teacher_assignments').update(patch).eq('id', existingId)
      if (error) {
        return NextResponse.json(
          { errorKey: 'teacherAssignments.errors.save_failed', detail: error.message },
          { status: 500 },
        )
      }
    } else {
      toInsert.push({ teacher_id: tid, is_primary: true, ...patch })
    }
  }

  if (toInsert.length > 0) {
    const { error } = await admin.from('teacher_assignments').insert(toInsert)
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
  }

  return NextResponse.json({ success: true, assigned: teacherIds.length }, { status: 201 })
}

// POST /api/admin/teacher-assignments — CEO batch-assign teachers to a manager.
export async function POST(request: Request) {
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

  let body: Record<string, unknown>
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>
  } catch {
    return NextResponse.json({ errorKey: 'teacherAssignments.errors.invalid_json' }, { status: 400 })
  }

  if (!Array.isArray(body.teacher_ids)) {
    return NextResponse.json(
      { errorKey: 'teacherAssignments.errors.batch_requires_manager_and_teachers' },
      { status: 400 },
    )
  }

  const roleErr = requireAdminRole(ctx, ['super_admin'])
  if (roleErr) return roleErr

  return batchAssignTeachersToManager(supabaseAdmin, ctx.userId, body)
}

// DELETE /api/admin/teacher-assignments?id=<assignment_id>
export async function DELETE(request: Request) {
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

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) {
    return NextResponse.json({ errorKey: 'teacherAssignments.errors.id_required' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('teacher_assignments').delete().eq('id', id)
  if (error) {
    return NextResponse.json(
      { errorKey: 'teacherAssignments.errors.save_failed', detail: error.message },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true })
}
