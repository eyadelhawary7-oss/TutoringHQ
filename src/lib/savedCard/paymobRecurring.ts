/**
 * Saved-Card Engine — real Paymob recurring/MOTO HTTP client (Phase 1, 1b/1d).
 *
 * Implements PaymobRecurringClient against the classic Paymob Accept API (the
 * same base this codebase already uses for the iframe flow). Charging a saved
 * token is a 4-step classic flow:
 *   1. auth token            POST /auth/tokens
 *   2. create order          POST /ecommerce/orders
 *   3. payment key (RECURRING integration_id)
 *                            POST /acceptance/payment_keys
 *   4. pay with token        POST /acceptance/payments/pay
 *        body: { source: { identifier: <TOKEN>, subtype: 'TOKEN' }, payment_token }
 *
 * ── FOUNDER / PAYMOB ACTION ───────────────────────────────────────────────
 * The integration_id used here MUST be the dedicated RECURRING / MOTO
 * integration id (env PAYMOB_RECURRING_INTEGRATION_ID). That credential does
 * NOT exist yet — Eyad must request it from his Paymob account manager. Until
 * it is set, the engine returns 'recurring_integration_not_configured' and this
 * client is never reached for a live charge. Live auto-charging additionally
 * waits on Paymob LIVE credentials (company registration). This client is built
 * and unit-tested via an injected fake; it is NOT wired to any cron in Phase 1.
 * ──────────────────────────────────────────────────────────────────────────
 */

import '@/lib/paymobProductionGuard';
import type {
  PaymobRecurringClient,
  PaymobChargeOutcome,
  CardValidityResult,
  OwnerRef,
} from './types';

const PAYMOB_BASE = 'https://accept.paymob.com/api';

class PaymobInfraError extends Error {}

async function authToken(): Promise<string> {
  const apiKey = process.env.PAYMOB_API_KEY;
  if (!apiKey) throw new PaymobInfraError('PAYMOB_API_KEY not configured');
  const res = await fetch(`${PAYMOB_BASE}/auth/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey }),
  });
  const data = (await res.json().catch(() => ({}))) as { token?: string };
  if (!res.ok || !data.token) throw new PaymobInfraError('Paymob auth failed');
  return data.token;
}

async function createOrder(token: string, amountCents: number, merchantOrderId: string): Promise<string> {
  const res = await fetch(`${PAYMOB_BASE}/ecommerce/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      auth_token: token,
      amount_cents: amountCents,
      currency: 'EGP',
      delivery_needed: false,
      merchant_order_id: merchantOrderId,
      items: [],
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: number | string; message?: string };
  if (!res.ok || data.id == null) {
    throw new PaymobInfraError(data.message ?? 'Paymob order creation failed');
  }
  return String(data.id);
}

async function paymentKey(
  token: string,
  orderId: string,
  amountCents: number,
  integrationId: string,
  owner: OwnerRef,
): Promise<string> {
  const res = await fetch(`${PAYMOB_BASE}/acceptance/payment_keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      auth_token: token,
      amount_cents: amountCents,
      currency: 'EGP',
      order_id: Number(orderId),
      integration_id: Number(integrationId),
      lock_order_when_paid: false,
      billing_data: {
        first_name: owner.ownerType === 'teacher' ? 'Teacher' : 'Center',
        last_name: '.',
        phone_number: '0',
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
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { token?: string; message?: string };
  if (!res.ok || !data.token) throw new PaymobInfraError(data.message ?? 'Paymob payment key failed');
  return data.token;
}

type PayResponse = {
  id?: number | string;
  success?: boolean | string;
  pending?: boolean | string;
  is_voided?: boolean | string;
  order?: { id?: number | string } | null;
  data?: { message?: string } | null;
  message?: string;
};

function toBool(v: unknown): boolean {
  return v === true || v === 'true';
}

async function payWithToken(
  token: string,
  paymentToken: string,
  cardToken: string,
  storedCredentialRef: string | null | undefined,
): Promise<PayResponse> {
  const body: Record<string, unknown> = {
    source: { identifier: cardToken, subtype: 'TOKEN' },
    payment_token: paymentToken,
  };
  // Replay the stored-credential / network transaction reference on the MIT.
  // The classic MOTO integration replays the credential-on-file via the token
  // itself; the explicit field is only sent on the modern Intention path (set
  // PAYMOB_USE_INTENTION=true once that integration is confirmed with Paymob).
  if (storedCredentialRef && process.env.PAYMOB_USE_INTENTION === 'true') {
    body.previous_transaction_reference = storedCredentialRef;
  }
  const res = await fetch(`${PAYMOB_BASE}/acceptance/payments/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // A non-OK HTTP here is ambiguous (the charge may or may not have landed) →
  // treat as infra error so the engine marks it for reconciliation.
  if (!res.ok && res.status >= 500) {
    throw new PaymobInfraError(`Paymob pay HTTP ${res.status}`);
  }
  return (await res.json().catch(() => ({}))) as PayResponse;
}

async function voidTransaction(token: string, transactionId: string): Promise<void> {
  try {
    await fetch(`${PAYMOB_BASE}/acceptance/void_refund/void`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ auth_token: token, transaction_id: transactionId }),
    });
  } catch {
    // Best-effort: a failed void leaves a tiny probe charge to be auto-settled.
  }
}

export const paymobRecurringClient: PaymobRecurringClient = {
  async chargeWithToken(params): Promise<PaymobChargeOutcome> {
    const token = await authToken();
    const orderId = await createOrder(token, params.amountCents, params.idempotencyKey);
    const payKey = await paymentKey(token, orderId, params.amountCents, params.integrationId, params.owner);
    const resp = await payWithToken(token, payKey, params.token, params.storedCredentialRef);

    const success = toBool(resp.success);
    const pending = toBool(resp.pending);
    const transactionId = resp.id != null ? String(resp.id) : null;
    const respOrderId = resp.order?.id != null ? String(resp.order.id) : orderId;
    const errorMessage = success ? null : resp.data?.message ?? resp.message ?? 'declined';

    return { success, pending, transactionId, orderId: respOrderId, errorMessage };
  },

  async authorizeAndVoid(params): Promise<CardValidityResult> {
    const token = await authToken();
    const orderId = await createOrder(token, params.amountCents, `validity-${orderProbeSeed(params.owner)}`);
    const payKey = await paymentKey(token, orderId, params.amountCents, params.integrationId, params.owner);
    const resp = await payWithToken(token, payKey, params.token, null);

    const success = toBool(resp.success);
    const transactionId = resp.id != null ? String(resp.id) : null;
    if (success && transactionId) {
      await voidTransaction(token, transactionId);
      return { live: true, transactionId };
    }
    return { live: false, transactionId, errorMessage: resp.data?.message ?? resp.message ?? 'card declined' };
  },
};

/** Per-owner probe seed; avoids Math.random/Date in module scope concerns. */
function orderProbeSeed(owner: OwnerRef): string {
  return `${owner.ownerType}-${owner.ownerId}-${Date.now()}`;
}
