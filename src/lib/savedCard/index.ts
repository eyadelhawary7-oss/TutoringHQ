/**
 * Saved-Card Engine (Phase 1) — public surface.
 *
 * Built + tested capability: store a card token once (with consent + a validity
 * check) and charge it later, idempotently, with no customer present. NOT wired
 * to any cron yet — Phase 2 calls chargeSavedCard() from the midnight billing run.
 */

export * from './types';
export { chargeSavedCard } from './autoCharge';
export type {
  ChargeSavedCardInput,
  ChargeSavedCardDeps,
  ChargeSavedCardResult,
} from './autoCharge';
export { saveCardFromFirstPayment, parsePaymobTokenCallback } from './saveCard';
export type { SaveCardInput, SaveCardDeps, SaveCardResult } from './saveCard';
export {
  recordConsent,
  consentIsSufficient,
  getConsentText,
  optInToCardTokenization,
  CONSENT_TEXT,
  CONSENT_VERSION,
} from './consent';
export type { RecordConsentInput, OptInTokenizationInput } from './consent';
export { buildIdempotencyKey, buildRequestFingerprint } from './idempotency';
export { createSupabaseSavedCardStore } from './store';
export { paymobRecurringClient } from './paymobRecurring';
