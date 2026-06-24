/**
 * Saved-Card Engine — shared types (Phase 1).
 *
 * The engine is split into pure logic (saveCard.ts, autoCharge.ts) that takes
 * injected dependencies (a SavedCardStore + a PaymobRecurringClient) and thin
 * real implementations (store.ts, paymobRecurring.ts). This keeps the
 * money-handling logic fully unit-testable with fakes — no network, no DB.
 */

export type OwnerType = 'center' | 'teacher';

export interface OwnerRef {
  ownerType: OwnerType;
  ownerId: string;
}

/** Normalized card data captured at first payment. NEVER contains the PAN. */
export interface CardTokenData {
  /** Paymob card token (opaque). Used to charge later. NOT the card number. */
  token: string;
  /** Display only, exactly 4 digits, e.g. "4242". */
  last4: string;
  /** Card network, e.g. 'visa' / 'mastercard' (from Paymob card_subtype). */
  brand?: string | null;
  expMonth: number;
  expYear: number;
  /** Original customer-initiated (CIT) Paymob transaction id that tokenized the card. */
  initialTransactionRef?: string | null;
  /** Stored-credential / network transaction reference to replay on MIT charges. */
  storedCredentialRef?: string | null;
}

export interface ConsentRecord {
  id: string;
  ownerType: OwnerType;
  ownerId: string;
  consentVersion: string;
  consentText: string;
  locale: 'ar' | 'en';
  agreedToStore: boolean;
  agreedToAutoCharge: boolean;
  userId?: string | null;
  createdAt?: string;
}

export interface SavedCardRecord {
  id: string;
  ownerType: OwnerType;
  ownerId: string;
  paymobToken: string;
  last4: string;
  brand?: string | null;
  expMonth: number;
  expYear: number;
  storedCredentialRef?: string | null;
  initialTransactionRef?: string | null;
  status: 'active' | 'expired' | 'revoked' | 'invalid';
  consentId?: string | null;
  validityCheckedAt?: string | null;
}

export type ChargeIntentStatus =
  | 'created'
  | 'submitted'
  | 'succeeded'
  | 'failed'
  | 'voided'
  | 'error';

export interface ChargeIntentRecord {
  id: string;
  idempotencyKey: string;
  savedCardId: string;
  ownerType: OwnerType;
  ownerId: string;
  invoiceId?: string | null;
  billingPeriod?: string | null;
  amount: number;
  currency: string;
  requestFingerprint: string;
  status: ChargeIntentStatus;
  is3dSecure: boolean;
  attemptCount: number;
  paymobOrderId?: string | null;
  paymobTransactionId?: string | null;
  lastError?: string | null;
}

export type SavedCardEventType =
  | 'consent_recorded'
  | 'card_saved'
  | 'validity_check_passed'
  | 'validity_check_failed'
  | 'charge_intent_created'
  | 'charge_succeeded'
  | 'charge_failed'
  | 'card_revoked'
  | 'card_expired';

/** Outcome of a Paymob merchant-initiated token charge. */
export interface PaymobChargeOutcome {
  /** True only when Paymob reports a captured, successful transaction. */
  success: boolean;
  /** True when the transaction is pending (ambiguous — must be reconciled). */
  pending: boolean;
  transactionId: string | null;
  orderId: string | null;
  errorMessage?: string | null;
}

/** Result of a save-time validity check (small auth that is then voided). */
export interface CardValidityResult {
  live: boolean;
  transactionId?: string | null;
  errorMessage?: string | null;
}

/**
 * The Paymob HTTP boundary. Real implementation in paymobRecurring.ts; tests
 * inject a fake so the engine logic is verified without any network call.
 */
export interface PaymobRecurringClient {
  /**
   * Charge a saved card token with NO customer present (MIT / is_3d_secure:false).
   * Uses the recurring integration id and replays the stored-credential ref.
   */
  chargeWithToken(params: {
    token: string;
    amountCents: number;
    integrationId: string;
    owner: OwnerRef;
    /** Idempotency key — also used as the Paymob merchant_order_id seed. */
    idempotencyKey: string;
    storedCredentialRef?: string | null;
    billingPeriod?: string | null;
  }): Promise<PaymobChargeOutcome>;

  /**
   * Validity check: a small authorization that is immediately voided, so a dead
   * card is caught at save time rather than at the first real billing.
   */
  authorizeAndVoid(params: {
    token: string;
    integrationId: string;
    owner: OwnerRef;
    /** Probe amount in cents (e.g. 100 = 1 EGP). */
    amountCents: number;
  }): Promise<CardValidityResult>;
}

/**
 * The persistence boundary. Real implementation in store.ts (supabase-admin);
 * tests inject an in-memory fake.
 */
export interface SavedCardStore {
  getActiveCard(owner: OwnerRef): Promise<SavedCardRecord | null>;
  insertConsent(params: {
    owner: OwnerRef;
    consentVersion: string;
    consentText: string;
    locale: 'ar' | 'en';
    agreedToStore: boolean;
    agreedToAutoCharge: boolean;
    userId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<ConsentRecord>;
  getConsentById(id: string): Promise<ConsentRecord | null>;
  getLatestConsent(owner: OwnerRef): Promise<ConsentRecord | null>;
  /** Mark any currently-active card for this owner as revoked (replacing it). */
  revokeActiveCards(owner: OwnerRef): Promise<void>;
  insertCard(params: {
    owner: OwnerRef;
    card: CardTokenData;
    consentId: string;
    validityCheckedAt: string;
  }): Promise<SavedCardRecord>;
  updateCardStatus(
    id: string,
    status: SavedCardRecord['status'],
    extra?: { revokedAt?: string },
  ): Promise<void>;
  getIntentByKey(idempotencyKey: string): Promise<ChargeIntentRecord | null>;
  insertIntent(params: {
    idempotencyKey: string;
    savedCardId: string;
    owner: OwnerRef;
    invoiceId?: string | null;
    billingPeriod?: string | null;
    amount: number;
    currency: string;
    requestFingerprint: string;
  }): Promise<ChargeIntentRecord>;
  updateIntent(
    id: string,
    fields: Partial<{
      status: ChargeIntentStatus;
      attemptCount: number;
      paymobOrderId: string | null;
      paymobTransactionId: string | null;
      lastError: string | null;
      completedAt: string | null;
    }>,
  ): Promise<ChargeIntentRecord>;
  insertEvent(params: {
    eventType: SavedCardEventType;
    owner?: OwnerRef;
    savedCardId?: string | null;
    chargeIntentId?: string | null;
    details?: Record<string, unknown>;
  }): Promise<void>;
}
