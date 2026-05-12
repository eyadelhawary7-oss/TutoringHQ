import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { parseBodyWithLimit } from '@/lib/validate';
import { requireAdminRole } from '@/lib/admin-auth';

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
          /* read-only cookie context */
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!supabaseAdmin) {
    return NextResponse.json({ errorKey: 'staff.errors.listFailed' }, { status: 500 })
  }

  const admin = await getAdminUser(request)
  if (!admin) {
    return NextResponse.json({ errorKey: 'staff.errors.unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const { data: member, error } = await supabaseAdmin
    .from('staff')
    .select(`*, manager:staff!reports_to(id, name)`)
    .eq('id', id)
    .single()

  if (error) {
    return NextResponse.json({ errorKey: 'staff.errors.notFound' }, { status: 404 })
  }

  const { data: commissions } = await supabaseAdmin
    .from('commissions')
    .select(
      'id, total_commission, t1_status, t2_status, loyalty_bonus_status, plan_at_signing, commission_type',
    )
    .eq('staff_id', id)

  const { data: payouts } = await supabaseAdmin
    .from('commission_payouts')
    .select('id, period, total_amount, status, created_at')
    .eq('staff_id', id)
    .order('period', { ascending: false })
    .limit(12)

  return NextResponse.json({
    staff: member,
    commissions: commissions ?? [],
    payouts: payouts ?? [],
  })
}

// PATCH /api/admin/staff/[id] — update or terminate (super_admin only)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!supabaseAdmin) {
    return NextResponse.json({ errorKey: 'staff.errors.saveFailed' }, { status: 500 })
  }

  const admin = await getAdminUser(request)
  if (!admin) {
    return NextResponse.json({ errorKey: 'staff.errors.unauthorized' }, { status: 401 })
  }
  // Role gate added per docs/AUDIT_v22.md Phase 3 / Phase 8 P0 (Task 9)
  const roleErr = requireAdminRole(admin, ['super_admin', 'admin'])
  if (roleErr) return roleErr

  const { id } = await params
  let body: unknown
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const b = body as Record<string, unknown>

  const allowedFields = [
    'name',
    'phone',
    'role',
    'city',
    'territory',
    'territory_city',
    'base_salary',
    'hire_date',
    'reports_to',
    'status',
    'termination_date',
    'termination_type',
    'notes',
  ]

  const updates: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (field in b) updates[field] = b[field]
  }

  if (updates.status === 'terminated') {
    if (!updates.termination_type || !updates.termination_date) {
      return NextResponse.json(
        { errorKey: 'staff.errors.terminationRequired' },
        { status: 400 },
      )
    }
    if (['resigned', 'terminated'].includes(updates.termination_type as string)) {
      await supabaseAdmin
        .from('commissions')
        .update({ t2_status: 'forfeited' })
        .eq('staff_id', id)
        .in('t2_status', ['locked', 'eligible'])

      await supabaseAdmin
        .from('commissions')
        .update({ loyalty_bonus_status: 'forfeited' })
        .eq('staff_id', id)
        .in('loyalty_bonus_status', ['locked', 'eligible'])
    }
  }

  const { data, error } = await supabaseAdmin
    .from('staff')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ errorKey: 'staff.errors.phoneDuplicate' }, { status: 409 })
    }
    return NextResponse.json(
      { errorKey: 'staff.errors.saveFailed', error: error.message },
      { status: 500 },
    )
  }
  return NextResponse.json({ staff: data })
}

// DELETE /api/admin/staff/[id] — remove a staff member (super_admin or admin)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!supabaseAdmin) {
    return NextResponse.json({ errorKey: 'staff.errors.saveFailed' }, { status: 500 })
  }

  const admin = await getAdminUser(request)
  if (!admin) {
    return NextResponse.json({ errorKey: 'staff.errors.unauthorized' }, { status: 401 })
  }
  // Role gate added per docs/AUDIT_v22.md Phase 3 / Phase 8 P0 (Task 9)
  const roleErr = requireAdminRole(admin, ['super_admin', 'admin'])
  if (roleErr) return roleErr

  const { id } = await params

  const { error } = await supabaseAdmin.from('staff').delete().eq('id', id)
  if (error) {
    return NextResponse.json(
      { errorKey: 'staff.errors.saveFailed', error: error.message },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true })
}
