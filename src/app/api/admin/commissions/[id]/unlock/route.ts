import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { parseBodyWithLimit } from '@/lib/validate';

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

// PATCH — manual T2 unlock, super_admin only.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!supabaseAdmin) {
    return NextResponse.json({ errorKey: 'commissions.errors.saveFailed' }, { status: 500 })
  }

  const admin = await getAdminUser(request)
  if (!admin) {
    return NextResponse.json({ errorKey: 'commissions.errors.unauthorized' }, { status: 401 })
  }
  if (admin.role !== 'super_admin') {
    return NextResponse.json({ errorKey: 'commissions.errors.forbidden' }, { status: 403 })
  }

  const { id } = await params
  let body: unknown
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { reason } = body as { reason?: unknown }

  if (!reason || String(reason).trim().length < 10) {
    return NextResponse.json({ errorKey: 'commissions.errors.reasonTooShort' }, { status: 400 })
  }

  const { data: commission, error: fetchErr } = await supabaseAdmin
    .from('commissions')
    .select('id, t2_status, t2_amount')
    .eq('id', id)
    .single()

  if (fetchErr || !commission) {
    return NextResponse.json({ errorKey: 'commissions.errors.notFound' }, { status: 404 })
  }
  if (commission.t2_status !== 'locked') {
    return NextResponse.json(
      {
        errorKey: 'commissions.errors.cannotUnlock',
        errorParams: { status: commission.t2_status },
      },
      { status: 400 },
    )
  }

  const today = new Date().toISOString().split('T')[0]

  const { error: upErr } = await supabaseAdmin
    .from('commissions')
    .update({ t2_status: 'eligible', t2_eligible_at: today })
    .eq('id', id)

  if (upErr) {
    return NextResponse.json(
      { errorKey: 'commissions.errors.saveFailed', error: upErr.message },
      { status: 500 },
    )
  }

  const { error: auditErr } = await supabaseAdmin.from('commission_audit_log').insert({
    commission_id: id,
    action: 't2_manual_unlock',
    performed_by: admin.id,
    triggered_by: 'manual',
    reason: String(reason).trim(),
    previous_value: { t2_status: 'locked' },
    new_value: { t2_status: 'eligible', t2_eligible_at: today },
  })

  if (auditErr) {
    return NextResponse.json(
      { errorKey: 'commissions.errors.saveFailed', error: auditErr.message },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, t2_status: 'eligible', t2_eligible_at: today })
}
