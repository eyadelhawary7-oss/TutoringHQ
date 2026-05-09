import { notFound, redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { loadCardOrderDetailForCenter } from '@/lib/loadCardOrderDetail';
import OrderDetailClient from './OrderDetailClient';

export default async function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const id = typeof orderId === 'string' ? orderId.trim() : '';
  if (!id) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const locale = await getLocale();
    redirect(`/${locale}/login`);
  }

  const admin = getSupabaseAdmin();
  const { data: ur } = await admin.from('users').select('center_id, role').eq('id', user.id).maybeSingle();
  const centerId = (ur as { center_id?: string | null } | null)?.center_id;
  if (!centerId) notFound();

  const loaded = await loadCardOrderDetailForCenter(admin, centerId, id);
  if (!loaded.ok) notFound();

  return (
    <OrderDetailClient
      initialOrder={loaded.payload}
      viewerRole={String((ur as { role?: string }).role ?? '')}
    />
  );
}
