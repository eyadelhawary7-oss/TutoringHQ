// src/lib/summer/engine.ts
//
// Pure decision engine for the daily summer passes. Given one customer's summer
// state + the config + today's Cairo date, decide the single next action. No DB,
// no clock — the server runner maps rows to states, calls this, and applies the
// action. Keeping the decision pure is what makes the held-vs-released gate and
// the date thresholds unit-testable.
//
// Two automatic phases:
//   • Enrollment (Aug 16+) — money-free, ALWAYS runs once summer mode is on. Moves
//     a signed-up customer from the free-for-all into their 14-day trial.
//   • First invoice (Aug 30+) — money. Only fires when the first-charge hold is
//     RELEASED. While HELD, an enrolled customer stays free and active forever.

import {
  computeSummerSchedule,
  type SummerSchedule,
  type SummerScheduleConfig,
} from '@/lib/summer/dates';

export type SummerCustomerStatus = 'none' | 'enrolled' | 'invoiced' | 'paid';

export interface SummerCustomerState {
  /** Persisted summer_status ('none' = NULL = not yet enrolled). */
  summerStatus: SummerCustomerStatus;
  /** Cairo calendar date (YYYY-MM-DD) the customer signed up. */
  signupDateCairo: string;
  /** Persisted summer_first_invoice_at (set at enrollment). */
  firstInvoiceAt?: string | null;
  /** Persisted lock day (Cairo YYYY-MM-DD) — first_invoice_at + pay window. */
  lockDay?: string | null;
  /** Whether the linked first invoice has been paid. */
  firstInvoicePaid?: boolean;
}

export type SummerAction =
  | { kind: 'enroll'; schedule: SummerSchedule }
  | { kind: 'issue_invoice' }
  | { kind: 'lock' }
  | { kind: 'mark_paid' }
  | { kind: 'none' };

export interface SummerDecisionContext {
  cfg: SummerScheduleConfig;
  todayCairo: string;
  /** firstChargeAllowed(cfg) — master switch ON and release RELEASED. */
  firstChargeReleased: boolean;
}

/**
 * Decide the one next action for a customer. Idempotent by construction: re-running
 * on the same day yields the same action, and the runner's applies are themselves
 * idempotent (status flips + unique invoice numbers).
 */
export function decideSummerAction(
  state: SummerCustomerState,
  ctx: SummerDecisionContext,
): SummerAction {
  const { cfg, todayCairo, firstChargeReleased } = ctx;

  switch (state.summerStatus) {
    case 'none':
      // Enrollment is automatic and money-free: once we're on/after SUMMER_FREE_UNTIL,
      // pull every signed-up customer into their trial. Before that, nothing to do
      // (the whole platform is free-for-all).
      if (todayCairo >= cfg.freeUntil) {
        return { kind: 'enroll', schedule: computeSummerSchedule(state.signupDateCairo, cfg) };
      }
      return { kind: 'none' };

    case 'enrolled':
      // First invoice is the money step — gated on the one-time release. While HELD,
      // the customer stays enrolled, free, and active indefinitely.
      if (firstChargeReleased && state.firstInvoiceAt && todayCairo >= state.firstInvoiceAt) {
        return { kind: 'issue_invoice' };
      }
      return { kind: 'none' };

    case 'invoiced':
      // Paid → roll into the normal paid subscription. Otherwise, lock at the lock
      // day (still gated on release; a HELD operator can't lock anyone).
      if (state.firstInvoicePaid) return { kind: 'mark_paid' };
      if (firstChargeReleased && state.lockDay && todayCairo >= state.lockDay) {
        return { kind: 'lock' };
      }
      return { kind: 'none' };

    case 'paid':
    default:
      return { kind: 'none' };
  }
}
