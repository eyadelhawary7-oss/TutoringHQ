import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { notifyCheckoutSuccessOwnerOnce } from '@/lib/cardOrderCheckoutOwnerNotify';
import { CheckoutSuccessClient } from './CheckoutSuccessClient';

export default async function CheckoutSuccessPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const id = typeof orderId === 'string' ? orderId.trim() : '';
  if (!id) {
    const locale = await getLocale();
    redirect(`/${locale}/orders`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const locale = await getLocale();
    redirect(`/${locale}/login`);
  }

  if (supabaseAdmin) {
    await notifyCheckoutSuccessOwnerOnce(supabaseAdmin, id, user.id);
  }

  return <CheckoutSuccessClient orderId={id} />;
}
