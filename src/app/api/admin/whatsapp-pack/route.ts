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
  announcement_balance: number | string | null
  pack_request_status: string | null
  pack_requested_at: string | null
  pack_rejection_reason: string | null
  pack_pending_balance: number | string | null
  pack_months_without_invoice: number | string | null
  pack_custom_invoice_minimum: number | string | null
}

interface BillingRow {
  center_id: string
  amount: number | string
  status: string
}

function asNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export async function GET(request: Request) {
  const auth = await requireSuperAdminApi(request)
  if (!auth.ok) {
    return auth.response
  }

  const { supabaseAdmin } = auth
  const month = currentMonthStr()

  const [centersRes, configRes, billingRes, pendingReqRes] = await Promise.all([
    supabaseAdmin
      .from('centers')
      .select(
        `id, name, plan, phone, parent_pack_enabled, parent_pack_active_parents, announcement_balance,
        pack_request_status, pack_requested_at, pack_rejection_reason,
        pack_pending_balance, pack_months_without_invoice, pack_custom_invoice_minimum`,
      )
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
    supabaseAdmin
      .from('centers')
      .select('id', { count: 'exact', head: true })
      .eq('pack_request_status', 'pending'),
  ])

  if (centersRes.error) {
    console.error('[GET /api/admin/whatsapp-pack] centers', centersRes.error)
    return NextResponse.json({ error: 'Failed to load centers' }, { status: 500 })
  }

  if (pendingReqRes.error) {
    console.error('[GET /api/admin/whatsapp-pack] pending requests', pendingReqRes.error)
    return NextResponse.json({ error: 'Failed to load pending requests' }, { status: 500 })
  }

  const pendingRequestCount = pendingReqRes.count ?? 0

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
    const cm = c.pack_custom_invoice_minimum
    const customMinResolved =
      cm != null && cm !== ''
        ? asNum(cm)
        : null
    return {
      id: c.id,
      name: c.name,
      plan: c.plan,
      phone: c.phone,
      parent_pack_enabled: Boolean(c.parent_pack_enabled),
      parent_pack_active_parents: asNum(c.parent_pack_active_parents),
      announcement_balance: asNum(c.announcement_balance),
      billing,
      pack_request_status: c.pack_request_status ?? 'none',
      pack_requested_at: c.pack_requested_at ?? null,
      pack_rejection_reason: c.pack_rejection_reason ?? null,
      pack_pending_balance: asNum(c.pack_pending_balance),
      pack_months_without_invoice: asNum(c.pack_months_without_invoice),
      pack_custom_invoice_minimum:
        customMinResolved != null && customMinResolved > 0 ? customMinResolved : null,
    }
  })

  const totalEnabled = centers.filter((c) => c.parent_pack_enabled).length
  const totalActiveParents = centers.reduce((s, c) => s + asNum(c.parent_pack_active_parents), 0)
  /** Parent pack default inclusive EGP/parent/month — aligns with PRICING_SPEC / centres.pack_price_per_parent default */
  const PARENT_PACK_MONTHLY_EGP = 12
  const totalMRR = totalActiveParents * PARENT_PACK_MONTHLY_EGP

  return NextResponse.json({
    centers,
    notificationTypes,
    stats: { totalEnabled, totalActiveParents, totalMRR },
    pendingRequestCount,
  })
}
