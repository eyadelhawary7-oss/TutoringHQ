import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyVendorOfNewOrder } from '@/lib/vendorNotify';

export async function finalizeCardOrderPaymentSuccess(
  supabaseAdmin: SupabaseClient,
  paymobOrderId: string,
  paymobTransactionId: string,
): Promise<{ orderId: string } | null> {
  const { data: order } = await supabaseAdmin
    .from('card_orders')
    .select('id, payment_status')
    .eq('paymob_order_id', paymobOrderId)
    .maybeSingle();

  if (!order) return null;

  const row = order as { id: string; payment_status?: string | null };

  if (row.payment_status === 'paid') {
    return { orderId: row.id };
  }

  const { error } = await supabaseAdmin
    .from('card_orders')
    .update({
      payment_status: 'paid',
      status: 'pending',
      paymob_transaction_id: paymobTransactionId,
    })
    .eq('id', row.id);

  if (error) {
    console.error('[finalizeCardOrderPaymentSuccess]', error);
    return null;
  }

  void notifyVendorOfNewOrder(row.id);
  return { orderId: row.id };
}

export async function finalizeCardOrderPaymentFailure(
  supabaseAdmin: SupabaseClient,
  paymobOrderId: string,
): Promise<void> {
  await supabaseAdmin
    .from('card_orders')
    .update({ payment_status: 'failed' })
    .eq('paymob_order_id', paymobOrderId);
}
