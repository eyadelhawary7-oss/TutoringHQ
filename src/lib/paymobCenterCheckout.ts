import '@/lib/paymobProductionGuard';
import { requirePaymobCore } from '@/lib/paymobConfig';

const PAYMOB_BASE = 'https://accept.paymob.com/api';

export type PaymobCheckoutResult = {
  paymobOrderId: string;
  iframeUrl: string;
};

/**
 * Create Paymob ecommerce order + payment key + iframe URL (EGP, whole pounds).
 */
export async function createPaymobCheckoutEgp(params: {
  amountEgp: number;
  merchantOrderId: string;
  itemName: string;
  phoneDigits: string;
  displayName: string;
}): Promise<PaymobCheckoutResult> {
  const { apiKey, integrationId, iframeId } = requirePaymobCore();

  const amountCents = Math.round(params.amountEgp * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error('Invalid amount');
  }

  const authRes = await fetch(`${PAYMOB_BASE}/auth/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey }),
  });
  const authData = (await authRes.json()) as { token?: string };
  if (!authRes.ok || !authData.token) {
    throw new Error('Paymob auth failed');
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
      merchant_order_id: params.merchantOrderId,
      items: [
        {
          name: params.itemName.slice(0, 120),
          amount_cents: amountCents,
          quantity: 1,
          description: 'TutoringHQ',
        },
      ],
    }),
  });
  const orderJson = (await orderRes.json()) as { id?: number; message?: string };
  if (!orderRes.ok || orderJson.id == null) {
    throw new Error(orderJson.message ?? 'Paymob order creation failed');
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
        first_name: params.displayName.slice(0, 50) || 'Center',
        last_name: '.',
        phone_number: params.phoneDigits || '0',
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
    throw new Error(keyJson.message ?? 'Paymob payment key failed');
  }

  const iframeUrl = `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${encodeURIComponent(keyJson.token)}`;

  return { paymobOrderId, iframeUrl };
}

/**
 * Fresh iframe URL for an existing unpaid Paymob order (same amount as original order).
 */
export async function createPaymobIframeForExistingOrder(params: {
  paymobOrderId: string;
  amountEgp: number;
  phoneDigits: string;
  displayName: string;
}): Promise<{ iframeUrl: string }> {
  const { apiKey, integrationId, iframeId } = requirePaymobCore();

  const amountCents = Math.round(params.amountEgp * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error('Invalid amount');
  }

  const orderId = Number(params.paymobOrderId);
  if (!Number.isFinite(orderId)) {
    throw new Error('Invalid Paymob order id');
  }

  const authRes = await fetch(`${PAYMOB_BASE}/auth/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey }),
  });
  const authData = (await authRes.json()) as { token?: string };
  if (!authRes.ok || !authData.token) {
    throw new Error('Paymob auth failed');
  }
  const token = authData.token;

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
      order_id: orderId,
      billing_data: {
        first_name: params.displayName.slice(0, 50) || 'Center',
        last_name: '.',
        phone_number: params.phoneDigits || '0',
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
    throw new Error(keyJson.message ?? 'Paymob payment key failed');
  }

  const iframeUrl = `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${encodeURIComponent(keyJson.token)}`;
  return { iframeUrl };
}
