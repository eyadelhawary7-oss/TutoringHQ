import type { SupabaseClient } from '@supabase/supabase-js';
import { createBostaDelivery } from '@/lib/bosta';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function autoBookBosta(
  orderId: string,
  supabase?: SupabaseClient,
): Promise<{ success: boolean; trackingNumber?: string; bostaOrderId?: string; error?: string }> {
  try {
    const db = supabase ?? getSupabaseAdmin();

    const { data: order } = await db
      .from('card_orders')
      .select(
        `
        id,
        quantity,
        notes,
        delivery_address,
        bosta_order_id,
        centers ( phone, governorate )
      `,
      )
      .eq('id', orderId)
      .maybeSingle();

    if (!order) {
      return { success: false, error: 'order_not_found' };
    }

    const o = order as { bosta_order_id?: string | null };
    if (o.bosta_order_id) {
      return { success: true };
    }

    const { data: vendor } = await db
      .from('vendors')
      .select('whatsapp_number, pickup_address, city')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!vendor) {
      return { success: false, error: 'no_active_vendor' };
    }

    const center = order.centers as { phone?: string | null; governorate?: string | null } | null;
    const prefix = (process.env.BOSTA_BUSINESS_PREFIX ?? 'CHQ').replace(/[^A-Za-z0-9]/g, '') || 'CHQ';
    const ref = `${prefix}-${String(order.id).substring(0, 8).toUpperCase()}`;

    const v = vendor as {
      whatsapp_number: string;
      pickup_address: string;
      city: string | null;
    };

    const result = await createBostaDelivery({
      centerPhone: center?.phone ?? '',
      centerAddress: String(order.delivery_address ?? ''),
      centerCity: center?.governorate ?? 'Cairo',
      vendorPhone: v.whatsapp_number,
      vendorAddress: v.pickup_address,
      vendorCity: v.city ?? 'Cairo',
      quantity: Number(order.quantity ?? 0),
      reference: ref,
      notes: order.notes != null ? String(order.notes) : '',
    });

    if (!result.success) {
      console.error('[autoBookBosta] Bosta failed:', result.error);
      return { success: false, error: result.error };
    }

    const shippedAt = new Date().toISOString();
    const { error: upErr } = await db
      .from('card_orders')
      .update({
        bosta_order_id: result.bostaOrderId ?? 'booked',
        tracking_number: result.trackingNumber ?? null,
        status: 'shipped',
        shipped_at: shippedAt,
      })
      .eq('id', orderId);

    if (upErr) {
      console.error('[autoBookBosta] Update failed:', upErr);
      return { success: false, error: upErr.message };
    }

    console.info('[autoBookBosta] Booked for order:', orderId, 'tracking:', result.trackingNumber);

    return {
      success: true,
      trackingNumber: result.trackingNumber,
      bostaOrderId: result.bostaOrderId,
    };
  } catch (err) {
    console.error('[autoBookBosta] Error:', err);
    return { success: false, error: String(err) };
  }
}
