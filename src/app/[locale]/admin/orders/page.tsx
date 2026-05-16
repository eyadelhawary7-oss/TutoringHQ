import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import AdminOrdersClient from './AdminOrdersClient';

/**
 * Bounce unauthenticated users to /login. Beyond that, leave the data
 * load to AdminOrdersClient — server-to-self bearer fetches against
 * /api/admin/card-orders were intermittently returning 401/403, which
 * silently sent users to /admin (Overview) instead of the orders page.
 */
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

  return (
    <Suspense fallback={<div className="p-6 text-[var(--color-text-secondary)]">Loading…</div>}>
      <AdminOrdersClient initialOrders={[]} />
    </Suspense>
  );
}
