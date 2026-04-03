import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyCardOrderPaymobHmac } from '@/lib/paymob';

const paymentFailedEnabled = false; // TODO: set to true when chq_payment_failed is Active

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const hmacFromQuery = request.nextUrl.searchParams.get('hmac') ?? '';

  let parsed: { obj?: Record<string, unknown>; hmac?: string };
  try {
    parsed = (await request.json()) as { obj?: Record<string, unknown>; hmac?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const hmac = hmacFromQuery || (typeof parsed.hmac === 'string' ? parsed.hmac : '');
  const obj = parsed.obj;

  if (!hmac || !obj || typeof obj !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  if (!verifyCardOrderPaymobHmac(obj, hmac)) {
    return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 });
  }

  const supabaseAdmin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // IDEMPOTENCY GUARD — Paymob order id is the idempotency key (not transaction_id)
  const orderForIdem = obj.order as { id?: unknown } | null | undefined;
  const orderId =
    orderForIdem?.id !== null && orderForIdem?.id !== undefined
      ? String(orderForIdem.id)
      : '';
  if (!orderId) {
    return NextResponse.json({ error: 'No order ID' }, { status: 400 });
  }

  const { data: existingSession } = await supabaseAdmin
    .from('combined_payment_sessions')
    .select('id, status')
    .eq('paymob_order_id', orderId)
    .maybeSingle();

  if (existingSession?.status === 'paid') {
    return NextResponse.json({ received: true });
  }

  const { data: existingInvoice } = await supabaseAdmin
    .from('invoices')
    .select('id, status')
    .eq('paymob_order_id', orderId)
    .maybeSingle();

  if (existingInvoice?.status === 'paid') {
    return NextResponse.json({ received: true });
  }

  try {
    const success = obj.success === true || obj.success === 'true';
    const transactionId = String(obj.id ?? '');

    /** Paymob HMAC object includes is_voided / is_refunded — used for chargebacks after capture. */
    const isChargebackLike =
      obj.is_voided === true ||
      obj.is_voided === 'true' ||
      obj.is_refunded === true ||
      obj.is_refunded === 'true';

    if (isChargebackLike) {
      const { finalizeInvoiceChargeback } = await import('@/lib/invoicePaymobPayment');
      await finalizeInvoiceChargeback(supabaseAdmin, orderId, transactionId);
    } else if (success) {
      const { finalizeCardOrderPaymentSuccess } = await import('@/lib/cardOrderPayment');
      const cardResult = await finalizeCardOrderPaymentSuccess(supabaseAdmin, orderId, transactionId);
      if (!cardResult) {
        const { finalizeInvoicePaymentSuccess } = await import('@/lib/invoicePaymobPayment');
        await finalizeInvoicePaymentSuccess(supabaseAdmin, orderId, transactionId);
      }
    } else {
      const { finalizeCardOrderPaymentFailure } = await import('@/lib/cardOrderPayment');
      await finalizeCardOrderPaymentFailure(supabaseAdmin, orderId);
      const { finalizeInvoicePaymentFailure, notifySubscriptionInvoicePaymentFailed } = await import(
        '@/lib/invoicePaymobPayment'
      );
      await finalizeInvoicePaymentFailure(supabaseAdmin, orderId);
      await notifySubscriptionInvoicePaymentFailed(supabaseAdmin, orderId, paymentFailedEnabled);
    }
  } catch (e) {
    console.error('[paymob/webhook]', e);
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
