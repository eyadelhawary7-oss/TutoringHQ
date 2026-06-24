/**
 * Saved-Card Engine — idempotency helpers (Phase 1, Reliability section).
 *
 * The idempotency key is derived deterministically from the customer + invoice +
 * billing period so the SAME logical charge always resolves to the SAME key (and
 * therefore the same persisted intent). The request fingerprint is a hash of the
 * canonical charge body; a key reused with a DIFFERENT body is rejected upstream.
 */

import crypto from 'crypto';
import type { OwnerRef } from './types';

const KEY_VERSION = 'v1';

/** Deterministic idempotency key for one customer+invoice+period charge. */
export function buildIdempotencyKey(params: {
  owner: OwnerRef;
  invoiceId?: string | null;
  billingPeriod: string;
}): string {
  const inv = params.invoiceId ? params.invoiceId : 'noinv';
  return [
    'mit',
    KEY_VERSION,
    params.owner.ownerType,
    params.owner.ownerId,
    inv,
    params.billingPeriod,
  ].join(':');
}

/**
 * Stable SHA-256 of the canonical charge body. Two charges with identical
 * (owner, invoice, period, amount, currency) produce the same fingerprint; any
 * difference (e.g. a changed amount) produces a different one.
 */
export function buildRequestFingerprint(params: {
  owner: OwnerRef;
  invoiceId?: string | null;
  billingPeriod: string;
  amount: number;
  currency: string;
}): string {
  const canonical = JSON.stringify({
    ownerType: params.owner.ownerType,
    ownerId: params.owner.ownerId,
    invoiceId: params.invoiceId ?? null,
    billingPeriod: params.billingPeriod,
    // Normalize amount to 2dp string so 100 and 100.00 fingerprint identically.
    amount: Number(params.amount).toFixed(2),
    currency: params.currency,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
