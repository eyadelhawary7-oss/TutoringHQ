import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const PAYMOB_BASE = 'https://accept.paymob.com/api';

async function getUserContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace('Bearer ', '');
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id')
    .eq('id', user.id)
    .single();

  if (!userRecord?.center_id) return null;

  return { user: userRecord, supabaseAdmin };
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const apiKey = process.env.PAYMOB_API_KEY;
    const integrationId = process.env.PAYMOB_INTEGRATION_ID;
    const iframeId = process.env.PAYMOB_IFRAME_ID;
    if (!apiKey || !integrationId || !iframeId) {
      return NextResponse.json(
        { error: 'Paymob is not configured' },
        { status: 500 }
      );
    }

    let body: {
      amount?: unknown;
      centerName?: unknown;
      centerPhone?: unknown;
      cardOrderId?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const amount = typeof body.amount === 'number' ? body.amount : NaN;
    const centerName =
      typeof body.centerName === 'string' ? body.centerName.trim() : '';
    const centerPhone =
      typeof body.centerPhone === 'string' ? body.centerPhone.trim() : '';
    const cardOrderId =
      typeof body.cardOrderId === 'string' ? body.cardOrderId.trim() : '';

    if (!Number.isFinite(amount) || amount < 0 || !centerName || !centerPhone || !cardOrderId) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    const { data: orderRow, error: orderErr } = await ctx.supabaseAdmin
      .from('card_orders')
      .select('id, center_id, total_amount, payment_status')
      .eq('id', cardOrderId)
      .maybeSingle();

    if (orderErr || !orderRow || orderRow.center_id !== ctx.user.center_id) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const paySt = String((orderRow as { payment_status?: string | null }).payment_status ?? '');
    if (paySt === 'paid') {
      return NextResponse.json({ error: 'Order already paid' }, { status: 400 });
    }
    if (paySt !== 'pending_payment' && paySt !== 'unpaid') {
      return NextResponse.json({ error: 'Order not payable' }, { status: 400 });
    }

    const dbTotal = Number(orderRow.total_amount);
    if (!Number.isFinite(dbTotal) || Math.abs(dbTotal - amount) > 0.01) {
      return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 });
    }

    const amountCents = Math.round(amount * 100);

    const authRes = await fetch(`${PAYMOB_BASE}/auth/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey }),
    });
    const authData = (await authRes.json()) as { token?: string };
    if (!authRes.ok || !authData.token) {
      return NextResponse.json({ error: 'Paymob auth failed' }, { status: 500 });
    }
    const token = authData.token;

    const orderRes = await fetch(`${PAYMOB_BASE}/ecommerce/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        auth_token: token,
        amount_cents: amountCents,
        currency: 'EGP',
        delivery_needed: false,
        merchant_order_id: cardOrderId,
        items: [],
      }),
    });
    const orderJson = (await orderRes.json()) as { id?: number; message?: string };
    if (!orderRes.ok || orderJson.id == null) {
      return NextResponse.json(
        { error: orderJson.message ?? 'Paymob order creation failed' },
        { status: 500 }
      );
    }
    const paymobOrderId = orderJson.id;

    const keyRes = await fetch(`${PAYMOB_BASE}/acceptance/payment_keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        auth_token: token,
        amount_cents: amountCents,
        currency: 'EGP',
        order_id: paymobOrderId,
        billing_data: {
          first_name: centerName,
          last_name: '.',
          phone_number: centerPhone,
          email: 'NA',
          street: 'NA',
          building: 'NA',
          floor: 'NA',
          apartment: 'NA',
          city: 'Cairo',
          country: 'EG',
          state: 'Cairo',
          postal_code: 'NA',
        },
        integration_id: Number(integrationId),
        lock_order_when_paid: false,
      }),
    });
    const keyJson = (await keyRes.json()) as { token?: string; message?: string };
    if (!keyRes.ok || !keyJson.token) {
      return NextResponse.json(
        { error: keyJson.message ?? 'Paymob payment key failed' },
        { status: 500 }
      );
    }

    const { error: updateErr } = await ctx.supabaseAdmin
      .from('card_orders')
      .update({ paymob_order_id: String(paymobOrderId) })
      .eq('id', cardOrderId)
      .eq('center_id', ctx.user.center_id);

    if (updateErr) {
      console.error('[create-payment-key] Failed to save paymob_order_id:', updateErr);
      return NextResponse.json(
        { error: 'Failed to update order' },
        { status: 500 }
      );
    }

    const iframeUrl = `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${encodeURIComponent(keyJson.token)}`;

    return NextResponse.json({
      paymentKey: keyJson.token,
      iframeId,
      paymobOrderId: String(paymobOrderId),
      iframeUrl,
    });
  } catch (e) {
    console.error('[create-payment-key]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 }
    );
  }
}
