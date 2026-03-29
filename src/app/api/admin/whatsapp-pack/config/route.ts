import { requireSuperAdminApi } from '@/lib/admin-auth'
import type { NotificationTypes } from '@/types/whatsapp-pack'
import { NextResponse } from 'next/server'

interface PatchBody {
  scan?: boolean
  absence?: boolean
  balance?: boolean
  announcement?: boolean
}

export async function GET(request: Request) {
  const auth = await requireSuperAdminApi(request)
  if (!auth.ok) {
    return auth.response
  }

  const { data, error } = await auth.supabaseAdmin
    .from('platform_config')
    .select('value')
    .eq('key', 'wa_pack_notification_types')
    .single()

  if (error || !data) {
    console.error('[GET /api/admin/whatsapp-pack/config]', error)
    return NextResponse.json({ error: 'Config not found' }, { status: 500 })
  }

  return NextResponse.json({
    notificationTypes: data.value as NotificationTypes,
  })
}

export async function PATCH(request: Request) {
  const auth = await requireSuperAdminApi(request)
  if (!auth.ok) {
    return auth.response
  }

  const { data: configRow, error: fetchError } = await auth.supabaseAdmin
    .from('platform_config')
    .select('value')
    .eq('key', 'wa_pack_notification_types')
    .single()

  if (fetchError || !configRow) {
    console.error('[PATCH /api/admin/whatsapp-pack/config] fetch', fetchError)
    return NextResponse.json({ error: 'Config not found' }, { status: 500 })
  }

  const current = configRow.value as NotificationTypes
  const body = (await request.json()) as PatchBody

  const merged: NotificationTypes = {
    scan: body.scan ?? current.scan,
    absence: body.absence ?? current.absence,
    balance: body.balance ?? current.balance,
    announcement: body.announcement ?? current.announcement,
  }

  const { error: updateError } = await auth.supabaseAdmin
    .from('platform_config')
    .update({
      value: merged,
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    })
    .eq('key', 'wa_pack_notification_types')

  if (updateError) {
    console.error('[PATCH /api/admin/whatsapp-pack/config] update', updateError)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true, notificationTypes: merged })
}
