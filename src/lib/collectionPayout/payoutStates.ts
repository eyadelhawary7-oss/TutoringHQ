// src/lib/collectionPayout/payoutStates.ts
//
// The payout lifecycle for SYSTEM 1 (referral + credit payouts). PURE.
//
// SYSTEM 2 (tuition settlement payouts) IS OUT OF SCOPE and deliberately not
// modelled here — PAYOUT-SYSTEM-SPEC.md §9. See the gap note at the foot of this
// file for what would have to be decided before it could be.
//
// PAYOUT-SYSTEM-SPEC.md §3 defines nine states. The four obvious ones are not
// enough; four more are load-bearing and one (`submitted`) is named in the §3
// index definition. All are enumerated here.

export const PAYOUT_STATES = [
  /** Centre asked. Funds HELD by a ledger posting, not sent. */
  'requested',
  /** A human authorised it. Destination snapshotted. Still not sent. */
  'approved',
  /** The disburse call is in flight. The dangerous state. */
  'submitting',
  /** Accepted by the provider, awaiting inquiry confirmation. */
  'submitted',
  /**
   * Call timed out or errored; we do NOT know whether the provider accepted it.
   * NEVER auto-retried. §6(a): the provider offers NO idempotency key of any
   * kind, so a retried disburse is processed as an entirely new transaction.
   */
  'indeterminate',
  /** An inquiry (never a callback) confirms the money moved. */
  'settled',
  /**
   * Bank Card code 8222 — "successful with warning, a transfer will take place
   * once authorized by the receiver bank". NOT terminal; stays in the inquiry
   * rotation AND stays in the open set (§7.2: omitting it from the open-payout
   * index frees the concurrency slot while funds are in flight).
   */
  'settled_pending_bank',
  /** Terminal per inquiry. Hold released. */
  'failed',
  /** Money came back after apparent success (000100/000102/000105/000108). */
  'returned',
  /** A clawback is in progress against this payout. */
  'reversing',
] as const;

export type PayoutState = (typeof PAYOUT_STATES)[number];

/**
 * TERMINAL states, ENUMERATED rather than derived (§7.2 requirement 4:
 * "Terminal states enumerated, not open ones … so a state added later defaults
 * to blocking").
 */
export const TERMINAL_PAYOUT_STATES: readonly PayoutState[] = ['settled', 'failed', 'returned'];

export function isTerminal(state: PayoutState): boolean {
  return TERMINAL_PAYOUT_STATES.includes(state);
}

/**
 * OPEN states — the set the `one_open_payout_per_center` partial unique index
 * covers (§3 invariant 3, corrected by §7.2 to include `settled_pending_bank`).
 *
 * Computed as "not terminal" DELIBERATELY, so a state added to PAYOUT_STATES
 * without being added to TERMINAL_PAYOUT_STATES defaults to BLOCKING a second
 * concurrent payout rather than silently permitting one.
 */
export const OPEN_PAYOUT_STATES: readonly PayoutState[] = PAYOUT_STATES.filter(
  (s) => !TERMINAL_PAYOUT_STATES.includes(s),
);

export function isOpen(state: PayoutState): boolean {
  return !isTerminal(state);
}

/**
 * Legal transitions. Anything not listed is refused by
 * `assertTransitionAllowed` AND by the `payout_transition` RPC in the migration
 * proposal — the RPC is the sole writer of payout state, so this table is a
 * pre-check for a legible error message, not the enforcement point.
 *
 * Note what is ABSENT and absent on purpose:
 *   - nothing transitions OUT of `settled`, `failed` or `returned` except
 *     `settled → reversing` and `settled_pending_bank → returned`;
 *   - `indeterminate` never goes straight to `submitting`. A resend is a fresh
 *     approval through the same RPC (§7.2 requirement 5) and a delegated
 *     approver may never authorise one, at any amount.
 */
const ALLOWED: Record<PayoutState, readonly PayoutState[]> = {
  requested: ['approved', 'failed'],
  approved: ['submitting', 'requested', 'failed'],
  submitting: ['submitted', 'indeterminate', 'failed'],
  submitted: ['settled', 'settled_pending_bank', 'indeterminate', 'failed'],
  indeterminate: ['settled', 'settled_pending_bank', 'failed', 'approved'],
  settled: ['reversing', 'returned'],
  settled_pending_bank: ['settled', 'returned', 'failed'],
  failed: [],
  returned: [],
  reversing: ['settled', 'returned'],
};

export type TransitionRefusal = { allowed: false; cause: string; messageKey: string };
export type TransitionOk = { allowed: true };

export function checkTransition(from: PayoutState, to: PayoutState): TransitionOk | TransitionRefusal {
  if (from === to) {
    // Idempotent re-call. The RPC treats this as a no-op success rather than an
    // error — §2.2's double-click must not produce two side effects, and it must
    // also not produce a spurious failure for the second caller.
    return { allowed: true };
  }
  if (!ALLOWED[from].includes(to)) {
    return {
      allowed: false,
      cause: `illegal_transition_${from}_to_${to}`,
      messageKey: 'collectionPayout.payout.illegalTransition',
    };
  }
  return { allowed: true };
}

/**
 * States in which the centre is waiting on a human and NOTHING is moving.
 *
 * §7.5, decided 3 August: "payouts wait. No fallback approver, at any amount,
 * for any duration." A queue that grows during an absence is the INTENDED
 * behaviour. These are the states that must age visibly.
 */
export const AWAITING_APPROVAL_STATES: readonly PayoutState[] = ['requested'];

/**
 * ── RECORDED GAP: SYSTEM 2 IS NOT DESIGNED HERE ──────────────────────────────
 *
 * Territory C's brief: "System 2 is unspecced and out of scope; if you find
 * yourself designing it, stop and record the gap instead." This is the record.
 *
 * System 2 (tuition settlement payouts — paying a provider their 90% of tuition
 * the platform collected) would differ from System 1 in four ways that are NOT
 * modelled anywhere in this file or in the migration proposal:
 *
 *   1. CUSTODY. System 1 moves the platform's OWN obligation. System 2 would
 *      hold parents' money. Under Egyptian law that is Payment Facilitation
 *      Services — a licensed activity (EGP 10–30m paid-up capital, Egyptian
 *      joint-stock company, sole-purpose requirement) with NO commercial-agent
 *      exemption. §8. This is a licensing question, not an engineering one.
 *   2. A REAL CLEARING DELAY. Card chargebacks create post-payout exposure that
 *      System 1 does not have. §4's "largely no" becomes "yes, and the number
 *      matters".
 *   3. SETTLEMENT TIMING. Paymob Accept settles WEEKLY, so clearance must gate
 *      on confirmed receipt, not on the capture timestamp, or the platform funds
 *      payouts from working capital (attack A10).
 *   4. VOLUME. System 1 is tens of payouts per quarter. System 2 is per-centre,
 *      per-cycle, continuously.
 *
 * The `ledger_accounts.kind` enum in the migration proposal deliberately has NO
 * `tuition_held` / `parent_float` account. Adding one is the moment System 2
 * starts, and it must not happen by accident.
 */
export const SYSTEM_2_OUT_OF_SCOPE = true as const;
