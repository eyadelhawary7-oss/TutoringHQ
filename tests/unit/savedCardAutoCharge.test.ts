import { describe, it, expect } from 'vitest';
import { chargeSavedCard } from '@/lib/savedCard/autoCharge';
import type { OwnerRef } from '@/lib/savedCard/types';
import {
  makeInMemoryStore,
  makeFakePaymob,
  CENTER_OWNER,
  type InMemoryStore,
} from './savedCardFakes';

const INTEGRATION = () => 'rec-int-001';

async function seedActiveCard(
  store: InMemoryStore,
  owner: OwnerRef,
  overrides: Partial<{ token: string; storedCredentialRef: string }> = {},
) {
  const consent = await store.insertConsent({
    owner,
    consentVersion: 'v1',
    consentText: 'agreed',
    locale: 'ar',
    agreedToStore: true,
    agreedToAutoCharge: true,
  });
  return store.insertCard({
    owner,
    card: {
      token: overrides.token ?? 'tok_live',
      last4: '4242',
      brand: 'visa',
      expMonth: 12,
      expYear: 2030,
      storedCredentialRef: overrides.storedCredentialRef ?? 'scr-1',
      initialTransactionRef: 'init-1',
    },
    consentId: consent.id,
    validityCheckedAt: 'now',
  });
}

const CHARGE = { amount: 300, invoiceId: 'inv-1', billingPeriod: '2026-07' };

describe('chargeSavedCard — charges the right token for the right owner/amount', () => {
  it('calls Paymob with the owner token, amount in cents, recurring integration, and replays the stored-credential ref', async () => {
    const store = makeInMemoryStore();
    await seedActiveCard(store, CENTER_OWNER, { token: 'tok_live', storedCredentialRef: 'scr-1' });
    const paymob = makeFakePaymob({
      charge: () => ({ success: true, pending: false, transactionId: 'txn_77', orderId: 'ord_77', errorMessage: null }),
    });

    const res = await chargeSavedCard({ owner: CENTER_OWNER, ...CHARGE }, { store, paymob, getRecurringIntegrationId: INTEGRATION });

    expect(res).toMatchObject({ ok: true, status: 'charged', transactionId: 'txn_77' });
    expect(paymob.chargeCalls).toHaveLength(1);
    expect(paymob.chargeCalls[0]).toMatchObject({
      token: 'tok_live',
      amountCents: 30000,
      integrationId: 'rec-int-001',
      storedCredentialRef: 'scr-1',
    });
    expect(store.intents[0].status).toBe('succeeded');
    expect(store.intents[0].paymobTransactionId).toBe('txn_77');
  });
});

describe('chargeSavedCard — idempotency prevents a double charge on retry', () => {
  it('returns the cached success and does NOT charge again for the same key', async () => {
    const store = makeInMemoryStore();
    await seedActiveCard(store, CENTER_OWNER);
    const paymob = makeFakePaymob({
      charge: () => ({ success: true, pending: false, transactionId: 'txn_once', orderId: 'ord', errorMessage: null }),
    });

    const first = await chargeSavedCard({ owner: CENTER_OWNER, ...CHARGE }, { store, paymob, getRecurringIntegrationId: INTEGRATION });
    const second = await chargeSavedCard({ owner: CENTER_OWNER, ...CHARGE }, { store, paymob, getRecurringIntegrationId: INTEGRATION });

    expect(first).toMatchObject({ ok: true, status: 'charged' });
    expect(second).toMatchObject({ ok: true, status: 'already_charged', transactionId: 'txn_once' });
    expect(paymob.chargeCalls).toHaveLength(1); // charged exactly once
    expect(store.intents).toHaveLength(1);
  });
});

describe('chargeSavedCard — a key reused for a DIFFERENT charge body is rejected', () => {
  it('rejects with idempotency_conflict and does not charge', async () => {
    const store = makeInMemoryStore();
    await seedActiveCard(store, CENTER_OWNER);
    const paymob = makeFakePaymob({
      charge: () => ({ success: true, pending: false, transactionId: 't', orderId: 'o', errorMessage: null }),
    });

    await chargeSavedCard({ owner: CENTER_OWNER, ...CHARGE }, { store, paymob, getRecurringIntegrationId: INTEGRATION });
    // Same owner+invoice+period (same key) but a different amount.
    const conflict = await chargeSavedCard(
      { owner: CENTER_OWNER, amount: 999, invoiceId: 'inv-1', billingPeriod: '2026-07' },
      { store, paymob, getRecurringIntegrationId: INTEGRATION },
    );

    expect(conflict).toMatchObject({ ok: false, status: 'idempotency_conflict' });
    expect(paymob.chargeCalls).toHaveLength(1);
  });
});

describe('chargeSavedCard — an in-flight (submitted) charge is never re-charged blindly', () => {
  it('after a network failure mid-charge, a retry returns needs_reconciliation and does not re-charge', async () => {
    const store = makeInMemoryStore();
    await seedActiveCard(store, CENTER_OWNER);
    const paymob = makeFakePaymob({
      charge: () => {
        throw new Error('network timeout');
      },
    });

    const first = await chargeSavedCard({ owner: CENTER_OWNER, ...CHARGE }, { store, paymob, getRecurringIntegrationId: INTEGRATION });
    expect(first).toMatchObject({ ok: false, status: 'needs_reconciliation' });
    expect(store.intents[0].status).toBe('submitted'); // left submitted for reconciliation

    const retry = await chargeSavedCard({ owner: CENTER_OWNER, ...CHARGE }, { store, paymob, getRecurringIntegrationId: INTEGRATION });
    expect(retry).toMatchObject({ ok: false, status: 'needs_reconciliation' });
    expect(paymob.chargeCalls).toHaveLength(1); // only the first (failed) attempt hit Paymob
  });
});

describe('chargeSavedCard — guards', () => {
  it('returns no_saved_card when the owner has no active card', async () => {
    const store = makeInMemoryStore();
    const paymob = makeFakePaymob({});
    const res = await chargeSavedCard({ owner: CENTER_OWNER, ...CHARGE }, { store, paymob, getRecurringIntegrationId: INTEGRATION });
    expect(res).toEqual({ ok: false, status: 'no_saved_card' });
    expect(paymob.chargeCalls).toHaveLength(0);
  });

  it('returns recurring_integration_not_configured (and never calls Paymob) until the recurring integration id exists', async () => {
    const store = makeInMemoryStore();
    await seedActiveCard(store, CENTER_OWNER);
    const paymob = makeFakePaymob({});
    const res = await chargeSavedCard({ owner: CENTER_OWNER, ...CHARGE }, { store, paymob, getRecurringIntegrationId: () => undefined });
    expect(res).toMatchObject({ ok: false, status: 'recurring_integration_not_configured' });
    expect(paymob.chargeCalls).toHaveLength(0);
    expect(store.intents[0].status).toBe('error');
  });

  it('rejects a non-positive amount', async () => {
    const store = makeInMemoryStore();
    await seedActiveCard(store, CENTER_OWNER);
    const paymob = makeFakePaymob({});
    const res = await chargeSavedCard({ owner: CENTER_OWNER, amount: 0, invoiceId: 'inv-1', billingPeriod: '2026-07' }, { store, paymob, getRecurringIntegrationId: INTEGRATION });
    expect(res).toEqual({ ok: false, status: 'invalid_amount' });
  });

  it('marks a declined charge as failed and reports the decline', async () => {
    const store = makeInMemoryStore();
    await seedActiveCard(store, CENTER_OWNER);
    const paymob = makeFakePaymob({
      charge: () => ({ success: false, pending: false, transactionId: 'txn_d', orderId: 'o', errorMessage: 'insufficient funds' }),
    });
    const res = await chargeSavedCard({ owner: CENTER_OWNER, ...CHARGE }, { store, paymob, getRecurringIntegrationId: INTEGRATION });
    expect(res).toMatchObject({ ok: false, status: 'declined', errorMessage: 'insufficient funds' });
    expect(store.intents[0].status).toBe('failed');
  });
});
