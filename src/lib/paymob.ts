import '@/lib/paymobProductionGuard';
import crypto from 'crypto';
import { createPaymobCheckoutEgp } from '@/lib/paymobCenterCheckout';
import { timingSafeEqualHex } from '@/lib/verifyHmac';

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
  return timingSafeEqualHex(hash, receivedHmac);
}

export function buildPaymobIframeUrl(paymentToken: string): string {
  const iframeId = process.env.PAYMOB_IFRAME_ID;
  if (!iframeId) throw new Error('PAYMOB_IFRAME_ID not configured');
  return `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${paymentToken}`;
}

/**
 * Invoice retry / billing: Paymob iframe URL (EGP) for a fresh checkout session.
 */
export async function createPaymentLink(
  invoiceId: string,
  amountEgp: number,
  centerName: string,
  invoiceNumber: string,
  ownerPhoneDigits: string,
): Promise<{ paymentLink: string; paymobOrderId: string }> {
  const itemName = `Invoice ${invoiceNumber} - ${centerName}`.slice(0, 120);
  const { paymobOrderId, iframeUrl } = await createPaymobCheckoutEgp({
    amountEgp,
    merchantOrderId: `inv-${invoiceId}-${Date.now()}`,
    itemName,
    phoneDigits: ownerPhoneDigits.replace(/\D/g, '') || '0',
    displayName: centerName.slice(0, 50) || 'Center',
  });
  return { paymentLink: iframeUrl, paymobOrderId };
}

/** Card-order callback: exact field order per Paymob HMAC spec (nested order.id, not whole order). */
export function verifyCardOrderPaymobHmac(
  obj: Record<string, unknown>,
  receivedHmac: string
): boolean {
  const order = obj.order as Record<string, unknown> | null | undefined;
  const sourceData = obj.source_data as Record<string, unknown> | null | undefined;
  const toStr = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  const parts = [
    toStr(obj.amount_cents),
    toStr(obj.created_at),
    toStr(obj.currency),
    toStr(obj.error_occured),
    toStr(obj.has_parent_transaction),
    toStr(obj.id),
    toStr(obj.integration_id),
    toStr(obj.is_3d_secure),
    toStr(obj.is_auth),
    toStr(obj.is_capture),
    toStr(obj.is_refunded),
    toStr(obj.is_standalone_payment),
    toStr(obj.is_voided),
    toStr(order?.id),
    toStr(obj.owner),
    toStr(obj.pending),
    toStr(sourceData?.pan),
    toStr(sourceData?.sub_type),
    toStr(sourceData?.type),
    toStr(obj.success),
  ];
  const str = parts.join('');
  const secret = process.env.PAYMOB_HMAC_SECRET;
  if (!secret) return false;
  const hash = crypto.createHmac('sha512', secret).update(str).digest('hex');
  return timingSafeEqualHex(hash, receivedHmac);
}
