import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import AdminVendorsClient from './AdminVendorsClient';

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

type VendorRow = {
  id: string;
  name: string;
  whatsapp_number: string;
  pickup_address: string;
  city: string;
  is_active: boolean;
  created_at?: string | null;
};

export default async function AdminVendorsPage({
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
  const res = await fetch(`${origin}/api/admin/vendors`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
  });

  if (res.status === 403 || res.status === 401 || !res.ok) {
    redirect(`/${locale}/ceo-dashboard`);
  }

  let vendor: VendorRow | null = null;
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const v = (parsed as { vendor?: unknown }).vendor;
      if (v && typeof v === 'object' && v !== null && 'id' in v) {
        vendor = v as VendorRow;
      }
    }
  } catch {
    redirect(`/${locale}/ceo-dashboard`);
  }

  return <AdminVendorsClient initialVendor={vendor} />;
}
