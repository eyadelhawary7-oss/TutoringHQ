import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null

async function getAdminUser(request: Request) {
  if (!supabaseUrl || !supabaseAnonKey || !supabaseAdmin) return null

  const cookieStore = await cookies()
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch {
          /* read-only cookies */
        }
      },
    },
  })

  let userId: string | null = null
  const {
    data: { user: cookieUser },
  } = await supabase.auth.getUser()
  if (cookieUser) userId = cookieUser.id
  else {
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const {
        data: { user: bearerUser },
        error,
      } = await supabase.auth.getUser(token)
      if (bearerUser && !error) userId = bearerUser.id
    }
  }

  if (!userId) return null
  const { data: adminUser } = await supabaseAdmin
    .from('admin_users')
    .select('id, role')
    .eq('id', userId)
    .single()
  return adminUser
}

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

  const admin = await getAdminUser(request)
  if (!admin) {
    return NextResponse.json({ errorKey: 'centerAssignments.errors.unauthorized' }, { status: 401 })
  }
  if (admin.role !== 'super_admin') {
    return NextResponse.json(
      { errorKey: 'centerAssignments.errors.forbidden_super_admin' },
      { status: 403 },
    )
  }

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
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
