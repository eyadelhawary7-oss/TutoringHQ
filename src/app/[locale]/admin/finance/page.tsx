import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { FinanceData } from '@/types/admin-finance';
import AdminFinanceClient from './AdminFinanceClient';

function envFallbackOrigin(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    const trimmed = process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
    try { return new URL(trimmed).origin; } catch { return trimmed; }
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

async function sameDeploymentOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host')?.split(',')[0]?.trim() ?? h.get('host') ?? '';
  if (!host) return envFallbackOrigin();
  const protoHdr = h.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = protoHdr === 'http' || protoHdr === 'https'
    ? protoHdr
    : host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  return `${protocol}://${host}`;
}

export default async function AdminFinancePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ include_test?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const financeQs = sp.include_test === '1' ? '?include_test=1' : '';
  const supabase = await createClient();

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect(`/${locale}/login`);

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) redirect(`/${locale}/login`);

  const origin = await sameDeploymentOrigin();
  const res = await fetch(`${origin}/api/admin/finance${financeQs}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
  });

  if (res.status === 403 || res.status === 401 || !res.ok) {
    redirect(`/${locale}/dashboard`);
  }

  let initialData: FinanceData;
  try {
    initialData = (await res.json()) as FinanceData;
  } catch {
    redirect(`/${locale}/dashboard`);
    return null;
  }

  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center min-h-[40vh] text-[var(--color-text-muted)] text-sm">
          Loading…
        </div>
      }
    >
      <AdminFinanceClient initialData={initialData} />
    </Suspense>
  );
}
