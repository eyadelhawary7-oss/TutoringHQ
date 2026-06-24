/**
 * Saved-Card Engine — save the card once (Phase 1, requirements 1a + 1d).
 *
 * On a customer's first/initial payment (customer present, normal 3DS/OTP), the
 * Paymob card token is captured and stored for future merchant-initiated
 * charges. We store ONLY the token + display metadata (last 4, brand, expiry) +
 * the stored-credential reference — NEVER the PAN.
 *
 * Two gates before a card becomes active:
 *  - Consent (1c): a sufficient consent (store + auto-charge) must already be
 *    recorded for this owner. Without it, nothing is stored.
 *  - Validity (1d): a small authorization is placed and immediately voided to
 *    prove the card is live. A dead card is rejected at save time.
 */

import { getPaymobRecurringIntegrationId } from '@/lib/paymobConfig';
import { consentIsSufficient } from './consent';
import type {
  OwnerRef,
  CardTokenData,
  PaymobRecurringClient,
  SavedCardStore,
  SavedCardRecord,
} from './types';

/** Default validity-probe amount: 1 EGP (authorized then voided). */
const VALIDITY_PROBE_CENTS = 100;

export interface SaveCardInput {
  owner: OwnerRef;
  card: CardTokenData;
  /** Optional explicit consent id; otherwise the latest consent is used. */
  consentId?: string | null;
}

export interface SaveCardDeps {
  store: SavedCardStore;
  paymob: PaymobRecurringClient;
  getRecurringIntegrationId?: () => string | undefined;
  /** Validity-probe amount in cents (defaults to 1 EGP). */
  validityProbeCents?: number;
}

export type SaveCardResult =
  | { ok: true; card: SavedCardRecord }
  | { ok: false; reason: 'consent_required' }
  | { ok: false; reason: 'invalid_card_data' }
  | { ok: false; reason: 'recurring_integration_not_configured' }
  | { ok: false; reason: 'card_invalid'; errorMessage?: string | null };

function cardDataIsValid(c: CardTokenData): boolean {
  if (!c.token || typeof c.token !== 'string') return false;
  if (!/^[0-9]{4}$/.test(c.last4 ?? '')) return false;
  if (!Number.isInteger(c.expMonth) || c.expMonth < 1 || c.expMonth > 12) return false;
  if (!Number.isInteger(c.expYear) || c.expYear < 2000 || c.expYear > 2100) return false;
  return true;
}

export async function saveCardFromFirstPayment(
  input: SaveCardInput,
  deps: SaveCardDeps,
): Promise<SaveCardResult> {
  const { store, paymob } = deps;

  if (!cardDataIsValid(input.card)) {
    return { ok: false, reason: 'invalid_card_data' };
  }

  // --- Gate 1: consent must already be recorded (store + auto-charge). ---
  const consent = input.consentId
    ? await store.getConsentById(input.consentId)
    : await store.getLatestConsent(input.owner);
  if (
    !consent ||
    consent.ownerType !== input.owner.ownerType ||
    consent.ownerId !== input.owner.ownerId ||
    !consentIsSufficient(consent)
  ) {
    return { ok: false, reason: 'consent_required' };
  }

  // --- Gate 2: validity check (small auth, then void). ---
  const integrationId = (deps.getRecurringIntegrationId ?? getPaymobRecurringIntegrationId)();
  if (!integrationId) {
    return { ok: false, reason: 'recurring_integration_not_configured' };
  }

  const validity = await paymob.authorizeAndVoid({
    token: input.card.token,
    integrationId,
    owner: input.owner,
    amountCents: deps.validityProbeCents ?? VALIDITY_PROBE_CENTS,
  });

  if (!validity.live) {
    await store.insertEvent({
      eventType: 'validity_check_failed',
      owner: input.owner,
      details: {
        last4: input.card.last4,
        errorMessage: validity.errorMessage ?? null,
      },
    });
    return { ok: false, reason: 'card_invalid', errorMessage: validity.errorMessage ?? null };
  }

  const validityCheckedAt = new Date().toISOString();
  await store.insertEvent({
    eventType: 'validity_check_passed',
    owner: input.owner,
    details: { last4: input.card.last4, transactionId: validity.transactionId ?? null },
  });

  // Replace any currently-active card, then store the new one as active.
  await store.revokeActiveCards(input.owner);
  const saved = await store.insertCard({
    owner: input.owner,
    card: input.card,
    consentId: consent.id,
    validityCheckedAt,
  });

  await store.insertEvent({
    eventType: 'card_saved',
    owner: input.owner,
    savedCardId: saved.id,
    details: {
      last4: input.card.last4,
      brand: input.card.brand ?? null,
      expMonth: input.card.expMonth,
      expYear: input.card.expYear,
      consentId: consent.id,
    },
  });

  return { ok: true, card: saved };
}

/**
 * Parse a raw Paymob TOKEN callback object into normalized CardTokenData.
 * Returns null if no usable token is present. Paymob's TOKEN callback carries
 * `token`, `masked_pan`, `card_subtype`; expiry is taken from whichever expiry
 * field Paymob includes (it varies by integration/flow). NEVER reads/returns a
 * full PAN — only the last 4 digits of the masked pan.
 */
export function parsePaymobTokenCallback(
  obj: Record<string, unknown>,
): CardTokenData | null {
  const token = typeof obj.token === 'string' ? obj.token : '';
  if (!token) return null;

  const maskedPan = String(obj.masked_pan ?? obj.masked_card ?? '');
  const digits = maskedPan.replace(/\D/g, '');
  const last4 = digits.slice(-4);
  if (!/^[0-9]{4}$/.test(last4)) return null;

  const brand =
    (typeof obj.card_subtype === 'string' && obj.card_subtype) ||
    (typeof obj.sub_type === 'string' && obj.sub_type) ||
    null;

  const expMonth = Number(obj.exp_month ?? obj.expiry_month ?? obj.card_exp_month ?? 0);
  const expYearRaw = Number(obj.exp_year ?? obj.expiry_year ?? obj.card_exp_year ?? 0);
  // Normalize 2-digit years (e.g. 28 → 2028).
  const expYear = expYearRaw > 0 && expYearRaw < 100 ? 2000 + expYearRaw : expYearRaw;

  return {
    token,
    last4,
    brand,
    expMonth,
    expYear,
    initialTransactionRef:
      obj.id != null ? String(obj.id) : obj.order_id != null ? String(obj.order_id) : null,
    storedCredentialRef:
      obj.order_id != null ? String(obj.order_id) : obj.id != null ? String(obj.id) : null,
  };
}
