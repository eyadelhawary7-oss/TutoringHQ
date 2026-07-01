import { NextRequest, NextResponse } from 'next/server'
import { requireCenterAuth } from '@/lib/centerAuth'
import { currentMonthStr, deriveBillingSummary } from '@/lib/whatsapp-pack'
import type { NotificationTypes, WaPackBillingSummary, WaPackStudent } from '@/types/whatsapp-pack'

interface CenterSettingsRow {
  id: string
  name: string
  parent_pack_enabled: boolean
  parent_pack_active_parents: number
}

interface StudentRow {
  id: string
  name: string
  parent_phone: string | null
  parent_pack_opted_in: boolean | null
  notify_on_scan: boolean | null
  notify_on_absence: boolean | null
  notify_on_balance: boolean | null
  parent_consent_given: boolean | null
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request)
    if (!auth.ok) return auth.response
    const role = String(auth.role ?? '').toLowerCase()
    if (role !== 'owner' && role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { centerId, supabaseAdmin } = auth
    const month = currentMonthStr()

    const [centerRes, configRes, studentsRes, billingRes] = await Promise.all([
      supabaseAdmin
        .from('centers')
        .select('id, name, parent_pack_enabled, parent_pack_active_parents')
        .eq('id', centerId)
        .single(),
      supabaseAdmin
        .from('platform_config')
        .select('value')
        .eq('key', 'wa_pack_notification_types')
        .maybeSingle(),
      supabaseAdmin
        .from('students')
        .select(
          'id, name, parent_phone, parent_pack_opted_in, notify_on_scan, notify_on_absence, notify_on_balance, parent_consent_given',
        )
        .eq('center_id', centerId)
        .eq('is_active', true)
        .not('parent_phone', 'is', null)
        .order('name', { ascending: true }),
      supabaseAdmin
        .from('parent_pack_billing')
        .select('amount, status')
        .eq('center_id', centerId)
        .eq('month', month),
    ])

    if (centerRes.error || !centerRes.data) {
      console.error('[GET /api/whatsapp-pack/settings] center', centerRes.error)
      return NextResponse.json({ error: 'Failed to load center' }, { status: 500 })
    }

    const center = centerRes.data as CenterSettingsRow

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

    const billing: WaPackBillingSummary = deriveBillingSummary(billingRes.data ?? [])

    const students: WaPackStudent[] = ((studentsRes.data ?? []) as StudentRow[]).map((r) => ({
      id: r.id,
      name: r.name,
      parent_phone: r.parent_phone ?? '',
      parent_pack_opted_in: Boolean(r.parent_pack_opted_in),
      notify_on_scan: Boolean(r.notify_on_scan),
      notify_on_absence: Boolean(r.notify_on_absence),
      notify_on_balance: Boolean(r.notify_on_balance),
      parent_consent_given: Boolean(r.parent_consent_given),
    }))

    return NextResponse.json({
      center,
      notificationTypes,
      students,
      billing,
    })
  } catch (e) {
    console.error('[GET /api/whatsapp-pack/settings]', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
