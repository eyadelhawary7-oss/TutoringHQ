/**
 * In-memory fakes for the Saved-Card Engine unit tests. No network, no DB.
 * The InMemoryStore mirrors the real DB invariants that the engine relies on:
 *  - card_charge_intents.idempotency_key is UNIQUE (insertIntent throws on dup)
 *  - at most one ACTIVE card per owner (revokeActiveCards flips active→revoked)
 */

import type {
  SavedCardStore,
  PaymobRecurringClient,
  PaymobChargeOutcome,
  CardValidityResult,
  OwnerRef,
  SavedCardRecord,
  ConsentRecord,
  ChargeIntentRecord,
} from '@/lib/savedCard/types';

let seq = 0;
function id(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq}`;
}

function sameOwner(a: OwnerRef, r: { ownerType: string; ownerId: string }): boolean {
  return a.ownerType === r.ownerType && a.ownerId === r.ownerId;
}

export interface InMemoryStore extends SavedCardStore {
  cards: SavedCardRecord[];
  consents: ConsentRecord[];
  intents: ChargeIntentRecord[];
  events: Array<{ eventType: string; details?: Record<string, unknown> }>;
}

export function makeInMemoryStore(): InMemoryStore {
  const cards: SavedCardRecord[] = [];
  const consents: ConsentRecord[] = [];
  const intents: ChargeIntentRecord[] = [];
  const events: InMemoryStore['events'] = [];

  return {
    cards,
    consents,
    intents,
    events,

    async getActiveCard(owner) {
      return cards.find((c) => sameOwner(owner, c) && c.status === 'active') ?? null;
    },

    async insertConsent(p) {
      const rec: ConsentRecord = {
        id: id('consent'),
        ownerType: p.owner.ownerType,
        ownerId: p.owner.ownerId,
        consentVersion: p.consentVersion,
        consentText: p.consentText,
        locale: p.locale,
        agreedToStore: p.agreedToStore,
        agreedToAutoCharge: p.agreedToAutoCharge,
        userId: p.userId ?? null,
        createdAt: `t${seq}`,
      };
      consents.push(rec);
      return rec;
    },

    async getConsentById(cid) {
      return consents.find((c) => c.id === cid) ?? null;
    },

    async getLatestConsent(owner) {
      const list = consents.filter((c) => sameOwner(owner, c));
      return list.length ? list[list.length - 1] : null;
    },

    async revokeActiveCards(owner) {
      for (const c of cards) {
        if (sameOwner(owner, c) && c.status === 'active') c.status = 'revoked';
      }
    },

    async insertCard(p) {
      const rec: SavedCardRecord = {
        id: id('card'),
        ownerType: p.owner.ownerType,
        ownerId: p.owner.ownerId,
        paymobToken: p.card.token,
        last4: p.card.last4,
        brand: p.card.brand ?? null,
        expMonth: p.card.expMonth,
        expYear: p.card.expYear,
        storedCredentialRef: p.card.storedCredentialRef ?? null,
        initialTransactionRef: p.card.initialTransactionRef ?? null,
        status: 'active',
        consentId: p.consentId,
        validityCheckedAt: p.validityCheckedAt,
      };
      cards.push(rec);
      return rec;
    },

    async updateCardStatus(cardId, status) {
      const c = cards.find((x) => x.id === cardId);
      if (c) c.status = status;
    },

    async getIntentByKey(key) {
      return intents.find((i) => i.idempotencyKey === key) ?? null;
    },

    async insertIntent(p) {
      if (intents.some((i) => i.idempotencyKey === p.idempotencyKey)) {
        throw new Error('duplicate idempotency_key'); // mirrors the UNIQUE constraint
      }
      const rec: ChargeIntentRecord = {
        id: id('intent'),
        idempotencyKey: p.idempotencyKey,
        savedCardId: p.savedCardId,
        ownerType: p.owner.ownerType,
        ownerId: p.owner.ownerId,
        invoiceId: p.invoiceId ?? null,
        billingPeriod: p.billingPeriod ?? null,
        amount: p.amount,
        currency: p.currency,
        requestFingerprint: p.requestFingerprint,
        status: 'created',
        is3dSecure: false,
        attemptCount: 0,
        paymobOrderId: null,
        paymobTransactionId: null,
        lastError: null,
      };
      intents.push(rec);
      return rec;
    },

    async updateIntent(intentId, fields) {
      const i = intents.find((x) => x.id === intentId);
      if (!i) throw new Error('intent not found');
      if (fields.status !== undefined) i.status = fields.status;
      if (fields.attemptCount !== undefined) i.attemptCount = fields.attemptCount;
      if (fields.paymobOrderId !== undefined) i.paymobOrderId = fields.paymobOrderId;
      if (fields.paymobTransactionId !== undefined) i.paymobTransactionId = fields.paymobTransactionId;
      if (fields.lastError !== undefined) i.lastError = fields.lastError;
      return i;
    },

    async insertEvent(p) {
      events.push({ eventType: p.eventType, details: p.details });
    },
  };
}

/** Configurable fake Paymob client that records calls. */
export interface FakePaymob extends PaymobRecurringClient {
  chargeCalls: Array<{
    token: string;
    amountCents: number;
    integrationId: string;
    storedCredentialRef?: string | null;
    idempotencyKey: string;
  }>;
  validityCalls: Array<{ token: string; amountCents: number }>;
}

export function makeFakePaymob(opts: {
  charge?: (call: { token: string; amountCents: number }) => PaymobChargeOutcome | Promise<PaymobChargeOutcome>;
  validity?: (call: { token: string }) => CardValidityResult | Promise<CardValidityResult>;
}): FakePaymob {
  const chargeCalls: FakePaymob['chargeCalls'] = [];
  const validityCalls: FakePaymob['validityCalls'] = [];
  return {
    chargeCalls,
    validityCalls,
    async chargeWithToken(params) {
      chargeCalls.push({
        token: params.token,
        amountCents: params.amountCents,
        integrationId: params.integrationId,
        storedCredentialRef: params.storedCredentialRef,
        idempotencyKey: params.idempotencyKey,
      });
      if (opts.charge) return opts.charge({ token: params.token, amountCents: params.amountCents });
      return { success: true, pending: false, transactionId: 'txn_default', orderId: 'order_default', errorMessage: null };
    },
    async authorizeAndVoid(params) {
      validityCalls.push({ token: params.token, amountCents: params.amountCents });
      if (opts.validity) return opts.validity({ token: params.token });
      return { live: true, transactionId: 'auth_default' };
    },
  };
}

export const CENTER_OWNER: OwnerRef = { ownerType: 'center', ownerId: 'center-1' };
export const TEACHER_OWNER: OwnerRef = { ownerType: 'teacher', ownerId: 'teacher-1' };
