// src/lib/billingLockout.ts
//
// The single-day lockout SCHEDULER (Job 3, Part 2). Pure orchestration: given the
// current Cairo wall-clock and a centre's per-day ledger state, it decides which
// actions are due on THIS tick. No DB, no network, no clock reads inside — every
// input is passed in, so it is fully unit-testable and DST-safe by construction.
//
// The policy for a centre whose billing day is today and is still unpaid:
//   1. 00:00 Cairo   invoice fires + first WhatsApp nudge (once).
//   2. tunable times  same-Cairo-day card retries, capped at maxAttempts, only
//                     while unpaid and no retry has yet succeeded.
//   3. 17:00 Cairo    second WhatsApp reminder, once, only if still unpaid AND no
//                     retry succeeded (it must NOT send if a retry cleared the bill).
//   4. 23:59 Cairo    lock: teachers drop to the free tier keeping data, the centre
//                     is paywalled. Under the single-day model the access lock then
//                     engages from the next Cairo midnight (billingLifecycle rule 3).
//
// DST edges are handled by the ledger, not by clock arithmetic: on spring-forward
// 00:00 does not exist, so the first tick that DOES occur (say 01:00) still sees
// invoiceNudge undone and fires it; on fall-back the 23:00 hour repeats, but the
// `done.lock` / `done.reminder2` guards make every one-shot action fire exactly
// once per Cairo day. Retries fire at most one per tick.
//
// This scheduler NEVER decides whether the policy may run — that is the interlock /
// HELD / kill-switch gate in billingLockoutPolicy.ts, which the cron checks first
// and which hard-stops before any centre is ever touched.

import { parseHhMm } from '@/lib/billingLockoutPolicy';

/** Default Cairo wall-clock time the lock evaluates at (23:59, "11:59 PM"). */
export const DEFAULT_LOCK_TIME_CAIRO = '23:59';

export function hhmmToMinutes(value: string, fallback: number): number {
  const p = parseHhMm(value);
  return p ? p.hour * 60 + p.minute : fallback;
}

export interface LockoutLedger {
  /** The first invoice + nudge has already fired today. */
  invoiceNudge: boolean;
  /** The second (17:00) reminder has already fired today. */
  reminder2: boolean;
  /** The 23:59 lock has already been applied today. */
  lock: boolean;
}

export interface LockoutCenterState {
  /** Still unpaid for the current cycle. Paying flips this and stops everything. */
  unpaid: boolean;
  /** Same-day card charge attempts already made. */
  attemptsMade: number;
  /** A same-day retry has already succeeded (suppresses the 2nd reminder). */
  hadSuccessfulRetry: boolean;
  /** One-shot actions already fired today (idempotency ledger). */
  done: LockoutLedger;
}

export type LockoutAction =
  | { kind: 'invoice_nudge' }
  | { kind: 'retry'; attemptIndex: number }
  | { kind: 'reminder2' }
  | { kind: 'lock' };

export interface LockoutTickConfig {
  /** Cairo local minutes-of-day the retries fire at, ascending. */
  retryTimesMins: number[];
  /** Cairo local minutes-of-day the second reminder fires at. */
  reminderMins: number;
  /** Cairo local minutes-of-day the lock evaluates at (default 23:59). */
  lockMins: number;
  /** Hard cap on same-day attempts (subscription_dunning_max_attempts). */
  maxAttempts: number;
}

/**
 * Decide the actions due on this tick. `nowMins` is the Cairo wall-clock
 * minutes-of-day. The caller supplies the centre's ledger + state; this function
 * is otherwise pure.
 */
export function decideLockoutActions(input: {
  nowMins: number;
  config: LockoutTickConfig;
  state: LockoutCenterState;
}): LockoutAction[] {
  const { nowMins, config, state } = input;
  const actions: LockoutAction[] = [];

  // 1. Invoice + first nudge. Anchored at 00:00, so due on every tick of the day;
  //    the ledger makes it fire exactly once (this also covers the spring-forward
  //    day where 00:00 itself never occurs).
  if (!state.done.invoiceNudge) actions.push({ kind: 'invoice_nudge' });

  // Paid → nothing further. Paying restores access instantly elsewhere.
  if (!state.unpaid) return actions;

  // 2. Same-day card retries: at most one per tick, in time order, capped.
  const cappedRetries = config.retryTimesMins.slice(0, config.maxAttempts);
  if (
    !state.hadSuccessfulRetry &&
    state.attemptsMade < cappedRetries.length &&
    nowMins >= cappedRetries[state.attemptsMade]!
  ) {
    actions.push({ kind: 'retry', attemptIndex: state.attemptsMade });
  }

  // 3. Second reminder: once, at/after 17:00, only if unpaid AND no retry cleared it.
  if (!state.done.reminder2 && !state.hadSuccessfulRetry && nowMins >= config.reminderMins) {
    actions.push({ kind: 'reminder2' });
  }

  // 4. Lock: once, at/after 23:59, only while still unpaid.
  if (!state.done.lock && nowMins >= config.lockMins) {
    actions.push({ kind: 'lock' });
  }

  return actions;
}

/** One centre due its lockout day today (billing day == today Cairo, unpaid-or-just-paid). */
export interface DueLockoutCenter {
  centerId: string;
  /** Cairo calendar date (YYYY-MM-DD) that is this centre's billing day (== today). */
  billingDayCairo: string;
  /** Live per-cycle state read at tick time. */
  state: LockoutCenterState;
  // Adapter passthrough (the engine ignores these; the Supabase adapter uses them
  // to charge and to address the WhatsApp nudge).
  amountEgp?: number;
  ownerPhone?: string | null;
  /** Period key for the idempotency key, e.g. '2026-07'. */
  periodKey?: string;
  hasSavedCard?: boolean;
}

export interface LockoutTickAdapter {
  /** Cairo calendar date (YYYY-MM-DD) for "now". */
  todayCairo(): string;
  /** Cairo wall-clock minutes-of-day for "now" (DST-aware). */
  nowMinsCairo(): number;
  /** Centres whose billing day is today, with their per-day ledger + state folded in. */
  listDueCenters(todayCairo: string): Promise<DueLockoutCenter[]>;
  /** Charge the saved card. Returns whether it settled the bill this attempt. */
  applyRetry(center: DueLockoutCenter, attemptIndex: number): Promise<{ succeeded: boolean }>;
  /** Create/confirm the invoice for the cycle and send the first WhatsApp nudge. */
  applyInvoiceNudge(center: DueLockoutCenter): Promise<void>;
  /** Send the second (17:00) WhatsApp reminder. */
  applyReminder2(center: DueLockoutCenter): Promise<void>;
  /** Apply the lock: record the lock event (centre access + teacher drop are enforced live). */
  applyLock(center: DueLockoutCenter): Promise<void>;
}

export interface LockoutTickSummary {
  centersProcessed: number;
  invoiceNudges: number;
  retries: number;
  retriesSucceeded: number;
  reminders: number;
  locks: number;
  errors: number;
}

/**
 * Run one lockout tick over every due centre. Pure orchestration over the adapter,
 * exactly like runMidnightBilling: the caller (the cron) has ALREADY confirmed the
 * lockout policy is active (interlock on, first_charge_release RELEASED, kill
 * switch on) before calling this. This function never re-checks that gate.
 */
export async function runBillingLockoutTick(
  adapter: LockoutTickAdapter,
  config: LockoutTickConfig,
): Promise<LockoutTickSummary> {
  const summary: LockoutTickSummary = {
    centersProcessed: 0,
    invoiceNudges: 0,
    retries: 0,
    retriesSucceeded: 0,
    reminders: 0,
    locks: 0,
    errors: 0,
  };
  const nowMins = adapter.nowMinsCairo();
  const today = adapter.todayCairo();
  const due = await adapter.listDueCenters(today);

  for (const center of due) {
    summary.centersProcessed += 1;
    // Snapshot mutated across this centre's actions so later phases in the SAME
    // tick see the effect of earlier ones (e.g. a retry that just succeeded
    // suppresses the reminder in the same run).
    let liveState = center.state;
    const actions = decideLockoutActions({ nowMins, config, state: liveState });

    for (const action of actions) {
      try {
        if (action.kind === 'invoice_nudge') {
          await adapter.applyInvoiceNudge(center);
          summary.invoiceNudges += 1;
          liveState = { ...liveState, done: { ...liveState.done, invoiceNudge: true } };
        } else if (action.kind === 'retry') {
          summary.retries += 1;
          const { succeeded } = await adapter.applyRetry(center, action.attemptIndex);
          liveState = {
            ...liveState,
            attemptsMade: liveState.attemptsMade + 1,
            hadSuccessfulRetry: liveState.hadSuccessfulRetry || succeeded,
            unpaid: succeeded ? false : liveState.unpaid,
          };
          if (succeeded) summary.retriesSucceeded += 1;
        } else if (action.kind === 'reminder2') {
          // Re-check against the live state: a retry earlier in this same tick may
          // have cleared the bill, in which case the reminder must NOT go out.
          if (liveState.unpaid && !liveState.hadSuccessfulRetry) {
            await adapter.applyReminder2(center);
            summary.reminders += 1;
            liveState = { ...liveState, done: { ...liveState.done, reminder2: true } };
          }
        } else if (action.kind === 'lock') {
          if (liveState.unpaid) {
            await adapter.applyLock(center);
            summary.locks += 1;
            liveState = { ...liveState, done: { ...liveState.done, lock: true } };
          }
        }
      } catch (err) {
        summary.errors += 1;
        console.error('[billingLockout] action failed', center.centerId, action.kind, err);
      }
    }
  }

  return summary;
}

/** Build the tick config from the tunable knobs (strings already validated upstream). */
export function buildLockoutTickConfig(input: {
  retryTimesCairo: string[];
  reminderTimeCairo: string;
  lockTimeCairo?: string;
  maxAttempts: number;
}): LockoutTickConfig {
  const retryTimesMins = input.retryTimesCairo
    .map((t) => hhmmToMinutes(t, -1))
    .filter((m) => m >= 0)
    .sort((a, b) => a - b);
  return {
    retryTimesMins,
    reminderMins: hhmmToMinutes(input.reminderTimeCairo, 17 * 60),
    lockMins: hhmmToMinutes(input.lockTimeCairo ?? DEFAULT_LOCK_TIME_CAIRO, 23 * 60 + 59),
    maxAttempts: Math.max(0, Math.floor(input.maxAttempts)),
  };
}
