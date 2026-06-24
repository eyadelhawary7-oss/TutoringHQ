/**
 * Saved-Card Engine — consent capture (Phase 1, requirement 1c).
 *
 * A card may only be stored for recurring use after the customer explicitly
 * agrees to (a) store their card and (b) auto-charge it on future billing dates.
 * The exact text shown is snapshotted into saved_card_consents (PDPL + card
 * scheme rules). The canonical text lives here (server source of truth) and is
 * mirrored in messages/{ar,en}.json under `savedCard.consent.*` for rendering.
 */

import type { OwnerRef, SavedCardStore, ConsentRecord } from './types';

export const CONSENT_VERSION = 'v1';

/** Canonical consent text per locale. Arabic-first. Mirrors the i18n strings. */
export const CONSENT_TEXT: Record<'ar' | 'en', string> = {
  ar:
    'أوافق على حفظ بطاقتي بشكل آمن لدى مزوّد الدفع (باي موب) وعلى خصم قيمة ' +
    'الاشتراك تلقائيًا من هذه البطاقة في مواعيد التجديد. يمكنني إلغاء الحفظ ' +
    'في أي وقت من الإعدادات.',
  en:
    'I agree to securely store my card with the payment provider (Paymob) and ' +
    'to have my subscription automatically charged to this card on each renewal ' +
    'date. I can remove the saved card at any time from settings.',
};

/** The exact consent text for a locale at the current version (for snapshotting). */
export function getConsentText(locale: 'ar' | 'en'): string {
  return CONSENT_TEXT[locale] ?? CONSENT_TEXT.ar;
}

export interface RecordConsentInput {
  owner: OwnerRef;
  locale: 'ar' | 'en';
  agreedToStore: boolean;
  agreedToAutoCharge: boolean;
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** True only when the customer agreed to BOTH store and auto-charge. */
export function consentIsSufficient(
  c: Pick<ConsentRecord, 'agreedToStore' | 'agreedToAutoCharge'> | null | undefined,
): boolean {
  return !!c && c.agreedToStore === true && c.agreedToAutoCharge === true;
}

/**
 * Record an explicit consent. The stored text is always the server canonical
 * text for (locale, version) — never client-supplied — so the audit record can
 * be trusted. Refuses to record a "consent" that does not agree to both.
 */
export async function recordConsent(
  store: SavedCardStore,
  input: RecordConsentInput,
): Promise<ConsentRecord> {
  const consentText = getConsentText(input.locale);
  const consent = await store.insertConsent({
    owner: input.owner,
    consentVersion: CONSENT_VERSION,
    consentText,
    locale: input.locale,
    agreedToStore: input.agreedToStore,
    agreedToAutoCharge: input.agreedToAutoCharge,
    userId: input.userId ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });

  await store.insertEvent({
    eventType: 'consent_recorded',
    owner: input.owner,
    details: {
      consentId: consent.id,
      consentVersion: CONSENT_VERSION,
      locale: input.locale,
      agreedToStore: input.agreedToStore,
      agreedToAutoCharge: input.agreedToAutoCharge,
    },
  });

  return consent;
}
