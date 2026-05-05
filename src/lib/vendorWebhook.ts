import type { SupabaseClient } from '@supabase/supabase-js';
import { sendOperationalWhatsappText } from '@/lib/centerNotify';
import { autoBookBosta } from '@/lib/autoBookBosta';

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

/** Matches Meta inbound `from` to a vendor row (same rules as isVendorInboundPhone). */
function waDigitsMatch(fromWa: string, vendorWa: string | null | undefined): boolean {
  const fromDigits = digitsOnly(fromWa);
  const v = digitsOnly(String(vendorWa ?? ''));
  if (!fromDigits || !v) return false;
  if (v === fromDigits) return true;
  const tailMatch = (a: string, b: string) =>
    a.length >= 10 && b.length >= 10 && (a.endsWith(b.slice(-10)) || b.endsWith(a.slice(-10)));
  return tailMatch(v, fromDigits);
}

const ORDER_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

async function orderVendorPhoneMatches(
  supabase: SupabaseClient,
  order: { vendor_id: string | null },
  fromWaPhone: string,
): Promise<boolean> {
  if (order.vendor_id) {
    const { data: v } = await supabase
      .from('vendors')
      .select('whatsapp_number')
      .eq('id', order.vendor_id)
      .maybeSingle();
    const whatsapp = (v as { whatsapp_number?: string | null } | null)?.whatsapp_number ?? null;
    if (!waDigitsMatch(fromWaPhone, whatsapp)) {
      console.warn('[vendorWebhook] Inbound phone does not match order vendor');
      return false;
    }
    return true;
  }

  /* Order may not be linked yet while notifyVendorOfNewOrder is still running. */
  const { data: rows } = await supabase
    .from('vendors')
    .select('id, whatsapp_number')
    .eq('is_active', true);
  const matching = (rows ?? []).filter((r) =>
    waDigitsMatch(fromWaPhone, (r as { whatsapp_number?: string }).whatsapp_number),
  );
  if (matching.length !== 1) {
    console.warn('[vendorWebhook] Order has no vendor_id; cannot verify vendor phone uniquely');
    return false;
  }
  return true;
}

function paymentBlocksReady(paymentStatus: string | null | undefined): boolean {
  const ps = String(paymentStatus ?? '').toLowerCase();
  return ps === 'pending_payment' || ps === 'failed' || ps === 'unpaid';
}

export function isVendorTypedReadyKeyword(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t === 'جاهز' || t === 'تم') return true;
  return t.toLowerCase() === 'ready';
}

/**
 * Vendor typed "ready" without a READY_<orderId> payload: use the latest single
 * confirmed order for that vendor, or ask them to disambiguate.
 */
export async function handleVendorTypedReadyMessage(
  fromPhone: string,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    const { data: rows } = await supabase
      .from('vendors')
      .select('id, whatsapp_number')
      .eq('is_active', true);

    const vendorRow = (rows ?? []).find((r) =>
      waDigitsMatch(fromPhone, (r as { whatsapp_number?: string }).whatsapp_number),
    ) as { id: string } | undefined;

    if (!vendorRow) {
      console.warn('[vendorWebhook] typed ready: no vendor for phone');
      return;
    }

    const { data: orders } = await supabase
      .from('card_orders')
      .select('id')
      .eq('vendor_id', vendorRow.id)
      .eq('status', 'confirmed')
      .is('bosta_order_id', null)
      .not('payment_status', 'in', '(pending_payment,failed,unpaid)')
      .order('created_at', { ascending: false })
      .limit(2);

    const list = (orders ?? []) as { id: string }[];
    if (list.length === 0) {
      return;
    }
    if (list.length === 1) {
      await handleVendorReadySignal(`READY_${list[0].id}`, supabase, fromPhone);
      return;
    }

    await sendOperationalWhatsappText(
      fromPhone,
      'لديك أكثر من طلب بطاقات بحالة "مؤكد". يرجى الضغط على زر "جاهز للاستلام" في رسالة الطلب، أو إرسال رقم الطلب الكامل كما في الرسالة.\n' +
        'You have more than one confirmed card order. Please tap "Ready for pickup" on the order message, or send the full order id from that message.',
    );
  } catch (err) {
    console.error('[vendorWebhook] handleVendorTypedReadyMessage:', err);
  }
}

export async function handleVendorReadySignal(
  payload: string,
  supabase: SupabaseClient,
  fromWaPhone: string,
): Promise<void> {
  try {
    const trimmed = payload.trim();
    if (!trimmed.toUpperCase().startsWith('READY_')) {
      return;
    }
    const token = trimmed.replace(/^READY_/i, '').trim();
    if (!token) return;

    type OrderRow = {
      id: string;
      status: string;
      vendor_id: string | null;
      bosta_order_id?: string | null;
      payment_status?: string | null;
    };

    let order: OrderRow | undefined;

    if (ORDER_UUID_RE.test(token)) {
      const { data: row } = await supabase
        .from('card_orders')
        .select('id, status, vendor_id, bosta_order_id, payment_status')
        .eq('id', token)
        .maybeSingle();
      order = row as OrderRow | undefined;
      if (!order) {
        console.warn('[vendorWebhook] No order for READY UUID');
        return;
      }
      if (paymentBlocksReady(order.payment_status)) {
        console.warn('[vendorWebhook] Order payment not eligible:', order.id);
        return;
      }
      if (!(await orderVendorPhoneMatches(supabase, order, fromWaPhone))) return;
    } else {
      const ref = token.toUpperCase();
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

      order = (orders ?? []).find((row) => {
        const id = String((row as { id: string }).id).toLowerCase();
        return id.startsWith(refSuffix);
      }) as OrderRow | undefined;

      if (!order) {
        console.warn('[vendorWebhook] No matching order for ref:', ref);
        return;
      }
      if (!(await orderVendorPhoneMatches(supabase, order, fromWaPhone))) return;
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
