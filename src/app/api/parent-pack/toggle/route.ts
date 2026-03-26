import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { syncPackParentCount } from '@/lib/parent-pack'

async function getCenterUserContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null

  const authHeader = request.headers.get('Authorization')
  const accessToken = authHeader?.replace('Bearer ', '')
  if (!accessToken) return null

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })

  const { data: { user }, error } = await supabaseAuth.auth.getUser()
  if (error || !user) return null

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id, role')
    .eq('id', user.id)
    .single()

  if (!userRecord?.center_id) return null

  return { userRecord, supabaseAdmin, centerId: userRecord.center_id as string }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await getCenterUserContext(request)
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const role = ctx.userRecord.role as string
    if (role !== 'owner' && role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { enabled } = (await request.json()) as { enabled: boolean }

    const { data: centerRow, error: centerErr } = await ctx.supabaseAdmin
      .from('centers')
      .select('id, status, parent_pack_enabled, parent_pack_active_parents')
      .eq('id', ctx.centerId)
      .single()

    if (centerErr || !centerRow) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 })
    }

    if (enabled && centerRow.status !== 'active') {
      return NextResponse.json({ error: 'center_not_active' }, { status: 400 })
    }

    const updateData = enabled
      ? { parent_pack_enabled: true }
      : { parent_pack_enabled: false, parent_pack_active_parents: 0 }

    const { error: updateErr } = await ctx.supabaseAdmin
      .from('centers')
      .update(updateData)
      .eq('id', ctx.centerId)

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    let activeCount = 0
    if (enabled) {
      activeCount = await syncPackParentCount(ctx.supabaseAdmin, ctx.centerId)
    }

    return NextResponse.json({
      pack_enabled: enabled,
      active_parents: activeCount,
    })
  } catch (e) {
    console.error('[PATCH /api/parent-pack/toggle]', e)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
