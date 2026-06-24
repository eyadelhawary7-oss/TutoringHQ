import { describe, it, expect } from 'vitest';
import {
  saveCardFromFirstPayment,
  parsePaymobTokenCallback,
} from '@/lib/savedCard/saveCard';
import { recordConsent } from '@/lib/savedCard/consent';
import type { CardTokenData } from '@/lib/savedCard/types';
import { makeInMemoryStore, makeFakePaymob, CENTER_OWNER } from './savedCardFakes';

const VALID_CARD: CardTokenData = {
  token: 'tok_opaque_abc123',
  last4: '4242',
  brand: 'visa',
  expMonth: 11,
  expYear: 2030,
  initialTransactionRef: 'txn_init_1',
  storedCredentialRef: 'scr_ref_1',
};

const INTEGRATION = () => 'rec-int-123';

async function withConsent() {
  const store = makeInMemoryStore();
  await recordConsent(store, {
    owner: CENTER_OWNER,
    locale: 'ar',
    agreedToStore: true,
    agreedToAutoCharge: true,
  });
  return store;
}

describe('saveCardFromFirstPayment — consent gate', () => {
  it('refuses to store a card when no sufficient consent exists', async () => {
    const store = makeInMemoryStore();
    const paymob = makeFakePaymob({});
    const res = await saveCardFromFirstPayment(
      { owner: CENTER_OWNER, card: VALID_CARD },
      { store, paymob, getRecurringIntegrationId: INTEGRATION },
    );
    expect(res).toEqual({ ok: false, reason: 'consent_required' });
    expect(store.cards).toHaveLength(0);
    // A dead/declined card never even reaches the validity probe without consent.
    expect(paymob.validityCalls).toHaveLength(0);
  });
});

describe('saveCardFromFirstPayment — happy path stores token, NEVER the PAN', () => {
  it('stores only the token + last4 + expiry + stored-credential ref', async () => {
    const store = await withConsent();
    const paymob = makeFakePaymob({ validity: () => ({ live: true, transactionId: 'auth_1' }) });
    const res = await saveCardFromFirstPayment(
      { owner: CENTER_OWNER, card: VALID_CARD },
      { store, paymob, getRecurringIntegrationId: INTEGRATION },
    );
    expect(res.ok).toBe(true);
    expect(store.cards).toHaveLength(1);
    const card = store.cards[0];
    expect(card.status).toBe('active');
    expect(card.paymobToken).toBe('tok_opaque_abc123');
    expect(card.last4).toBe('4242');
    expect(card.expMonth).toBe(11);
    expect(card.expYear).toBe(2030);
    expect(card.storedCredentialRef).toBe('scr_ref_1');
    expect(card.validityCheckedAt).toBeTruthy();
    // Validity probe ran; card_saved + validity_check_passed events recorded.
    expect(paymob.validityCalls).toHaveLength(1);
    expect(store.events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining(['validity_check_passed', 'card_saved']),
    );
    // Structurally prove no PAN leaked: only 4 stored digits, no 13-19 digit run.
    const serialized = JSON.stringify(card);
    expect(serialized).not.toMatch(/\d{13,19}/);
  });
});

describe('saveCardFromFirstPayment — validity check (1d) rejects a dead card at save time', () => {
  it('does not store a card whose authorization is declined', async () => {
    const store = await withConsent();
    const paymob = makeFakePaymob({
      validity: () => ({ live: false, errorMessage: 'do not honor' }),
    });
    const res = await saveCardFromFirstPayment(
      { owner: CENTER_OWNER, card: VALID_CARD },
      { store, paymob, getRecurringIntegrationId: INTEGRATION },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('card_invalid');
    expect(store.cards).toHaveLength(0);
    expect(store.events.some((e) => e.eventType === 'validity_check_failed')).toBe(true);
  });
});

describe('saveCardFromFirstPayment — recurring integration not yet provisioned', () => {
  it('reports recurring_integration_not_configured and stores nothing', async () => {
    const store = await withConsent();
    const paymob = makeFakePaymob({});
    const res = await saveCardFromFirstPayment(
      { owner: CENTER_OWNER, card: VALID_CARD },
      { store, paymob, getRecurringIntegrationId: () => undefined },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('recurring_integration_not_configured');
    expect(store.cards).toHaveLength(0);
  });
});

describe('parsePaymobTokenCallback — derives last4, never keeps the PAN', () => {
  it('extracts token + last4 + brand + expiry from a TOKEN callback', () => {
    const parsed = parsePaymobTokenCallback({
      id: 999,
      token: 'tok_xyz',
      masked_pan: '512345xxxxxx2346',
      card_subtype: 'MasterCard',
      order_id: 'order_55',
      exp_month: 5,
      exp_year: 29,
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.token).toBe('tok_xyz');
    expect(parsed!.last4).toBe('2346');
    expect(parsed!.brand).toBe('MasterCard');
    expect(parsed!.expMonth).toBe(5);
    expect(parsed!.expYear).toBe(2029); // 2-digit year normalized
    // No full PAN is ever surfaced.
    expect(JSON.stringify(parsed)).not.toContain('512345');
  });

  it('returns null when no token is present', () => {
    expect(parsePaymobTokenCallback({ masked_pan: '1234' })).toBeNull();
  });
});
