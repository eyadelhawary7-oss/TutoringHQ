import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { finalizeCardOrderPaymentFailure, finalizeCardOrderPaymentSuccess } from '@/lib/cardOrderPayment';
import { inquirePaymobCardOrder } from '@/lib/paymobOrderInquiry';

/**
 * Public polling endpoint — no auth (Amazon-style client poll).
 * Query: paymobOrderId (Paymob ecommerce order id string).
 */
export async function GET(request: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const paymobOrderId = request.nextUrl.searchParams.get('paymobOrderId')?.trim() ?? '';
    if (!paymobOrderId) {
      return NextResponse.json({ error: 'paymobOrderId required' }, { status: 400 });
    }

    const supabaseAdmin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: order } = await supabaseAdmin
      .from('card_orders')
      .select(
        `
        id,
        quantity,
        students,
        total_amount,
        notes,
        delivery_address,
        payment_status,
        paymob_order_id,
        centers ( name, phone, governorate )
      `,
      )
      .eq('paymob_order_id', paymobOrderId)
      .maybeSingle();

    if (!order) {
      return NextResponse.json({ paid: false, failed: false });
    }

    const row = order as { id: string; payment_status?: string | null };

    if (row.payment_status === 'paid') {
      return NextResponse.json({ paid: true, orderId: row.id });
    }

    if (row.payment_status === 'failed') {
      return NextResponse.json({ paid: false, failed: true });
    }

    const inquiry = await inquirePaymobCardOrder(paymobOrderId);

    if (inquiry.state === 'failed') {
      await finalizeCardOrderPaymentFailure(supabaseAdmin, paymobOrderId);
      return NextResponse.json({ paid: false, failed: true });
    }

    if (inquiry.state === 'paid') {
      const txId = inquiry.transactionId ?? '';
      const finalized = await finalizeCardOrderPaymentSuccess(supabaseAdmin, paymobOrderId, txId);
      if (!finalized) {
        return NextResponse.json({ paid: false, failed: false });
      }
      return NextResponse.json({ paid: true, orderId: finalized.orderId });
    }

    return NextResponse.json({ paid: false, failed: false });
  } catch (e) {
    console.error('[payment-status]', e);
    return NextResponse.json(
      { paid: false, failed: false, error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    );
  }
}
