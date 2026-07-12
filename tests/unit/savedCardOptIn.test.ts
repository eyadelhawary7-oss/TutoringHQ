import { describe, it, expect } from 'vitest';
import { optInToCardTokenization, consentIsSufficient } from '@/lib/savedCard/consent';
import { makeInMemoryStore, CENTER_OWNER, TEACHER_OWNER } from './savedCardFakes';

/**
 * W3 / Gap 1 — first-payment tokenization is strictly OPT-IN.
 *
 * `optInToCardTokenization` is the gate the /pay routes use to decide whether to
 * send Paymob `request_token: true`. It must:
 *  - return false (and record nothing) when the customer did NOT tick "save card",
 *    preserving the card-less default; and
 *  - return true ONLY after recording a sufficient consent (store + auto-charge)
 *    through the canonical path, for centers AND teachers.
 */
describe('optInToCardTokenization — opt-in only card saving (Gap 1)', () => {
  it('does NOT request a token and records nothing when the customer did not opt in', async () => {
    const store = makeInMemoryStore();
    const requestToken = await optInToCardTokenization(store, {
      owner: CENTER_OWNER,
      saveCard: false,
      locale: 'ar',
      userId: 'user-1',
    });
    expect(requestToken).toBe(false);
    expect(store.consents).toHaveLength(0);
    expect(store.events).toHaveLength(0);
  });

  it('does NOT request a token off a stale, insufficient consent when unticked', async () => {
    const store = makeInMemoryStore();
    // A partial consent already exists (store only, no auto-charge). Unticked pay
    // must still be card-less — never tokenize without a fresh explicit opt-in.
    await store.insertConsent({
      owner: CENTER_OWNER,
      consentVersion: 'v1',
      consentText: 'x',
      locale: 'ar',
      agreedToStore: true,
      agreedToAutoCharge: false,
    });
    const requestToken = await optInToCardTokenization(store, {
      owner: CENTER_OWNER,
      saveCard: false,
      locale: 'ar',
    });
    expect(requestToken).toBe(false);
  });

  it('records a sufficient consent and requests a token for a CENTER opt-in', async () => {
    const store = makeInMemoryStore();
    const requestToken = await optInToCardTokenization(store, {
      owner: CENTER_OWNER,
      saveCard: true,
      locale: 'ar',
      userId: 'user-9',
      ipAddress: '1.2.3.4',
      userAgent: 'jest',
    });
    expect(requestToken).toBe(true);
    expect(store.consents).toHaveLength(1);
    const consent = store.consents[0];
    expect(consent.ownerType).toBe('center');
    expect(consent.ownerId).toBe(CENTER_OWNER.ownerId);
    expect(consentIsSufficient(consent)).toBe(true);
    expect(store.events.some((e) => e.eventType === 'consent_recorded')).toBe(true);
  });

  it('records a TEACHER consent (owner_type teacher) and requests a token on opt-in', async () => {
    const store = makeInMemoryStore();
    const requestToken = await optInToCardTokenization(store, {
      owner: TEACHER_OWNER,
      saveCard: true,
      locale: 'en',
    });
    expect(requestToken).toBe(true);
    expect(store.consents).toHaveLength(1);
    expect(store.consents[0].ownerType).toBe('teacher');
    expect(store.consents[0].ownerId).toBe(TEACHER_OWNER.ownerId);
    expect(store.consents[0].agreedToStore).toBe(true);
    expect(store.consents[0].agreedToAutoCharge).toBe(true);
  });
});
