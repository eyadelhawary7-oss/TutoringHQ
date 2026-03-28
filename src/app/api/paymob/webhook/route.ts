import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyCardOrderPaymobHmac } from '@/lib/paymob';

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

  try {
    const success = obj.success === true || obj.success === 'true';
    const order = obj.order as { id?: unknown } | null | undefined;
    const paymobOrderId =
      order?.id !== null && order?.id !== undefined ? String(order.id) : '';

    if (paymobOrderId) {
      if (success) {
        const { error } = await supabaseAdmin
          .from('card_orders')
          .update({
            payment_status: 'paid',
            paymob_transaction_id: String(obj.id ?? ''),
          })
          .eq('paymob_order_id', paymobOrderId);
        if (error) console.error('[paymob/webhook] paid update:', error);
      } else {
        const { error } = await supabaseAdmin
          .from('card_orders')
          .update({ payment_status: 'failed' })
          .eq('paymob_order_id', paymobOrderId);
        if (error) console.error('[paymob/webhook] failed update:', error);
      }
    }
  } catch (e) {
    console.error('[paymob/webhook]', e);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
