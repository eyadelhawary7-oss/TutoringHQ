/**
 * Paymob configuration — THE single source of truth.
 *
 * Every Paymob credential/id the platform uses is read ONLY here: the API key,
 * the standard card integration id, the iframe id, the webhook HMAC secret, and
 * the recurring/MOTO integration id used for merchant-initiated auto-charges.
 * No other file may read `process.env.PAYMOB_*` for these — they import an
 * accessor from this module. That way, when the real RECURRING integration id
 * arrives from Paymob, it is a ONE-LINE env change picked up everywhere
 * (save-card, auto-charge, the recurring client) automatically.
 *
 * SERVER-ONLY by use: every accessor here returns secrets and must only be
 * called from server code (all current callers are API routes / server libs).
 * The names are deliberately NOT prefixed `NEXT_PUBLIC_`, so Next strips them
 * from any client bundle — a Paymob secret can never reach the browser. (We do
 * not import the `server-only` package because this module is pulled into many
 * server modules that unit tests import, and that package throws under vitest.)
 *
 * Secret VALUES still live in env (correct + secure); this module is just the
 * one accessor layer over them. Accessors read `process.env` at call-time (not
 * memoized at import) so values set after boot — and stubbed env in tests — are
 * always honored.
 */

function readTrimmed(name: string): string | undefined {
  const v = process.env[name];
  if (v == null) return undefined;
  const t = String(v).trim();
  return t.length > 0 ? t : undefined;
}

/** Paymob API key (secret). */
export function getPaymobApiKey(): string | undefined {
  return readTrimmed('PAYMOB_API_KEY');
}

/** Standard card integration id (customer-present iframe flow). */
export function getPaymobIntegrationId(): string | undefined {
  return readTrimmed('PAYMOB_INTEGRATION_ID');
}

/** Iframe id for the hosted checkout. */
export function getPaymobIframeId(): string | undefined {
  return readTrimmed('PAYMOB_IFRAME_ID');
}

/** Webhook HMAC secret (used to verify inbound Paymob callbacks). */
export function getPaymobHmacSecret(): string | undefined {
  return readTrimmed('PAYMOB_HMAC_SECRET');
}

/**
 * Recurring / MOTO integration id for merchant-initiated charges (no customer
 * present). THE ONE definition point for this credential.
 *
 * Returns `undefined` until the credential exists — callers (the saved-card
 * engine) treat that as `recurring_integration_not_configured` and never charge.
 * This is a SEPARATE credential Eyad must request from Paymob; it is not yet
 * issued. Slot the real value into env `PAYMOB_RECURRING_INTEGRATION_ID` and the
 * whole platform picks it up here.
 */
export function getPaymobRecurringIntegrationId(): string | undefined {
  return readTrimmed('PAYMOB_RECURRING_INTEGRATION_ID');
}

/**
 * True only when using Paymob's modern Intention API, where the stored-credential
 * / previous-transaction reference is replayed explicitly on the MIT charge.
 * Classic MOTO replays via the saved token itself, so this stays false by default.
 */
export function paymobUseIntention(): boolean {
  return readTrimmed('PAYMOB_USE_INTENTION') === 'true';
}

export interface PaymobCoreConfig {
  apiKey: string;
  integrationId: string;
  iframeId: string;
}

/** True when the core checkout trio (api key + integration id + iframe id) is set. */
export function isPaymobConfigured(): boolean {
  return !!(getPaymobApiKey() && getPaymobIntegrationId() && getPaymobIframeId());
}

/**
 * Core config for the customer-present checkout flow, or throw a clear error.
 * Use at the start of any flow that needs all three.
 */
export function requirePaymobCore(): PaymobCoreConfig {
  const apiKey = getPaymobApiKey();
  const integrationId = getPaymobIntegrationId();
  const iframeId = getPaymobIframeId();
  if (!apiKey || !integrationId || !iframeId) {
    throw new Error('Paymob is not configured');
  }
  return { apiKey, integrationId, iframeId };
}
