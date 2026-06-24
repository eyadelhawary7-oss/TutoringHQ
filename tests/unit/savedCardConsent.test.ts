import { describe, it, expect } from 'vitest';
import {
  recordConsent,
  consentIsSufficient,
  getConsentText,
  CONSENT_VERSION,
} from '@/lib/savedCard/consent';
import { makeInMemoryStore, CENTER_OWNER } from './savedCardFakes';

describe('saved-card consent', () => {
  it('records who/when/what — version, locale, both flags, and a snapshot of the text', async () => {
    const store = makeInMemoryStore();
    const consent = await recordConsent(store, {
      owner: CENTER_OWNER,
      locale: 'ar',
      agreedToStore: true,
      agreedToAutoCharge: true,
      userId: 'user-9',
      ipAddress: '1.2.3.4',
      userAgent: 'jest',
    });

    expect(consent.consentVersion).toBe(CONSENT_VERSION);
    expect(consent.locale).toBe('ar');
    expect(consent.agreedToStore).toBe(true);
    expect(consent.agreedToAutoCharge).toBe(true);
    expect(consent.userId).toBe('user-9');
    // Stored text is the server-canonical text (never client supplied).
    expect(consent.consentText).toBe(getConsentText('ar'));
    expect(store.consents).toHaveLength(1);
    expect(store.events.some((e) => e.eventType === 'consent_recorded')).toBe(true);
  });

  it('treats consent as sufficient only when BOTH store and auto-charge are agreed', () => {
    expect(consentIsSufficient({ agreedToStore: true, agreedToAutoCharge: true })).toBe(true);
    expect(consentIsSufficient({ agreedToStore: true, agreedToAutoCharge: false })).toBe(false);
    expect(consentIsSufficient({ agreedToStore: false, agreedToAutoCharge: true })).toBe(false);
    expect(consentIsSufficient(null)).toBe(false);
  });

  it('provides Arabic-first consent text for both locales', () => {
    expect(getConsentText('ar')).toMatch(/باي موب|البطاقة/);
    expect(getConsentText('en').toLowerCase()).toContain('paymob');
  });
});
