import { NextRequest, NextResponse } from 'next/server'
import { requireCenterAuth } from '@/lib/centerAuth'
import { getActivePackParentCount, calculatePackCharge } from '@/lib/parent-pack'
import { PARENT_PACK } from '@/types/parent-pack'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request)
    if (!auth.ok) return auth.response
    const { centerId, supabaseAdmin } = auth

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
