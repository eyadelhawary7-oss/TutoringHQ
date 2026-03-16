import crypto from 'crypto';

const PAYMOB_BASE = 'https://accept.paymob.com/api';

export async function getPaymobAuthToken(): Promise<string> {
  const res = await fetch(`${PAYMOB_BASE}/auth/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: process.env.PAYMOB_API_KEY }),
  });
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error('Paymob auth failed');
  return data.token;
}

export async function createPaymobOrder({
  authToken,
  amountCents,
  centerId,
  centerName,
}: {
  authToken: string;
  amountCents: number;
  centerId: string;
  centerName: string;
}): Promise<string> {
  const res = await fetch(`${PAYMOB_BASE}/ecommerce/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_token: authToken,
      delivery_needed: false,
      amount_cents: amountCents,
      currency: 'EGP',
      merchant_order_id: `${centerId}-${Date.now()}`,
      items: [
        {
          name: `CenterHQ Subscription - ${centerName}`,
          amount_cents: amountCents,
          description: 'Monthly subscription',
          quantity: 1,
        },
      ],
    }),
  });
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error('Paymob order creation failed');
  return String(data.id);
}

export async function createPaymentKey({
  authToken,
  orderId,
  amountCents,
  phone,
  name,
}: {
  authToken: string;
  orderId: string;
  amountCents: number;
  phone: string;
  name: string;
}): Promise<string> {
  const integrationId = process.env.PAYMOB_INTEGRATION_ID;
  if (!integrationId) throw new Error('PAYMOB_INTEGRATION_ID not configured');

  const res = await fetch(`${PAYMOB_BASE}/acceptance/payment_keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_token: authToken,
      amount_cents: amountCents,
      expiration: 3600,
      order_id: orderId,
      billing_data: {
        apartment: 'NA',
        email: 'billing@centerhq.com',
        floor: 'NA',
        first_name: name.split(' ')[0] || name,
        street: 'NA',
        building: 'NA',
        phone_number: phone,
        shipping_method: 'NA',
        postal_code: 'NA',
        city: 'Cairo',
        country: 'EG',
        last_name: name.split(' ')[1] || 'NA',
        state: 'Cairo',
      },
      currency: 'EGP',
      integration_id: integrationId,
    }),
  });
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error('Paymob payment key creation failed');
  return data.token;
}

function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const value = path.split('.').reduce<unknown>((o, part) => (o as Record<string, unknown>)?.[part], obj);
  return value != null ? String(value) : '';
}

export function verifyPaymobHmac(
  params: Record<string, unknown>,
  receivedHmac: string
): boolean {
  const keys = [
    'amount_cents',
    'created_at',
    'currency',
    'error_occured',
    'has_parent_transaction',
    'id',
    'integration_id',
    'is_3d_secure',
    'is_auth',
    'is_capture',
    'is_refunded',
    'is_standalone_payment',
    'is_voided',
    'order',
    'owner',
    'pending',
    'source_data.pan',
    'source_data.sub_type',
    'source_data.type',
    'success',
  ];
  const str = keys.map((k) => getNestedValue(params, k)).join('');
  const secret = process.env.PAYMOB_HMAC_SECRET;
  if (!secret) return false;
  const hash = crypto.createHmac('sha512', secret).update(str).digest('hex');
  return hash === receivedHmac;
}

export function buildPaymobIframeUrl(paymentToken: string): string {
  const iframeId = process.env.PAYMOB_IFRAME_ID;
  if (!iframeId) throw new Error('PAYMOB_IFRAME_ID not configured');
  return `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${paymentToken}`;
}
