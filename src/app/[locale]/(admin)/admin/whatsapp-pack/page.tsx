import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { NotificationTypes, WaPackCenter } from '@/types/whatsapp-pack'
import AdminWaPackClient from './AdminWaPackClient'

function internalBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return 'http://localhost:3000'
}

interface AdminPackResponse {
  centers: WaPackCenter[]
  notificationTypes: NotificationTypes
  stats: { totalEnabled: number; totalActiveParents: number; totalMRR: number }
}

export default async function AdminWhatsAppPackPage({
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

  const res = await fetch(`${internalBaseUrl()}/api/admin/whatsapp-pack`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
  })

  if (res.status === 403 || res.status === 401 || !res.ok) {
    redirect(`/${locale}/ceo-dashboard`)
  }

  const data = (await res.json()) as AdminPackResponse

  return (
    <AdminWaPackClient
      initialCenters={data.centers}
      initialNotificationTypes={data.notificationTypes}
      initialStats={data.stats}
    />
  )
}
