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

export async function GET(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ errorKey: 'commissions.errors.listFailed' }, { status: 500 })
  }

  const admin = await getAdminUser(request)
  if (!admin) {
    return NextResponse.json({ errorKey: 'commissions.errors.unauthorized' }, { status: 401 })
  }
  if (admin.role !== 'super_admin') {
    return NextResponse.json({ errorKey: 'commissions.errors.forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const staffId = searchParams.get('staff_id')
  const plan = searchParams.get('plan')
  const t1Status = searchParams.get('t1_status')
  const t2Status = searchParams.get('t2_status')

  let query = supabaseAdmin
    .from('commissions')
    .select(
      `
      *,
      staff(id, name, role),
      centers(id, name, center_code, plan, billing_status, next_payment_due)
    `,
    )
    .order('created_at', { ascending: false })

  if (staffId) query = query.eq('staff_id', staffId)
  if (plan) query = query.eq('plan_at_signing', plan)
  if (t1Status) query = query.eq('t1_status', t1Status)
  if (t2Status) query = query.eq('t2_status', t2Status)

  const { data, error } = await query
  if (error) {
    return NextResponse.json(
      { errorKey: 'commissions.errors.listFailed', error: error.message },
      { status: 500 },
    )
  }

  const enriched = await Promise.all(
    (data ?? []).map(async (commission) => {
      const { data: activeDays } = await supabaseAdmin.rpc('compute_active_days', {
        p_commission_id: commission.id,
      })
      return { ...commission, active_days: activeDays ?? 0 }
    }),
  )

  return NextResponse.json({ commissions: enriched })
}
