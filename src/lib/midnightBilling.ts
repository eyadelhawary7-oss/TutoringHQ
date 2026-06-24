/**
 * Phase 2 (2a/2c/2d) — the midnight billing engine.
 *
 * Runs at 00:00 Africa/Cairo. For every customer (center or teacher) whose
 * billing date is today — and every soft-declined charge whose retry is due
 * today — it attempts the Phase 1 merchant-initiated `chargeSavedCard` and routes
 * the result:
 *
 *   - card customer with a saved card → auto-charge.
 *   - wallet / no saved card          → leave an unpaid invoice + pay link (manual).
 *   - bank refuses the MIT (auth)     → unpaid + OTP fallback link, NO retry.
 *   - hard-final decline (dead card)  → unpaid + manual, NO retry.
 *   - soft decline                    → schedule a retry (day 0 → +3 → +7, 3 total).
 *   - retries exhausted               → lock fires at the next Cairo midnight.
 *
 * Idempotency: every charge goes through Phase 1's UNIQUE idempotency key
 * (owner+invoice+period+attempt), so re-running the cron for the same day never
 * double-charges. The adapter additionally skips invoices already paid.
 *
 * This module is pure orchestration over an injected adapter + charger, so it is
 * fully unit-testable with no DB or network. The Supabase adapter + the cron
 * route live alongside it.
 *
 * INERT until `PAYMOB_RECURRING_INTEGRATION_ID` is set: with no recurring id,
 * `chargeSavedCard` returns 'recurring_integration_not_configured' and the engine
 * leaves the customer on the manual surface — nothing is ever charged.
 */

import { classifyPaymobDecline } from '@/lib/savedCard/declineClassification';
import type { ChargeSavedCardInput, ChargeSavedCardResult } from '@/lib/savedCard/autoCharge';
import type { OwnerRef } from '@/lib/savedCard/types';

/**
 * Gap in days from the CURRENT attempt day to the next attempt. Attempts land on
 * day 0 (billing day), +3, then +7 — i.e. gaps [3, 4] — for 3 attempts total,
 * well under the card-scheme caps (Visa 15 / Mastercard 35 per 30 days).
 */
export const RETRY_GAP_DAYS = [3, 4] as const;
export const MAX_CHARGE_ATTEMPTS = 1 + RETRY_GAP_DAYS.length; // 3

export type ManualReason =
  | 'no_saved_card'
  | 'auth_required'
  | 'hard_final'
  | 'recurring_not_configured';

export type DueOutcome =
  | { kind: 'charged' }
  | { kind: 'already_charged' }
  | { kind: 'manual_unpaid'; reason: ManualReason }
  | { kind: 'retry_scheduled'; nextRetryYmd: string; attempt: number }
  | { kind: 'final_failed' }
  | { kind: 'reconcile' };

/** One customer/charge due today (an initial charge or a scheduled retry). */
export interface DueChargeable {
  /** Stable id for logging (invoice id for centers, subscription id for teachers). */
  key: string;
  customerType: 'center' | 'teacher';
  owner: OwnerRef;
  amount: number;
  /** Center invoice id this settles; null for teachers (no center invoice). */
  invoiceId: string | null;
  /** Period key, e.g. '2026-07'. Part of the idempotency key. */
  periodKey: string;
  /** Cairo calendar date (YYYY-MM-DD) the charge is due — the single-day anchor. */
  billingDayCairo: string;
  hasSavedCard: boolean;
  /** 0 = initial day-0 charge, 1.. = retries (from invoice.retry_count / dunning). */
  attemptIndex: number;
}

export interface MidnightBillingSummary {
  processed: number;
  charged: number;
  alreadyCharged: number;
  manualUnpaid: number;
  retriesScheduled: number;
  finalFailed: number;
  reconcile: number;
  errors: number;
}

export interface MidnightBillingAdapter {
  /** Cairo calendar date (YYYY-MM-DD) for "now". */
  todayCairo(): string;
  /** Every customer due an initial charge today + every retry due today. */
  listDue(todayCairo: string): Promise<DueChargeable[]>;
  applyCharged(item: DueChargeable, result: ChargeSavedCardResult): Promise<void>;
  applyAlreadyCharged(item: DueChargeable, result: ChargeSavedCardResult): Promise<void>;
  applyManualUnpaid(item: DueChargeable, reason: ManualReason): Promise<void>;
  applyRetryScheduled(item: DueChargeable, nextRetryYmd: string, attempt: number): Promise<void>;
  applyFinalFailed(item: DueChargeable): Promise<void>;
  applyReconcile(item: DueChargeable, result: ChargeSavedCardResult): Promise<void>;
}

export interface MidnightBillingDeps {
  charge: (input: ChargeSavedCardInput) => Promise<ChargeSavedCardResult>;
  /** Cairo-calendar day addition (defaults to the project helper). */
  addDays?: (cairoYmd: string, delta: number) => string;
}

/**
 * Pure decision: given the charge result + which attempt this was, decide what the
 * cron should do. No side effects — the orchestrator applies it via the adapter.
 */
export function decideAfterCharge(params: {
  result: ChargeSavedCardResult;
  attemptIndex: number;
  billingDayCairo: string;
  addDays: (cairoYmd: string, delta: number) => string;
}): DueOutcome {
  const { result, attemptIndex, billingDayCairo, addDays } = params;

  if (result.ok) {
    return { kind: result.status === 'already_charged' ? 'already_charged' : 'charged' };
  }

  switch (result.status) {
    case 'no_saved_card':
      return { kind: 'manual_unpaid', reason: 'no_saved_card' };
    case 'recurring_integration_not_configured':
      return { kind: 'manual_unpaid', reason: 'recurring_not_configured' };
    case 'needs_reconciliation':
    case 'idempotency_conflict':
      return { kind: 'reconcile' };
    case 'invalid_amount':
      // Nothing chargeable — treat as needing manual attention, no retry.
      return { kind: 'manual_unpaid', reason: 'hard_final' };
    case 'declined': {
      const kind = classifyPaymobDecline({
        code: result.declineCode,
        message: result.errorMessage,
      });
      if (kind === 'auth_required') return { kind: 'manual_unpaid', reason: 'auth_required' };
      if (kind === 'hard_final') return { kind: 'manual_unpaid', reason: 'hard_final' };
      // soft_retryable: schedule the next attempt if any remain, else give up.
      const gap = RETRY_GAP_DAYS[attemptIndex];
      if (attemptIndex + 1 < MAX_CHARGE_ATTEMPTS && gap != null) {
        return {
          kind: 'retry_scheduled',
          nextRetryYmd: addDays(billingDayCairo, gap),
          attempt: attemptIndex + 1,
        };
      }
      return { kind: 'final_failed' };
    }
    default:
      return { kind: 'reconcile' };
  }
}

function emptySummary(): MidnightBillingSummary {
  return {
    processed: 0,
    charged: 0,
    alreadyCharged: 0,
    manualUnpaid: 0,
    retriesScheduled: 0,
    finalFailed: 0,
    reconcile: 0,
    errors: 0,
  };
}

export async function runMidnightBilling(
  adapter: MidnightBillingAdapter,
  deps: MidnightBillingDeps,
): Promise<MidnightBillingSummary> {
  const summary = emptySummary();
  const addDays = deps.addDays ?? ((ymd: string) => ymd);
  const today = adapter.todayCairo();
  const due = await adapter.listDue(today);

  for (const item of due) {
    summary.processed += 1;
    try {
      // No saved card → manual surface, never attempt a charge.
      if (!item.hasSavedCard) {
        await adapter.applyManualUnpaid(item, 'no_saved_card');
        summary.manualUnpaid += 1;
        continue;
      }

      const result = await deps.charge({
        owner: item.owner,
        amount: item.amount,
        invoiceId: item.invoiceId,
        // Encode the attempt into the period so each scheduled retry is a distinct
        // idempotent unit (same-day cron re-runs reuse the key → no double charge).
        billingPeriod: `${item.periodKey}:a${item.attemptIndex}`,
      });

      const outcome = decideAfterCharge({
        result,
        attemptIndex: item.attemptIndex,
        billingDayCairo: item.billingDayCairo,
        addDays,
      });

      switch (outcome.kind) {
        case 'charged':
          await adapter.applyCharged(item, result);
          summary.charged += 1;
          break;
        case 'already_charged':
          await adapter.applyAlreadyCharged(item, result);
          summary.alreadyCharged += 1;
          break;
        case 'manual_unpaid':
          await adapter.applyManualUnpaid(item, outcome.reason);
          summary.manualUnpaid += 1;
          break;
        case 'retry_scheduled':
          await adapter.applyRetryScheduled(item, outcome.nextRetryYmd, outcome.attempt);
          summary.retriesScheduled += 1;
          break;
        case 'final_failed':
          await adapter.applyFinalFailed(item);
          summary.finalFailed += 1;
          break;
        case 'reconcile':
          await adapter.applyReconcile(item, result);
          summary.reconcile += 1;
          break;
      }
    } catch (err) {
      summary.errors += 1;
      console.error('[midnightBilling] item failed', item.key, err);
    }
  }

  return summary;
}
