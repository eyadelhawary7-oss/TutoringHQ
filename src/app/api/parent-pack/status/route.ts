import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getActivePackParentCount, calculatePackCharge } from '@/lib/parent-pack'
import { PARENT_PACK } from '@/types/parent-pack'

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    const authHeader = request.headers.get('Authorization')
    const accessToken = authHeader?.replace('Bearer ', '')

    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    })

    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: userData, error: userErr } = await supabaseAdmin
      .from('users')
      .select('center_id')
      .eq('id', user.id)
      .single()

    if (userErr || !userData?.center_id) {
      return NextResponse.json({ error: 'No center' }, { status: 400 })
    }

    const centerId = userData.center_id as string

    const { data: center, error: centerErr } = await supabaseAdmin
      .from('centers')
      .select('parent_pack_enabled, parent_pack_active_parents')
      .eq('id', centerId)
      .single()

    if (centerErr || !center) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 })
    }

    const activeCount = await getActivePackParentCount(supabaseAdmin, centerId)
    const monthlyCharge = calculatePackCharge(center.parent_pack_enabled ?? false, activeCount)

    return NextResponse.json({
      pack_enabled: center.parent_pack_enabled ?? false,
      active_parents: activeCount,
      monthly_charge: monthlyCharge,
      price_per_parent: PARENT_PACK.ALL_IN_PRICE,
      center_profit_per_parent: PARENT_PACK.CENTER_PROFIT_PER_PARENT,
      suggested_center_price: PARENT_PACK.CENTER_CHARGE_TO_PARENT,
      max_announcements_per_month: PARENT_PACK.MAX_ANNOUNCEMENTS_PER_MONTH,
    })
  } catch (error) {
    console.error('[parent-pack/status]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
