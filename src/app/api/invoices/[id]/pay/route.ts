import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import {
  getPaymobApiKey,
  getPaymobIntegrationId,
  getPaymobIframeId,
} from '@/lib/paymobConfig';
import { remainingBalance } from '@/lib/invoiceBalance';
import { createSupabaseSavedCardStore } from '@/lib/savedCard/store';
import { optInToCardTokenization } from '@/lib/savedCard/consent';

const PAYMOB_BASE = 'https://accept.paymob.com/api';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: invoiceId } = await context.params;
    if (!invoiceId?.trim()) {
      return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 });
    }

    // allowSuspended: this is the pay route the lock screen sends a locked centre to.
    // Without the exemption the new single-day-lock gate (PR B) returns 403 CENTER_LOCKED
    // here, so a locked owner could neither load nor pay their invoice -- the one door
    // out of the lock would be locked. Paying is exactly what clears the lock.
    const auth = await requireCenterAuth(request, { allowSuspended: true });
    if (!auth.ok) return auth.response;
    if (auth.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Opt-in card saving (Phase 2f): the pay surface may send { saveCard, locale }
    // when the owner ticks "save my card for automatic renewal". Card-less stays
    // the default — a missing/invalid body reads as saveCard=false (no token).
    let saveCard = false;
    let bodyLocale: 'ar' | 'en' = 'ar';
    try {
      const parsed = (await request.json()) as { saveCard?: unknown; locale?: unknown };
      saveCard = parsed?.saveCard === true;
      if (parsed?.locale === 'en' || parsed?.locale === 'ar') bodyLocale = parsed.locale;
    } catch {
      // No/invalid JSON body → behave exactly as before (no card saving).
    }

    const apiKey = getPaymobApiKey();
    const integrationId = getPaymobIntegrationId();
    const iframeId = getPaymobIframeId();
    if (!apiKey || !integrationId || !iframeId) {
      return NextResponse.json({ error: 'Paymob is not configured' }, { status: 500 });
    }

    const { data: invoice, error: invErr } = await auth.supabaseAdmin
      .from('invoices')
      .select(
        'id, center_id, status, invoice_type, total_amount, amount_received, paymob_order_id, paymob_iframe_url',
      )
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
      amount_received: number | string | null;
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

    // A failed/retried attempt leaves the invoice payable too — the customer can
    // re-pay (and, after a partial, top up) the same invoice on demand.
    if (row.status !== 'pending' && row.status !== 'overdue' && row.status !== 'failed') {
      return NextResponse.json({ error: 'Invoice is not payable' }, { status: 400 });
    }

    // Underpayment (Phase 5): charge only the REMAINING balance. The flat
    // processing fee already lives inside total_amount, so a top-up of the
    // remainder never adds a second fee — one invoice, one fee.
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
    // order is for the full total). Once a partial credit exists, the cached order
    // is for the wrong amount — fall through and mint a fresh order for `remaining`.
    // When the owner opts to save their card, never reuse a cached (non-tokenizing)
    // key — mint a fresh key that requests the token.
    if (received <= 0 && !saveCard && row.paymob_order_id && row.paymob_iframe_url) {
      return NextResponse.json({
        iframeUrl: row.paymob_iframe_url,
        orderId: row.paymob_order_id,
      });
    }

    const { data: center } = await auth.supabaseAdmin
      .from('centers')
      .select('name, phone')
      .eq('id', row.center_id)
      .maybeSingle();

    const centerName = String((center as { name?: string | null } | null)?.name ?? 'Center').trim() || 'Center';
    const rawPhone = String((center as { phone?: string | null } | null)?.phone ?? '').replace(/\D/g, '');
    const centerPhone = rawPhone || '0';

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
        // Unique per attempt — a top-up after a partial mints a second Paymob
        // order, and Paymob rejects a reused merchant_order_id. The invoice is
        // still located by paymob_order_id at finalize time, not this field.
        merchant_order_id: `${row.id}-${Date.now()}`,
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

    // Only ask Paymob to tokenize the card when the owner explicitly opted in AND
    // a sufficient consent (store + auto-charge) is on record. Card-less otherwise.
    const requestToken = await optInToCardTokenization(
      createSupabaseSavedCardStore(auth.supabaseAdmin),
      {
        owner: { ownerType: 'center', ownerId: auth.centerId },
        saveCard,
        locale: bodyLocale,
        userId: auth.userId,
        ipAddress:
          request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
          request.headers.get('x-real-ip') ??
          null,
        userAgent: request.headers.get('user-agent'),
      },
    );

    const keyBody: Record<string, unknown> = {
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
    };
    if (requestToken) {
      // Save-card request: Paymob emits a separate TOKEN callback after a
      // successful auth, which the webhook routes into the (consent-gated,
      // INERT-without-recurring-id) save path.
      keyBody.request_token = true;
      keyBody.token_agreement = 'recurring';
    }

    const keyRes = await fetch(`${PAYMOB_BASE}/acceptance/payment_keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(keyBody),
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
      .in('status', ['pending', 'overdue', 'failed']);

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
