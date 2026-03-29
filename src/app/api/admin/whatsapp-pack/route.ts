import { requireSuperAdminApi } from '@/lib/admin-auth'
import { currentMonthStr, deriveBillingSummary } from '@/lib/whatsapp-pack'
import type { NotificationTypes, WaPackBillingSummary, WaPackCenter } from '@/types/whatsapp-pack'
import { NextResponse } from 'next/server'

interface CenterRow {
  id: string
  name: string
  plan: string
  phone: string | null
  parent_pack_enabled: boolean | null
  parent_pack_active_parents: number | null
}

interface BillingRow {
  center_id: string
  amount: number | string
  status: string
}

export async function GET(request: Request) {
  const auth = await requireSuperAdminApi(request)
  if (!auth.ok) {
    return auth.response
  }

  const { supabaseAdmin } = auth
  const month = currentMonthStr()

  const [centersRes, configRes, billingRes] = await Promise.all([
    supabaseAdmin
      .from('centers')
      .select('id, name, plan, phone, parent_pack_enabled, parent_pack_active_parents')
      .order('parent_pack_enabled', { ascending: false })
      .order('name', { ascending: true }),
    supabaseAdmin
      .from('platform_config')
      .select('value')
      .eq('key', 'wa_pack_notification_types')
      .maybeSingle(),
    supabaseAdmin
      .from('parent_pack_billing')
      .select('center_id, amount, status')
      .eq('month', month),
  ])

  if (centersRes.error) {
    console.error('[GET /api/admin/whatsapp-pack] centers', centersRes.error)
    return NextResponse.json({ error: 'Failed to load centers' }, { status: 500 })
  }

  const defaultNotif: NotificationTypes = {
    scan: true,
    absence: true,
    balance: true,
    announcement: true,
  }
  const rawVal = configRes.data?.value as Partial<NotificationTypes> | null | undefined
  const notificationTypes: NotificationTypes = {
    scan: rawVal?.scan ?? defaultNotif.scan,
    absence: rawVal?.absence ?? defaultNotif.absence,
    balance: rawVal?.balance ?? defaultNotif.balance,
    announcement: rawVal?.announcement ?? defaultNotif.announcement,
  }

  const rawMap = new Map<string, Array<{ amount: number | string; status: string }>>()
  for (const row of (billingRes.data ?? []) as BillingRow[]) {
    const existing = rawMap.get(row.center_id) ?? []
    rawMap.set(row.center_id, [...existing, { amount: row.amount, status: row.status }])
  }

  const centers: WaPackCenter[] = ((centersRes.data ?? []) as CenterRow[]).map((c) => {
    const billing: WaPackBillingSummary = deriveBillingSummary(rawMap.get(c.id) ?? [])
    return {
      id: c.id,
      name: c.name,
      plan: c.plan,
      phone: c.phone,
      parent_pack_enabled: Boolean(c.parent_pack_enabled),
      parent_pack_active_parents: c.parent_pack_active_parents ?? 0,
      billing,
    }
  })

  const totalEnabled = centers.filter((c) => c.parent_pack_enabled).length
  const totalActiveParents = centers.reduce((s, c) => s + (c.parent_pack_active_parents ?? 0), 0)
  const totalMRR = totalActiveParents * 10

  return NextResponse.json({
    centers,
    notificationTypes,
    stats: { totalEnabled, totalActiveParents, totalMRR },
  })
}
