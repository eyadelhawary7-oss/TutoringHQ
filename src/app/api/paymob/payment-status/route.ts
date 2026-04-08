import { NextRequest, NextResponse } from 'next/server';
import { finalizeCardOrderPaymentFailure, finalizeCardOrderPaymentSuccess } from '@/lib/cardOrderPayment';
import { inquirePaymobCardOrder } from '@/lib/paymobOrderInquiry';
import { requireCenterAuth } from '@/lib/centerAuth';

/**
 * Center-authenticated polling for card order Paymob status.
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

    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    const supabaseAdmin = auth.supabaseAdmin;

    const { data: order } = await supabaseAdmin
      .from('card_orders')
      .select(
        `
        id,
        center_id,
        quantity,
        students,
        total_amount,
        notes,
        delivery_address,
        payment_status,
        paymob_order_id
      `,
      )
      .eq('paymob_order_id', paymobOrderId)
      .maybeSingle();

    if (!order) {
      return NextResponse.json({ paid: false, failed: false });
    }

    const row = order as {
      id: string;
      center_id?: string | null;
      payment_status?: string | null;
    };

    if (row.center_id !== auth.centerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
