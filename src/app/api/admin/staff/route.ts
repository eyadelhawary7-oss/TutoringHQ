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
          /* Server Component / read-only cookie context */
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

// GET /api/admin/staff — list all staff with aggregated stats
export async function GET(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { errorKey: 'staff.errors.listFailed' },
      { status: 500 },
    )
  }

  const admin = await getAdminUser(request)
  if (!admin) {
    return NextResponse.json({ errorKey: 'staff.errors.unauthorized' }, { status: 401 })
  }

  const { data: staffList, error } = await supabaseAdmin
    .from('staff')
    .select(`*, manager:staff!reports_to(id, name)`)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json(
      { errorKey: 'staff.errors.listFailed', error: error.message },
      { status: 500 },
    )
  }

  const enriched = await Promise.all(
    (staffList ?? []).map(async (member) => {
      const { count: centerCount } = await supabaseAdmin
        .from('center_assignments')
        .select('*', { count: 'exact', head: true })
        .eq('staff_id', member.id)
        .eq('is_primary', true)
        .eq('assignment_status', 'approved')

      const currentYear = new Date().getFullYear()
      const { data: payouts } = await supabaseAdmin
        .from('commission_payouts')
        .select('total_amount')
        .eq('staff_id', member.id)
        .gte('period', `${currentYear}-01`)
        .lte('period', `${currentYear}-12`)
        .in('status', ['confirmed', 'paid'])

      const ytdCommission = (payouts ?? []).reduce(
        (sum, p) => sum + Number(p.total_amount),
        0,
      )
      return { ...member, center_count: centerCount ?? 0, ytd_commission: ytdCommission }
    }),
  )

  return NextResponse.json({ staff: enriched })
}

// POST /api/admin/staff — create new staff (super_admin only)
export async function POST(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { errorKey: 'staff.errors.saveFailed' },
      { status: 500 },
    )
  }

  const admin = await getAdminUser(request)
  if (!admin) {
    return NextResponse.json({ errorKey: 'staff.errors.unauthorized' }, { status: 401 })
  }
  if (admin.role !== 'super_admin') {
    return NextResponse.json({ errorKey: 'staff.errors.forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const {
    name,
    phone,
    role,
    city,
    territory,
    territory_city,
    base_salary,
    hire_date,
    reports_to,
    notes,
  } = body

  if (!name || !phone || !role || !city) {
    return NextResponse.json({ errorKey: 'staff.errors.missingRequired' }, { status: 400 })
  }
  if (!['sm', 'sr'].includes(role)) {
    return NextResponse.json({ errorKey: 'staff.errors.invalidRole' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('staff')
    .insert({
      name,
      phone,
      role,
      city,
      territory: territory ?? null,
      territory_city: territory_city ?? null,
      base_salary: Number(base_salary) || (role === 'sm' ? 30000 : 15000),
      hire_date: hire_date || new Date().toISOString().split('T')[0],
      reports_to: reports_to || null,
      notes: notes ?? null,
    })
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

  return NextResponse.json({ staff: data }, { status: 201 })
}
