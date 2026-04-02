import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import type { AdminCardOrderRow } from '@/types/admin-card-orders';
import AdminOrdersClient from './AdminOrdersClient';

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

export default async function AdminOrdersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
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
  const res = await fetch(`${origin}/api/admin/card-orders`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
  });

  if (res.status === 403 || res.status === 401 || !res.ok) {
    redirect(`/${locale}/ceo-dashboard`);
  }

  let orders: AdminCardOrderRow[] = [];
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const o = (parsed as { orders?: unknown }).orders;
      if (Array.isArray(o)) {
        orders = o as AdminCardOrderRow[];
      }
    }
  } catch {
    redirect(`/${locale}/ceo-dashboard`);
  }

  return <AdminOrdersClient initialOrders={orders} />;
}
