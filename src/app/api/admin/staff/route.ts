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

// GET /api/admin/staff - list all staff with aggregated stats
export async function GET(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { errorKey: 'staff.errors.listFailed' },
      { status: 500 },
    )
  }

  const ctx = await getAdminContext(request)
  if (!ctx) {
    return NextResponse.json({ errorKey: 'staff.errors.unauthorized' }, { status: 401 })
  }
  // Phase 4a: base_salary (salary) is CEO-only; strip it for every non-CEO caller.
  const isCEO = ctx.internalRole === 'super_admin'

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
      const row: Record<string, unknown> = {
        ...member,
        center_count: centerCount ?? 0,
        ytd_commission: ytdCommission,
      }
      if (!isCEO) delete row.base_salary
      return row
    }),
  )

  return NextResponse.json({ staff: enriched })
}

// POST /api/admin/staff - create new staff (super_admin or admin role)
export async function POST(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { errorKey: 'staff.errors.saveFailed' },
      { status: 500 },
    )
  }

  const ctx = await getAdminContext(request)
  if (!ctx) {
    return NextResponse.json({ errorKey: 'staff.errors.unauthorized' }, { status: 401 })
  }
  // Role gate added per docs/AUDIT_v22.md Phase 3 / Phase 8 P0 (Task 9)
  const roleErr = requireAdminRole(ctx, ['super_admin', 'admin'])
  if (roleErr) return roleErr

  let body: unknown
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
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
  } = body as Record<string, unknown>

  if (!name || !phone || !role || !city) {
    return NextResponse.json({ errorKey: 'staff.errors.missingRequired' }, { status: 400 })
  }
  if (!['sm', 'sr'].includes(String(role))) {
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
