import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import {
  getPaymobApiKey,
  getPaymobIntegrationId,
  getPaymobIframeId,
} from '@/lib/paymobConfig';

const PAYMOB_BASE = 'https://accept.paymob.com/api';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: invoiceId } = await context.params;
    if (!invoiceId?.trim()) {
      return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 });
    }

    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;
    if (auth.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const apiKey = getPaymobApiKey();
    const integrationId = getPaymobIntegrationId();
    const iframeId = getPaymobIframeId();
    if (!apiKey || !integrationId || !iframeId) {
      return NextResponse.json({ error: 'Paymob is not configured' }, { status: 500 });
    }

    const { data: invoice, error: invErr } = await auth.supabaseAdmin
      .from('invoices')
      .select('id, center_id, status, invoice_type, total_amount, paymob_order_id, paymob_iframe_url')
      .eq('id', invoiceId.trim())
      .maybeSingle();

    if (invErr || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const row = invoice as {
      id: string;
      center_id: string;
      status: string;
      invoice_type: string | null;
      total_amount: number | string | null;
      paymob_order_id: string | null;
      paymob_iframe_url: string | null;
    };

    if (row.center_id !== auth.centerId) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const payableTypes = [
      'subscription',
      'plan_upgrade_difference',
      'pack_billing',
      'announcement_settlement',
      'late_payment_fee',
      'late_fee',
      'reactivation_fee',
    ];
    if (!row.invoice_type || !payableTypes.includes(row.invoice_type)) {
      return NextResponse.json({ error: 'This invoice cannot be paid online' }, { status: 400 });
    }

    if (row.status !== 'pending' && row.status !== 'overdue') {
      return NextResponse.json({ error: 'Invoice is not payable' }, { status: 400 });
    }

    if (row.paymob_order_id && row.paymob_iframe_url) {
      return NextResponse.json({
        iframeUrl: row.paymob_iframe_url,
        orderId: row.paymob_order_id,
      });
    }

    const total = Number(row.total_amount);
    if (!Number.isFinite(total) || total <= 0) {
      return NextResponse.json({ error: 'Invalid invoice amount' }, { status: 400 });
    }

    const { data: center } = await auth.supabaseAdmin
      .from('centers')
      .select('name, phone')
      .eq('id', row.center_id)
      .maybeSingle();

    const centerName = String((center as { name?: string | null } | null)?.name ?? 'Center').trim() || 'Center';
    const rawPhone = String((center as { phone?: string | null } | null)?.phone ?? '').replace(/\D/g, '');
    const centerPhone = rawPhone || '0';

    const amountCents = Math.round(total * 100);

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
        merchant_order_id: row.id,
        items: [
          {
            name: 'TutoringHQ Subscription',
            amount_cents: amountCents,
            quantity: 1,
            description: 'TutoringHQ Subscription',
          },
        ],
      }),
    });
    const orderJson = (await orderRes.json()) as { id?: number; message?: string };
    if (!orderRes.ok || orderJson.id == null) {
      return NextResponse.json(
        { error: orderJson.message ?? 'Paymob order creation failed' },
        { status: 500 },
      );
    }
    const paymobOrderId = String(orderJson.id);

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
        order_id: orderJson.id,
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
        { status: 500 },
      );
    }

    const iframeUrl = `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${encodeURIComponent(keyJson.token)}`;

    const { error: updateErr } = await auth.supabaseAdmin
      .from('invoices')
      .update({
        paymob_order_id: paymobOrderId,
        paymob_iframe_url: iframeUrl,
      })
      .eq('id', row.id)
      .eq('center_id', auth.centerId)
      .in('status', ['pending', 'overdue']);

    if (updateErr) {
      console.error('[invoices/pay] Failed to save Paymob fields:', updateErr);
      return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 });
    }

    return NextResponse.json({
      iframeUrl,
      orderId: paymobOrderId,
    });
  } catch (e) {
    console.error('[invoices/pay]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    );
  }
}
