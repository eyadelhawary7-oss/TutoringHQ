import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/admin-auth';
import { loadCardOrderDetailForAdmin } from '@/lib/loadCardOrderDetail';
import AdminCardOrderDetailClient from './AdminCardOrderDetailClient';

async function cookieRequestFromHeaders(): Promise<Request> {
  const h = await headers();
  const host = h.get('x-forwarded-host')?.split(',')[0]?.trim() ?? h.get('host') ?? 'localhost:3000';
  const protoHdr = h.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol =
    protoHdr === 'http' || protoHdr === 'https'
      ? protoHdr
      : host.startsWith('localhost') || host.startsWith('127.')
        ? 'http'
        : 'https';
  const cookie = h.get('cookie') ?? '';
  const authorization = h.get('authorization');
  const hdrs: Record<string, string> = {};
  if (cookie) hdrs.cookie = cookie;
  if (authorization) hdrs.authorization = authorization;
  return new Request(`${protocol}://${host}/admin/card-orders`, { headers: hdrs });
}

export default async function AdminCardOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orderId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { locale, orderId } = await params;
  const { returnTo } = await searchParams;

  const ctx = await getAdminContext(await cookieRequestFromHeaders());
  if (!ctx) {
    redirect(`/${locale}/login`);
  }
  if (ctx.internalRole === 'internal_viewer') {
    redirect(`/${locale}/admin/card-orders`);
  }

  const loaded = await loadCardOrderDetailForAdmin(ctx.supabaseAdmin, orderId);
  if (!loaded.ok) {
    notFound();
  }

  return (
    <AdminCardOrderDetailClient
      initialOrder={loaded.payload}
      returnTo={typeof returnTo === 'string' ? returnTo : undefined}
    />
  );
}
