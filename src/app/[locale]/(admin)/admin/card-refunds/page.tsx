import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/admin-auth';
import AdminCardRefundsClient, { type CardRefundsApiPayload } from './AdminCardRefundsClient';

function envFallbackOrigin(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    const trimmed = process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
    try {
      return new URL(trimmed).origin;
    } catch {
      return trimmed;
    }
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:3000';
}

async function sameDeploymentOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host')?.split(',')[0]?.trim() ?? h.get('host') ?? '';
  if (!host) {
    return envFallbackOrigin();
  }
  const protoHdr = h.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol =
    protoHdr === 'http' || protoHdr === 'https'
      ? protoHdr
      : host.startsWith('localhost') || host.startsWith('127.')
        ? 'http'
        : 'https';
  return `${protocol}://${host}`;
}

const emptyPayload: CardRefundsApiPayload = {
  orders: [],
  total: 0,
  page: 1,
  pageSize: 20,
  pendingCount: 0,
};

export default async function AdminCardRefundsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const ctx = await getAdminContext(new Request('https://admin-card-refunds.internal'));
  if (!ctx) {
    redirect(`/${locale}/login`);
  }
  if (ctx.internalRole === 'internal_viewer') {
    redirect(`/${locale}/dashboard`);
  }

  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect(`/${locale}/login`);
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    redirect(`/${locale}/login`);
  }

  const origin = await sameDeploymentOrigin();
  const qs = new URLSearchParams({
    status: 'all',
    page: '1',
    pageSize: '20',
    sort: 'refund_requested_at',
    dir: 'desc',
  });
  const res = await fetch(`${origin}/api/admin/card-order-refunds?${qs}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
  });

  if (res.status === 403 || res.status === 401 || !res.ok) {
    redirect(`/${locale}/ceo-dashboard`);
  }

  let payload: CardRefundsApiPayload = emptyPayload;
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const p = parsed as Partial<CardRefundsApiPayload>;
      payload = {
        orders: Array.isArray(p.orders) ? p.orders : [],
        total: typeof p.total === 'number' ? p.total : 0,
        page: typeof p.page === 'number' ? p.page : 1,
        pageSize: typeof p.pageSize === 'number' ? p.pageSize : 20,
        pendingCount: typeof p.pendingCount === 'number' ? p.pendingCount : 0,
      };
    }
  } catch {
    redirect(`/${locale}/ceo-dashboard`);
  }

  return <AdminCardRefundsClient initialPayload={payload} />;
}
