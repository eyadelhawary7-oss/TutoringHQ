/**
 * Saved-Card Engine — auto-charge (Phase 1, requirement 1b). THE KEYSTONE.
 *
 * A single, well-tested, server-side function that charges a saved card on
 * demand with NO customer present (merchant-initiated, is_3d_secure:false). It
 * looks up the owner's stored token + the recurring integration id and calls
 * Paymob, replaying the stored-credential reference.
 *
 * Reliability guarantees (see Reliability section of the Phase 1 spec):
 *  - The charge INTENT is persisted (status 'created') BEFORE Paymob is called,
 *    so a "charged at Paymob but our DB didn't record it" failure is detectable
 *    and reconcilable. Status flips to 'submitted' immediately before the call.
 *  - The idempotency key (customer+invoice+period) is UNIQUE. Same key → same
 *    result: a completed success is replayed, never re-charged. A key reused with
 *    a DIFFERENT charge body (amount/owner/invoice) is rejected.
 *  - A prior attempt left 'submitted' (network timeout / pending) is NOT
 *    re-charged blindly — it returns needs_reconciliation for Phase 2 to settle.
 *
 * This function is callable + testable on its own. It is NOT wired to any cron
 * or schedule in Phase 1 — Phase 2 calls it from the midnight billing run.
 */

import {
  buildIdempotencyKey,
  buildRequestFingerprint,
} from './idempotency';
import type {
  OwnerRef,
  PaymobRecurringClient,
  SavedCardStore,
  ChargeIntentRecord,
} from './types';

export interface ChargeSavedCardInput {
  owner: OwnerRef;
  /** Amount in EGP (whole pounds with optional 2dp). Must be > 0. */
  amount: number;
  /** Invoice this charge settles (used in the idempotency key). */
  invoiceId?: string | null;
  /** Billing period key, e.g. '2026-07'. Part of the idempotency key. */
  billingPeriod: string;
  currency?: string;
}

export interface ChargeSavedCardDeps {
  store: SavedCardStore;
  paymob: PaymobRecurringClient;
  /**
   * Resolver for the Paymob RECURRING integration id. This is the credential
   * Eyad must request from Paymob — until it exists, charging returns
   * 'recurring_integration_not_configured'. Defaults to reading the env var
   * PAYMOB_RECURRING_INTEGRATION_ID.
   */
  getRecurringIntegrationId?: () => string | undefined;
}

export type ChargeSavedCardResult =
  | { ok: true; status: 'charged'; intentId: string; transactionId: string | null }
  | { ok: true; status: 'already_charged'; intentId: string; transactionId: string | null }
  | { ok: false; status: 'no_saved_card' }
  | { ok: false; status: 'invalid_amount' }
  | { ok: false; status: 'idempotency_conflict'; intentId: string }
  | { ok: false; status: 'declined'; intentId: string; errorMessage: string | null }
  | { ok: false; status: 'recurring_integration_not_configured'; intentId: string }
  | { ok: false; status: 'needs_reconciliation'; intentId: string; errorMessage?: string | null };

function defaultIntegrationIdResolver(): string | undefined {
  const v = (process.env.PAYMOB_RECURRING_INTEGRATION_ID ?? '').trim();
  return v.length > 0 ? v : undefined;
}

export async function chargeSavedCard(
  input: ChargeSavedCardInput,
  deps: ChargeSavedCardDeps,
): Promise<ChargeSavedCardResult> {
  const { store, paymob } = deps;
  const currency = input.currency ?? 'EGP';
  const resolveIntegrationId =
    deps.getRecurringIntegrationId ?? defaultIntegrationIdResolver;

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, status: 'invalid_amount' };
  }

  const card = await store.getActiveCard(input.owner);
  if (!card) {
    return { ok: false, status: 'no_saved_card' };
  }

  const idempotencyKey = buildIdempotencyKey({
    owner: input.owner,
    invoiceId: input.invoiceId ?? null,
    billingPeriod: input.billingPeriod,
  });
  const fingerprint = buildRequestFingerprint({
    owner: input.owner,
    invoiceId: input.invoiceId ?? null,
    billingPeriod: input.billingPeriod,
    amount: input.amount,
    currency,
  });

  // Resolve the intent for this key: reuse an existing one, or create it.
  let intent = await store.getIntentByKey(idempotencyKey);
  if (intent) {
    if (intent.requestFingerprint !== fingerprint) {
      // Same key, different charge body → must NOT be served as the same charge.
      return { ok: false, status: 'idempotency_conflict', intentId: intent.id };
    }
    switch (intent.status) {
      case 'succeeded':
        return {
          ok: true,
          status: 'already_charged',
          intentId: intent.id,
          transactionId: intent.paymobTransactionId ?? null,
        };
      case 'submitted':
        // We told Paymob to charge but never recorded a definitive outcome.
        // Do NOT re-charge — Phase 2 reconciliation settles this.
        return {
          ok: false,
          status: 'needs_reconciliation',
          intentId: intent.id,
          errorMessage: intent.lastError ?? null,
        };
      case 'failed':
      case 'voided':
        // A definitive prior decline for this exact charge.
        return {
          ok: false,
          status: 'declined',
          intentId: intent.id,
          errorMessage: intent.lastError ?? null,
        };
      case 'error':
        // Pre-submit error previously; safe to retry from a clean 'created' state.
        intent = await store.updateIntent(intent.id, {
          status: 'created',
          lastError: null,
        });
        break;
      case 'created':
        // Paymob was never called for this row — safe to proceed below.
        break;
    }
  } else {
    try {
      intent = await store.insertIntent({
        idempotencyKey,
        savedCardId: card.id,
        owner: input.owner,
        invoiceId: input.invoiceId ?? null,
        billingPeriod: input.billingPeriod,
        amount: input.amount,
        currency,
        requestFingerprint: fingerprint,
      });
    } catch {
      // Lost a race on the UNIQUE idempotency_key — re-read and resolve.
      const raced = await store.getIntentByKey(idempotencyKey);
      if (!raced) {
        return { ok: false, status: 'needs_reconciliation', intentId: '', errorMessage: 'intent insert race' };
      }
      if (raced.requestFingerprint !== fingerprint) {
        return { ok: false, status: 'idempotency_conflict', intentId: raced.id };
      }
      if (raced.status === 'succeeded') {
        return { ok: true, status: 'already_charged', intentId: raced.id, transactionId: raced.paymobTransactionId ?? null };
      }
      return { ok: false, status: 'needs_reconciliation', intentId: raced.id };
    }
    await store.insertEvent({
      eventType: 'charge_intent_created',
      owner: input.owner,
      savedCardId: card.id,
      chargeIntentId: intent.id,
      details: { idempotencyKey, amount: input.amount, currency, invoiceId: input.invoiceId ?? null },
    });
  }

  const integrationId = resolveIntegrationId();
  if (!integrationId) {
    const updated = await store.updateIntent(intent.id, {
      status: 'error',
      lastError: 'recurring_integration_not_configured',
    });
    await store.insertEvent({
      eventType: 'charge_failed',
      owner: input.owner,
      savedCardId: card.id,
      chargeIntentId: intent.id,
      details: { reason: 'recurring_integration_not_configured' },
    });
    return { ok: false, status: 'recurring_integration_not_configured', intentId: updated.id };
  }

  // Mark submitted BEFORE the network call: if we crash now, reconciliation
  // knows the charge may have reached Paymob.
  intent = await store.updateIntent(intent.id, {
    status: 'submitted',
    attemptCount: intent.attemptCount + 1,
  });

  let outcome;
  try {
    outcome = await paymob.chargeWithToken({
      token: card.paymobToken,
      amountCents: Math.round(input.amount * 100),
      integrationId,
      owner: input.owner,
      idempotencyKey,
      storedCredentialRef: card.storedCredentialRef ?? null,
      billingPeriod: input.billingPeriod,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'paymob charge threw';
    // Leave status 'submitted' — outcome is unknown, must be reconciled.
    await store.updateIntent(intent.id, { lastError: message });
    return { ok: false, status: 'needs_reconciliation', intentId: intent.id, errorMessage: message };
  }

  if (outcome.success) {
    const updated = await store.updateIntent(intent.id, {
      status: 'succeeded',
      paymobOrderId: outcome.orderId,
      paymobTransactionId: outcome.transactionId,
      completedAt: new Date().toISOString(),
    });
    await store.insertEvent({
      eventType: 'charge_succeeded',
      owner: input.owner,
      savedCardId: card.id,
      chargeIntentId: intent.id,
      details: { transactionId: outcome.transactionId, orderId: outcome.orderId, amount: input.amount },
    });
    return { ok: true, status: 'charged', intentId: updated.id, transactionId: outcome.transactionId };
  }

  if (outcome.pending) {
    // Ambiguous: Paymob accepted but not yet final. Leave 'submitted'.
    await store.updateIntent(intent.id, {
      paymobOrderId: outcome.orderId,
      paymobTransactionId: outcome.transactionId,
      lastError: outcome.errorMessage ?? 'pending',
    });
    return { ok: false, status: 'needs_reconciliation', intentId: intent.id, errorMessage: outcome.errorMessage ?? 'pending' };
  }

  // Definitive decline.
  const updated = await store.updateIntent(intent.id, {
    status: 'failed',
    paymobOrderId: outcome.orderId,
    paymobTransactionId: outcome.transactionId,
    lastError: outcome.errorMessage ?? 'declined',
    completedAt: new Date().toISOString(),
  });
  await store.insertEvent({
    eventType: 'charge_failed',
    owner: input.owner,
    savedCardId: card.id,
    chargeIntentId: intent.id,
    details: { reason: outcome.errorMessage ?? 'declined', transactionId: outcome.transactionId },
  });
  return { ok: false, status: 'declined', intentId: updated.id, errorMessage: outcome.errorMessage ?? null };
}

export type { ChargeIntentRecord };
