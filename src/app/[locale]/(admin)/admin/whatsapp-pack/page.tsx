import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { NotificationTypes, WaPackCenter } from '@/types/whatsapp-pack'
import AdminWaPackClient from './AdminWaPackClient'
import WaMetaTemplatesPanel from '@/components/admin/WaMetaTemplatesPanel'

/** When NEXT_PUBLIC_SITE_URL is a different host than the incoming request (preview, alt domain), server-side fetch must target this deployment. */
function envFallbackOrigin(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    const trimmed = process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
    try {
      return new URL(trimmed).origin
    } catch {
      return trimmed
    }
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return 'http://localhost:3000'
}

async function sameDeploymentOrigin(): Promise<string> {
  const h = await headers()
  const host =
    h.get('x-forwarded-host')?.split(',')[0]?.trim() ?? h.get('host') ?? ''
  if (!host) {
    return envFallbackOrigin()
  }
  const protoHdr = h.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const protocol =
    protoHdr === 'http' || protoHdr === 'https'
      ? protoHdr
      : host.startsWith('localhost') || host.startsWith('127.')
        ? 'http'
        : 'https'
  return `${protocol}://${host}`
}

interface AdminPackResponse {
  centers: WaPackCenter[]
  notificationTypes: NotificationTypes
  stats: { totalEnabled: number; totalActiveParents: number; totalMRR: number }
  pendingRequestCount?: number
  /** Merged-Admin-Platform §04 — the platform sender's Meta templates. */
  metaTemplates?: { name: string; category: string; status: string }[]
}

export default async function AdminWhatsAppPackPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ include_test?: string }>
}) {
  const { locale } = await params
  const sp = await searchParams
  const includeTestQs = sp.include_test === '1' ? '?include_test=1' : ''
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect(`/${locale}/login`)
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    redirect(`/${locale}/login`)
  }

  const origin = await sameDeploymentOrigin()
  const res = await fetch(`${origin}/api/admin/whatsapp-pack${includeTestQs}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
  })

  if (res.status === 403 || res.status === 401 || !res.ok) {
    redirect(`/${locale}/ceo-dashboard`)
  }

  let data: Partial<AdminPackResponse> = {}
  try {
    const parsed: unknown = await res.json()
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Partial<AdminPackResponse>
    }
  } catch {
    redirect(`/${locale}/ceo-dashboard`)
  }
  const defaultNotif: NotificationTypes = {
    scan: true,
    absence: true,
    balance: true,
    announcement: true,
  }

  return (
    <>
      {/* Merged-Admin-Platform §04, templates frame. */}
      <div className="px-4 pt-4 md:px-6 lg:ms-56">
        <WaMetaTemplatesPanel templates={data.metaTemplates ?? []} />
      </div>
      <AdminWaPackClient
      initialCenters={Array.isArray(data.centers) ? data.centers : []}
      initialNotificationTypes={{ ...defaultNotif, ...(data.notificationTypes ?? {}) }}
      initialStats={{
        totalEnabled: Number(data.stats?.totalEnabled),
        totalActiveParents: Number(data.stats?.totalActiveParents),
        totalMRR: Number(data.stats?.totalMRR),
      }}
        pendingRequestCount={Number(data.pendingRequestCount ?? 0)}
      />
    </>
  )
}
