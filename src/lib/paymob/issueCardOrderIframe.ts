import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getPaymobApiKey,
  getPaymobIntegrationId,
  getPaymobIframeId,
} from '@/lib/paymobConfig';

const PAYMOB_BASE = 'https://accept.paymob.com/api';

export type IssueCardOrderIframeOk = {
  paymentKey: string;
  iframeId: string;
  paymobOrderId: string;
  iframeUrl: string;
};

export type IssueCardOrderIframeErr = { error: string; status: number };

/**
 * Creates Paymob ecommerce order + payment key, persists `paymob_order_id` on `card_orders`.
 * Billing phone must be digits-only (Egypt); falls back minimally if empty.
 */
export async function issueCardOrderIframePayment(opts: {
  supabaseAdmin: SupabaseClient;
  centerId: string;
  cardOrderId: string;
  amountEgp: number;
  centerName: string;
  billingPhoneDigits: string;
}): Promise<IssueCardOrderIframeOk | IssueCardOrderIframeErr> {
  const apiKey = getPaymobApiKey();
  const integrationId = getPaymobIntegrationId();
  const iframeId = getPaymobIframeId();
  if (!apiKey || !integrationId || !iframeId) {
    return { error: 'Paymob is not configured', status: 500 };
  }

  const amount = Number(opts.amountEgp);
  if (!Number.isFinite(amount) || amount < 0) {
    return { error: 'Invalid amount', status: 400 };
  }

  const centerName = String(opts.centerName ?? '').trim();
  let phone = String(opts.billingPhoneDigits ?? '').replace(/\D/g, '');
  if (!phone.startsWith('20')) phone = phone.replace(/^0/, '');
  if (!phone.startsWith('20')) phone = `20${phone}`;
  phone = phone.slice(0, 12);
  if (phone.length < 10) phone = '2001000000000';

  const amountCents = Math.round(amount * 100);

  const authRes = await fetch(`${PAYMOB_BASE}/auth/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey }),
  });
  const authData = (await authRes.json()) as { token?: string };
  if (!authRes.ok || !authData.token) {
    return { error: 'Paymob auth failed', status: 500 };
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
      merchant_order_id: opts.cardOrderId,
      items: [],
    }),
  });
  const orderJson = (await orderRes.json()) as { id?: number; message?: string };
  if (!orderRes.ok || orderJson.id == null) {
    return {
      error: orderJson.message ?? 'Paymob order creation failed',
      status: 500,
    };
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
        first_name: centerName || 'Center',
        last_name: '.',
        phone_number: phone,
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
    return {
      error: keyJson.message ?? 'Paymob payment key failed',
      status: 500,
    };
  }

  const { error: updateErr } = await opts.supabaseAdmin
    .from('card_orders')
    .update({ paymob_order_id: String(paymobOrderId) })
    .eq('id', opts.cardOrderId)
    .eq('center_id', opts.centerId);

  if (updateErr) {
    console.error('[issueCardOrderIframePayment] paymob_order_id update:', updateErr);
    return { error: 'Failed to update order', status: 500 };
  }

  const iframeUrl = `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${encodeURIComponent(keyJson.token)}`;

  return {
    paymentKey: keyJson.token,
    iframeId,
    paymobOrderId: String(paymobOrderId),
    iframeUrl,
  };
}
