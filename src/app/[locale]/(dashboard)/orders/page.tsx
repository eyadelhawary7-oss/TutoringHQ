import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getShippingFee, getShippingZone } from '@/lib/bostaShipping';
import OrdersPageClient, { type CardOrdersShippingQuote } from './OrdersPageClient';

export default async function OrdersPage() {
  let initialShippingQuote: CardOrdersShippingQuote | null = null;

  if (supabaseAdmin) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.id) {
      const { data: userRow } = await supabaseAdmin
        .from('users')
        .select('center_id')
        .eq('id', user.id)
        .maybeSingle();
      const cid = (userRow as { center_id?: string | null } | null)?.center_id;
      if (cid) {
        const { data: center } = await supabaseAdmin
          .from('centers')
          .select('governorate')
          .eq('id', cid)
          .maybeSingle();
        const govRaw = (center as { governorate?: string | null } | null)?.governorate;
        const gov = govRaw != null ? String(govRaw).trim() : '';
        initialShippingQuote = {
          hasGovernorate: gov.length > 0,
          fee: getShippingFee(gov || undefined),
          zoneEn: getShippingZone(gov || undefined),
        };
      }
    }
  }

  return <OrdersPageClient initialShippingQuote={initialShippingQuote} />;
}
