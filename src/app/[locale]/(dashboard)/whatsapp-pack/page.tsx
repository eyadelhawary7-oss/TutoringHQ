import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { NotificationTypes, WaPackBillingSummary, WaPackStudent } from '@/types/whatsapp-pack'
import WaPackClient from './WaPackClient'

function internalBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return 'http://localhost:3000'
}

interface SettingsResponse {
  center: {
    id: string
    name: string
    parent_pack_enabled: boolean
    parent_pack_active_parents: number
  }
  notificationTypes: NotificationTypes
  students: WaPackStudent[]
  billing: WaPackBillingSummary
}

export default async function WhatsAppPackPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    redirect(`/${locale}/login`)
  }

  const res = await fetch(`${internalBaseUrl()}/api/whatsapp-pack/settings`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
  })

  if (!res.ok) {
    redirect(`/${locale}/dashboard`)
  }

  const data = (await res.json()) as SettingsResponse

  return (
    <WaPackClient
      initialCenter={data.center}
      initialNotificationTypes={data.notificationTypes}
      initialStudents={data.students}
      initialBilling={data.billing}
    />
  )
}
