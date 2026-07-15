import type { SupabaseClient } from '@supabase/supabase-js';
import { getShippingFee, getShippingZone } from '@/lib/bostaShipping';
import { loadBostaShippingRates } from '@/lib/loadBostaShippingRates';
import { cardOrderProductInclusiveFromQty, explodeInclusive } from '@/lib/pricing/taxMath';
import { buildInvoiceTaxSnapshot } from '@/lib/processingFee';
import { notifyVendorOfNewOrder } from '@/lib/vendorNotify';
import { applyCardOrderTransition } from '@/lib/cardOrderState';

async function ensureCardOrderSetupFeeInvoice(
  supabaseAdmin: SupabaseClient,
  orderId: string,
  paymobOrderId: string,
  paymobTransactionId: string,
): Promise<void> {
  const payRef = `card_order:${orderId}`;
  const { data: existing } = await supabaseAdmin
    .from('invoices')
    .select('id')
    .eq('payment_reference', payRef)
    .maybeSingle();
  if (existing) return;

  const { data: ord } = await supabaseAdmin
    .from('card_orders')
    .select(
      'id, center_id, quantity, price_per_card, delivery_fee, shipping_zone, delivery_governorate, total_amount, tracking_number, paymob_order_id',
    )
    .eq('id', orderId)
    .maybeSingle();
  if (!ord) return;

  const r = ord as {
    center_id: string;
    quantity: number | null;
    price_per_card: number | null;
    delivery_fee: number | null;
    shipping_zone: string | null;
    delivery_governorate?: string | null;
    total_amount: number | null;
    tracking_number: string | null;
    paymob_order_id?: string | null;
  };
  const cid = r.center_id;
  const qty = Math.round(Number(r.quantity ?? 0));
  const productInclusive = cardOrderProductInclusiveFromQty(qty);
  const productTax = explodeInclusive(productInclusive);
  const pricePerCard =
    qty > 0 ? Math.round((productInclusive / qty) * 100) / 100 : Number(r.price_per_card ?? 0);
  let deliveryFee = Number(r.delivery_fee ?? 0);
  let shippingZone = r.shipping_zone != null && String(r.shipping_zone).trim() ? String(r.shipping_zone) : '';
  if (!Number.isFinite(deliveryFee) || deliveryFee <= 0 || !shippingZone) {
    const govFromOrder = r.delivery_governorate;
    const { data: center } = await supabaseAdmin.from('centers').select('governorate').eq('id', cid).maybeSingle();
    const gov =
      govFromOrder != null && String(govFromOrder).trim()
        ? String(govFromOrder)
        : (center as { governorate?: string | null } | null)?.governorate;
    const rates = await loadBostaShippingRates();
    deliveryFee = getShippingFee(gov, rates);
    shippingZone = getShippingZone(gov, rates);
  }
  const total = Number(r.total_amount ?? productInclusive + deliveryFee);
  // The flat processing fee charged at checkout = total − product − shipping.
  const processingFee = Math.max(0, Math.round((total - productInclusive - deliveryFee) * 100) / 100);

  const { data: codeRow } = await supabaseAdmin.from('centers').select('center_code').eq('id', cid).maybeSingle();
  const code = String((codeRow as { center_code?: string } | null)?.center_code ?? 'XXX');
  const ymd = new Date().toISOString().slice(0, 10);
  const invoiceNumber = `CARD-${code}-${ymd}-${String(orderId).replace(/-/g, '').slice(0, 8).toUpperCase()}`;

  const metadata = {
    card_order_id: orderId,
    product_name: 'QR Cards',
    product_name_ar: 'بطاقات QR',
    qty,
    unit_price: pricePerCard,
    scanner_unit_price: pricePerCard,
    shipping_company: 'Bosta',
    shipping_fee: deliveryFee,
    shipping_zone: shippingZone,
    tracking_number: r.tracking_number ?? null,
    processing_fee: processingFee,
  };

  const { error: invErr } = await supabaseAdmin.from('invoices').insert({
    center_id: cid,
    invoice_number: invoiceNumber,
    invoice_type: 'setup_fee',
    total_amount: total,
    base_amount: Math.round(productTax.base * 100) / 100,
    // Product, processing fee AND delivery are all VAT-bearing — VAT is the
    // inclusive slice of the full charged total, no carve-out.
    ...buildInvoiceTaxSnapshot({ total, fee: processingFee }),
    billing_period_start: ymd,
    billing_period_end: ymd,
    due_date: ymd,
    status: 'paid',
    paid_at: new Date().toISOString(),
    discount_amount: 0,
    payment_reference: payRef,
    paymob_order_id: String(r.paymob_order_id ?? paymobOrderId),
    paymob_transaction_id: paymobTransactionId,
    metadata,
  });
  if (invErr) {
    console.error('[finalizeCardOrderPaymentSuccess] setup_fee invoice:', invErr);
  }
}

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
  const wasPaid = String(row.payment_status ?? '').toLowerCase() === 'paid';

  try {
    await applyCardOrderTransition(supabaseAdmin, row.id, 'paymob_succeeded', {
      actorRole: 'system',
      extraColumns: { paymob_transaction_id: paymobTransactionId },
    });
  } catch (e) {
    console.error('[finalizeCardOrderPaymentSuccess]', e);
    return null;
  }

  await ensureCardOrderSetupFeeInvoice(supabaseAdmin, row.id, paymobOrderId, paymobTransactionId);

  if (!wasPaid) {
    void notifyVendorOfNewOrder(row.id);
  }
  return { orderId: row.id };
}

export async function finalizeCardOrderPaymentFailure(
  supabaseAdmin: SupabaseClient,
  paymobOrderId: string,
): Promise<void> {
  const { data: order } = await supabaseAdmin.from('card_orders').select('id').eq('paymob_order_id', paymobOrderId).maybeSingle();
  if (!order) return;
  try {
    await applyCardOrderTransition(supabaseAdmin, (order as { id: string }).id, 'paymob_failed', {
      actorRole: 'system',
    });
  } catch (e) {
    console.error('[finalizeCardOrderPaymentFailure]', e);
  }
}
