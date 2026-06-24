import { NextRequest, NextResponse } from 'next/server';
import { requireTeacherAuth } from '@/lib/centerAuth';
import {
  getPaymobApiKey,
  getPaymobIntegrationId,
  getPaymobIframeId,
} from '@/lib/paymobConfig';
import { remainingBalance } from '@/lib/invoiceBalance';

const PAYMOB_BASE = 'https://accept.paymob.com/api';

/**
 * Teacher on-demand invoice pay (parity with /api/invoices/[id]/pay). Charges
 * only the REMAINING balance — the flat processing fee already lives inside
 * total_amount, so a top-up after a partial never adds a second fee. Scoped to
 * the authenticated teacher's own invoice. Uses requireTeacherAuth (not the
 * private-access gate) so a locked/free-tier teacher can pay to restore access.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: invoiceId } = await context.params;
    if (!invoiceId?.trim()) {
      return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 });
    }

    const auth = await requireTeacherAuth(request);
    if (!auth.ok) return auth.response;

    const apiKey = getPaymobApiKey();
    const integrationId = getPaymobIntegrationId();
    const iframeId = getPaymobIframeId();
    if (!apiKey || !integrationId || !iframeId) {
      return NextResponse.json({ error: 'Paymob is not configured' }, { status: 500 });
    }

    const { data: invoice, error: invErr } = await auth.supabaseAdmin
      .from('invoices')
      .select(
        'id, owner_type, teacher_id, status, invoice_type, total_amount, amount_received, paymob_order_id, paymob_iframe_url',
      )
      .eq('id', invoiceId.trim())
      .maybeSingle();

    if (invErr || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const row = invoice as {
      id: string;
      owner_type: string | null;
      teacher_id: string | null;
      status: string;
      invoice_type: string | null;
      total_amount: number | string | null;
      amount_received: number | string | null;
      paymob_order_id: string | null;
      paymob_iframe_url: string | null;
    };

    if (row.owner_type !== 'teacher' || row.teacher_id !== auth.userId) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (row.invoice_type !== 'subscription') {
      return NextResponse.json({ error: 'This invoice cannot be paid online' }, { status: 400 });
    }

    if (row.status !== 'pending' && row.status !== 'overdue' && row.status !== 'failed') {
      return NextResponse.json({ error: 'Invoice is not payable' }, { status: 400 });
    }

    const total = Number(row.total_amount);
    const received = Number(row.amount_received ?? 0);
    if (!Number.isFinite(total) || total <= 0) {
      return NextResponse.json({ error: 'Invalid invoice amount' }, { status: 400 });
    }
    const remaining = remainingBalance(total, received);
    if (remaining <= 0) {
      return NextResponse.json({ error: 'Invoice is already paid' }, { status: 400 });
    }

    // Reuse the cached iframe only when nothing has been received yet (the cached
    // order is for the full total). After a partial, mint a fresh order for the
    // remaining amount.
    if (received <= 0 && row.paymob_order_id && row.paymob_iframe_url) {
      return NextResponse.json({
        iframeUrl: row.paymob_iframe_url,
        orderId: row.paymob_order_id,
      });
    }

    const { data: userRow } = await auth.supabaseAdmin
      .from('users')
      .select('name, phone')
      .eq('id', auth.userId)
      .maybeSingle();
    const teacherName = String((userRow as { name?: string | null } | null)?.name ?? 'Teacher').trim() || 'Teacher';
    const rawPhone = String((userRow as { phone?: string | null } | null)?.phone ?? '').replace(/\D/g, '');
    const teacherPhone = rawPhone || '0';

    const amountCents = Math.round(remaining * 100);

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
        merchant_order_id: `${row.id}-${Date.now()}`,
        items: [
          {
            name: 'TutoringHQ Teacher Subscription',
            amount_cents: amountCents,
            quantity: 1,
            description: 'TutoringHQ Teacher Subscription',
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
          first_name: teacherName,
          last_name: '.',
          phone_number: teacherPhone,
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
      .eq('teacher_id', auth.userId)
      .in('status', ['pending', 'overdue', 'failed']);

    if (updateErr) {
      console.error('[teacher/invoices/pay] Failed to save Paymob fields:', updateErr);
      return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 });
    }

    return NextResponse.json({
      iframeUrl,
      orderId: paymobOrderId,
    });
  } catch (e) {
    console.error('[teacher/invoices/pay]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    );
  }
}
