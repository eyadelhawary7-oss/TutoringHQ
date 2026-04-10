import type { SupabaseClient } from '@supabase/supabase-js';
import { autoBookBosta } from '@/lib/autoBookBosta';

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

/** True if the WhatsApp sender matches an active vendor's registered number. */
export async function isVendorInboundPhone(
  supabase: SupabaseClient,
  waFrom: string,
): Promise<boolean> {
  const fromDigits = digitsOnly(waFrom);
  if (!fromDigits) return false;

  const { data: rows } = await supabase
    .from('vendors')
    .select('whatsapp_number')
    .eq('is_active', true);

  for (const r of rows ?? []) {
    const v = digitsOnly(String((r as { whatsapp_number?: string }).whatsapp_number ?? ''));
    if (!v) continue;
    if (v === fromDigits) return true;
    const tailMatch = (a: string, b: string) =>
      a.length >= 10 && b.length >= 10 && (a.endsWith(b.slice(-10)) || b.endsWith(a.slice(-10)));
    if (tailMatch(v, fromDigits)) return true;
  }
  return false;
}

export async function handleVendorReadySignal(
  payload: string,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    const trimmed = payload.trim();
    const ref = trimmed.replace(/^READY_/i, '').trim().toUpperCase();

    const prefix = (process.env.BOSTA_BUSINESS_PREFIX ?? 'CHQ').replace(/[^A-Za-z0-9]/g, '') || 'CHQ';
    const expectedPrefix = `${prefix}-`;
    if (!ref.startsWith(expectedPrefix)) {
      console.warn('[vendorWebhook] Invalid ref prefix:', ref);
      return;
    }

    const refSuffix = ref.slice(expectedPrefix.length).toLowerCase();

    const { data: orders } = await supabase
      .from('card_orders')
      .select('id, status, vendor_id, bosta_order_id, payment_status')
      .is('bosta_order_id', null)
      .not('payment_status', 'in', '(pending_payment,failed,unpaid)');

    const order = (orders ?? []).find((row) => {
      const id = String((row as { id: string }).id).toLowerCase();
      return id.startsWith(refSuffix);
    }) as { id: string; status: string; bosta_order_id?: string | null } | undefined;

    if (!order) {
      console.warn('[vendorWebhook] No matching order for ref:', ref);
      return;
    }

    if (order.bosta_order_id) {
      console.warn('[vendorWebhook] Bosta already booked:', order.id);
      return;
    }

    if (order.status === 'ready_for_pickup') {
      console.warn('[vendorWebhook] Already marked ready:', order.id);
      return;
    }

    const { error: upErr } = await supabase
      .from('card_orders')
      .update({ status: 'ready_for_pickup' })
      .eq('id', order.id)
      .is('bosta_order_id', null);

    if (upErr) {
      console.error('[vendorWebhook] Status update failed:', upErr);
      return;
    }

    console.warn('[vendorWebhook] Marked ready_for_pickup:', order.id);

    await autoBookBosta(order.id, supabase);
  } catch (err) {
    console.error('[vendorWebhook] Error handling ready signal:', err);
  }
}
