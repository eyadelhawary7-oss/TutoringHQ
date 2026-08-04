/**
 * ===========================================================================
 * DEPENDENCY — DO NOT DEPLOY THIS SWEEPER ON ITS OWN.
 *
 * This branch requires `claude/payout-2-2-withdrawal-race` to have landed AND
 * its migration (`process_withdrawal_request`) to have been APPLIED BY HAND to
 * production first. Merged is NOT applied (CLAUDE.md rule 5, tested 15 July
 * 2026).
 *
 * Why: on origin/master `PATCH /api/admin/withdrawals/[id]` releases the
 * reservation BEFORE it flips the request status, across three un-transacted
 * round trips. For that whole span the row is still `pending`, so a sweeper
 * claim landing inside it succeeds and `cancel_reservation_atomic` is called
 * TWICE for one request. `centers.credit_reserved` is a single counter shared
 * with `combined_payment_sessions` holds, and the RPC is amount-based with a
 * `GREATEST(0, ...)` clamp, so the surplus decrement silently frees a
 * different, live hold — a double-spend window, not a harmless no-op.
 *
 * §2.2's `process_withdrawal_request()` closes that window: it takes
 * `SELECT ... FOR UPDATE` on the request row and does the release, the spend
 * and the status flip in ONE transaction, so a concurrent sweeper claim blocks
 * and then sees a non-pending status.
 *
 * The full argument is on `sweepStaleWithdrawalReservations` below; the
 * interleave is encoded as a test in
 * tests/unit/withdrawalReservationSweep.test.ts.
 * ===========================================================================
 *
 * PAYOUT-SYSTEM-SPEC.md §2.5 — credit reservations never expire.
 *
 * `POST /api/billing/withdrawal` calls `reserve_credits_atomic`, which bumps
 * `centers.credit_reserved` and writes **no** ledger row and **no** expiry.
 * The only two crons that call `cancel_reservation_atomic`
 * (`cleanup-expired-sessions`, `check-stuck-payments`) both scan
 * `combined_payment_sessions` and never look at `withdrawal_requests`. So a
 * withdrawal request that is abandoned, or that an admin never works, fences
 * the centre's credits forever: `credit_balance - credit_reserved` is what both
 * the withdrawal route and the spend path treat as available, so the money is
 * simultaneously unspendable and unwithdrawable.
 *
 * This module is the sweeper. It is deliberately dependency-free (Cairo helpers
 * only) so the age rule can be unit-tested without a database.
 *
 * ── Why the threshold is what it is ────────────────────────────────────────
 *
 * The number is derived from the withdrawal calendar, not invented:
 *
 *  1. `isWithdrawalWindowOpen()` (src/lib/cairoBillingCalendar.ts) accepts a
 *     request ONLY on days 1–14 of a quarter month (Jan/Apr/Jul/Oct), Cairo.
 *  2. `nextProcessingQuarterStart()` promises the centre that a request made
 *     inside an open window is processed **in that window**. Day 14 of the
 *     quarter month is therefore the last day on which a pending request is
 *     still legitimately waiting for its own scheduled processing.
 *  3. Past day 14 nothing scheduled will ever pick it up. The next window is a
 *     full quarter away, so a request that outlives its window sits fenced for
 *     roughly another 76 days minimum with no process that touches it.
 *  4. Grace = one further window length (14 days). That hands the operator
 *     exactly as long again, after the window closed, to work the request by
 *     hand before the platform releases the fence.
 *
 * So: `staleOnOrAfter = (day 14 of the request's quarter month) + 14 days`,
 * i.e. between 14 and 28 days of age depending on where in the window the
 * request landed. Releasing then still leaves the centre two clear months
 * before the next window opens — the credits go back to spendable and the
 * centre can simply request again. Nothing is destroyed by the release.
 *
 * ── Why this releases rather than waits, given §7.5 ────────────────────────
 *
 * §7.5 decided "no expiry on a pending request", on the grounds that silently
 * turning "waiting" into "denied" is the §2.1 failure shape. That decision
 * governs the **future unified pipeline**, where the hold is a ledger posting
 * on `center_payouts` and `requested_at` is surfaced on the centre's own view
 * so the queue ages visibly. Neither of those exists today. Today the only two
 * options are: fence the credits indefinitely, or release them loudly. This
 * sweeper releases them and makes the release the opposite of silent — an
 * `audit_log` row, a `ceo_action_queue` row, a WhatsApp to the owner, and a
 * marker on the request's own `notes`. When the unified pipeline lands, this
 * sweeper is replaced by the hold lifecycle, not extended.
 *
 * ── Why the terminal status is 'rejected' and not 'expired' ────────────────
 *
 * Verified live in `pg_constraint`: `withdrawal_requests_status_check` is
 * `CHECK (status = ANY (ARRAY['pending','paid','rejected']))`. There is no
 * 'expired' value and this branch applies no migration, so the sweeper writes
 * the one existing terminal state whose semantics already mean "credits went
 * back to the balance" — the same state the manual reject path in
 * `PATCH /api/admin/withdrawals/[id]` writes after the same RPC call. A
 * migration proposal that adds 'expired' plus a real expiry column ships
 * alongside this, unapplied.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { cairoDateKey, cairoYmdMinusDays, cairoYmdPlusDays, parseCairoYmd, startOfUtcInstantForCairoCalendarDay } from '@/lib/cairo/day';

/** Months in which the withdrawal window opens (mirrors isWithdrawalWindowOpen). */
const QUARTER_MONTHS = [1, 4, 7, 10];

/** Last day of an open withdrawal window (mirrors isWithdrawalWindowOpen). */
export const WITHDRAWAL_WINDOW_LAST_DAY = 14;

/**
 * Grace after the window closes before the fence is released: one further
 * window length. See the header — this is the only tunable, and it is tied to
 * the window, not picked.
 */
export const RESERVATION_GRACE_DAYS = WITHDRAWAL_WINDOW_LAST_DAY;

/**
 * Smallest age (in Cairo days) at which any row can possibly be stale — used
 * only to bound the database query. A request made on the window's last day
 * becomes stale exactly RESERVATION_GRACE_DAYS later; nothing younger can
 * qualify, so nothing younger is worth fetching.
 */
export const MIN_STALE_AGE_DAYS = RESERVATION_GRACE_DAYS;

/** Default cap on releases per run, so one run cannot become unbounded. */
export const DEFAULT_SWEEP_LIMIT = 200;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The last Cairo day on which a request made on `requestedYmd` is still inside
 * the window it was submitted into.
 *
 * The route only permits days 1–14 of a quarter month, so the normal answer is
 * day 14 of that month. The two defensive branches exist because the table can
 * hold rows the route did not create: if the request date is not in a quarter
 * month, or is already past day 14, the request's own date is used, which is
 * always the conservative choice (it can only push the release later, never
 * earlier).
 */
export function withdrawalWindowEndYmd(requestedYmd: string): string {
  const { y, m } = parseCairoYmd(requestedYmd);
  if (!QUARTER_MONTHS.includes(m)) return requestedYmd;
  const windowEnd = `${y}-${pad2(m)}-${pad2(WITHDRAWAL_WINDOW_LAST_DAY)}`;
  return windowEnd > requestedYmd ? windowEnd : requestedYmd;
}

/** First Cairo day on which the reservation for `requestedYmd` may be released. */
export function reservationStaleOnOrAfterYmd(requestedYmd: string): string {
  return cairoYmdPlusDays(withdrawalWindowEndYmd(requestedYmd), RESERVATION_GRACE_DAYS);
}

/**
 * Is the reservation behind a request made at `requestedAt` releasable as of
 * the Cairo day `todayCairoYmd`? YYYY-MM-DD compares correctly as a string.
 */
export function isWithdrawalReservationStale(
  requestedAt: string | Date | null | undefined,
  todayCairoYmd: string,
): boolean {
  if (!requestedAt) return false;
  const d = requestedAt instanceof Date ? requestedAt : new Date(requestedAt);
  if (Number.isNaN(d.getTime())) return false;
  return todayCairoYmd >= reservationStaleOnOrAfterYmd(cairoDateKey(d));
}

/**
 * Upper bound for the `requested_at` filter: the first UTC instant of the Cairo
 * day `today - (MIN_STALE_AGE_DAYS - 1)`. Every row at or after this instant is
 * strictly younger than MIN_STALE_AGE_DAYS Cairo days and therefore cannot be
 * stale. Cairo-anchored on purpose — no `new Date()` arithmetic decides a
 * billing-calendar boundary here.
 */
export function staleCandidateCutoffIso(todayCairoYmd: string): string {
  const cutoffYmd = cairoYmdMinusDays(todayCairoYmd, MIN_STALE_AGE_DAYS - 1);
  return startOfUtcInstantForCairoCalendarDay(cutoffYmd).toISOString();
}

export type PendingWithdrawalRow = {
  id: string;
  center_id: string;
  credits_deducted: number | string | null;
  cash_amount: number | string | null;
  requested_at: string | null;
  notes: string | null;
};

export type StaleWithdrawal = PendingWithdrawalRow & {
  requestedYmd: string;
  windowEndYmd: string;
  staleOnOrAfterYmd: string;
  credits: number;
};

/**
 * A stale row whose `credits_deducted` cannot be handed to
 * `cancel_reservation_atomic` — non-positive, or not a finite number.
 *
 * This is reachable, not theoretical: the live CHECK is
 * `withdrawal_requests_money_nonneg`, which is `credits_deducted >= 0`, so a
 * 0-credit pending row is perfectly insertable (verified in pg_constraint).
 */
export type InvalidCreditWithdrawal = PendingWithdrawalRow & {
  requestedYmd: string;
  /** The value as stored, before Number() — kept for the operator's log line. */
  rawCredits: number | string | null;
};

export type StaleSelection = {
  /** Releasable today, oldest first, capped at `limit`. */
  stale: StaleWithdrawal[];
  /**
   * Stale by age but unusable. NOT capped by `limit`: these are never handed
   * to the RPC, they are only counted and logged, and leaving them out of the
   * report is exactly the silence this field exists to end.
   */
  invalidCredits: InvalidCreditWithdrawal[];
};

/**
 * Pure selection step: which fetched rows are actually releasable today, and
 * which are stale but unusable.
 *
 * The unusable ones are returned rather than dropped. They used to be a bare
 * `continue`: such a row is re-fetched and re-skipped every single run,
 * forever, fencing its centre's credits with no counter, no log line and no
 * hook anywhere to say so. The caller now counts them, logs each one, and can
 * escalate them.
 */
export function selectStaleWithdrawals(
  rows: readonly PendingWithdrawalRow[],
  todayCairoYmd: string,
  limit: number = DEFAULT_SWEEP_LIMIT,
): StaleSelection {
  const out: StaleWithdrawal[] = [];
  const invalidCredits: InvalidCreditWithdrawal[] = [];
  for (const row of rows) {
    if (!isWithdrawalReservationStale(row.requested_at, todayCairoYmd)) continue;
    const requestedYmd = cairoDateKey(new Date(row.requested_at as string));
    const credits = Number(row.credits_deducted ?? 0);
    if (!Number.isFinite(credits) || credits <= 0) {
      // Releasing an unknown or non-positive amount would corrupt the shared
      // credit_reserved counter, so the row is not swept — but it IS reported.
      invalidCredits.push({ ...row, requestedYmd, rawCredits: row.credits_deducted });
      continue;
    }
    out.push({
      ...row,
      credits,
      requestedYmd,
      windowEndYmd: withdrawalWindowEndYmd(requestedYmd),
      staleOnOrAfterYmd: reservationStaleOnOrAfterYmd(requestedYmd),
    });
  }
  out.sort((a, b) => (a.requested_at ?? '').localeCompare(b.requested_at ?? ''));
  invalidCredits.sort((a, b) => (a.requested_at ?? '').localeCompare(b.requested_at ?? ''));
  return { stale: out.slice(0, Math.max(0, limit)), invalidCredits };
}

export type SweepHooks = {
  /** Tell the centre owner. Non-fatal: a throw is caught and counted. */
  onReleased?: (row: StaleWithdrawal) => Promise<void>;
  /**
   * The claim UPDATE itself errored, so nothing was written at all: the row is
   * untouched, still `pending`, still reachable by the admin path, and the
   * next run retries it. Benign and retryable — deliberately NOT the same
   * signal as a stranded fence. Non-fatal: a throw is caught.
   */
  onClaimFailed?: (row: StaleWithdrawal, message: string) => Promise<void>;
  /**
   * The claim succeeded, `cancel_reservation_atomic` failed, and the claim was
   * successfully REVERTED to `pending`. The credits are still fenced — which is
   * the pre-existing state — but the request is back within reach of both the
   * next sweep run and `PATCH /api/admin/withdrawals/[id]`. Retryable.
   * Non-fatal: a throw is caught.
   */
  onReleaseDeferred?: (row: StaleWithdrawal, message: string) => Promise<void>;
  /**
   * The genuinely stranded case, and the only one that warrants a red flag:
   * the RPC failed AND the revert to `pending` also failed. The row now sits
   * in a terminal status with its reservation un-released, which puts it out
   * of reach of the admin path (that route refuses any row that is not
   * `pending`). No automated path will ever free this fence. Needs a human.
   * Non-fatal: a throw is caught.
   */
  onReleaseFailed?: (row: StaleWithdrawal, message: string) => Promise<void>;
  /**
   * A row that is stale by age but whose `credits_deducted` is non-positive or
   * non-finite, so no amount can safely be handed to the RPC. Never swept;
   * without this it would be re-skipped in silence every run forever.
   * Non-fatal: a throw is caught.
   */
  onInvalidCredits?: (row: InvalidCreditWithdrawal) => Promise<void>;
};

export type SweepResult = {
  todayCairoYmd: string;
  cutoffIso: string;
  candidates: number;
  stale: number;
  released: number;
  releasedCredits: number;
  alreadyHandled: number;
  /**
   * Claim UPDATE errored; row untouched and still pending. Retryable.
   * Separate from `releaseFailed` on purpose: these two used to share one
   * counter, which made it impossible to tell from `cron_log.metadata` whether
   * a run had hit a transient DB blip or had stranded somebody's money.
   */
  claimFailed: number;
  /** RPC failed, claim reverted to pending. Still fenced, still retryable. */
  releaseDeferred: number;
  /** RPC failed AND the revert failed. Fence stranded out of reach. Red. */
  releaseFailed: number;
  /** Stale rows skipped because `credits_deducted` was unusable. */
  invalidCredits: number;
  auditFailed: number;
};

/**
 * Release every fenced credit reservation whose withdrawal request has been
 * pending past its window plus grace.
 *
 * ── What the claim-first ordering buys, and what it does NOT ───────────────
 *
 * The conditional `UPDATE ... WHERE status='pending'` is a compare-and-swap:
 * only the caller whose update actually changed a row goes on to call
 * `cancel_reservation_atomic`. That is a real guarantee against exactly one
 * thing — ANOTHER PASS OF THIS SWEEPER. A retry, an overlapping cron
 * invocation, a manual re-run: all of them serialise on the row, the loser
 * sees zero rows changed and stops before the RPC.
 *
 * It does NOT make this sweeper immune to the admin path, and an earlier
 * version of this comment claimed that it did. That claim was false and is
 * retracted. On origin/master `PATCH /api/admin/withdrawals/[id]` calls
 * `cancel_reservation_atomic` FIRST (route.ts:84 for mark_paid, :150 for
 * reject) and flips the status only afterwards (:106 / :160), in three
 * separate un-transacted round trips. Across the whole span
 * admin-cancel-RPC → spend_credits_atomic → status-flip the row is still
 * `pending`, so a sweeper claim landing in that span SUCCEEDS, and one request
 * gets TWO `cancel_reservation_atomic` calls.
 *
 * That surplus decrement is not absorbed harmlessly. `centers.credit_reserved`
 * is one shared counter — `cleanup-expired-sessions` and `check-stuck-payments`
 * decrement the same column for `combined_payment_sessions` holds (verified
 * live). The RPC is amount-based rather than request-based and clamps with
 * `GREATEST(0, ...)`, so the extra release neither errors nor underflows
 * visibly: it quietly frees somebody else's live hold.
 *
 * This is why the file header makes the branch dependent on
 * `claude/payout-2-2-withdrawal-race` landing AND its migration being applied
 * by hand first. §2.2's `process_withdrawal_request()` performs the release,
 * the spend and the status flip in one transaction behind
 * `SELECT ... FOR UPDATE`, so the concurrent claim blocks and then sees a
 * non-pending status. Until that is applied, the window above is open.
 *
 * ── On RPC failure the claim is REVERTED ───────────────────────────────────
 *
 * If the claim succeeds but the RPC fails, the row is put back to `pending`,
 * `processed_at` is cleared, and the release marker is replaced by a failure
 * marker. This matters because the admin route refuses any row whose status is
 * not `pending` (route.ts:67), so leaving the row `rejected` would push the
 * fence out of reach of the one existing path that can free it. Reverting
 * restores the pre-existing state exactly — fenced AND manually releasable —
 * and lets the next run retry. Only if the revert ITSELF fails is the fence
 * genuinely stranded, and only then does the red `onReleaseFailed` fire.
 */
export async function sweepStaleWithdrawalReservations(
  supabase: SupabaseClient,
  opts: { now?: Date; limit?: number; hooks?: SweepHooks } = {},
): Promise<SweepResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? DEFAULT_SWEEP_LIMIT;
  const hooks = opts.hooks ?? {};

  const todayCairoYmd = cairoDateKey(now);
  const cutoffIso = staleCandidateCutoffIso(todayCairoYmd);

  const result: SweepResult = {
    todayCairoYmd,
    cutoffIso,
    candidates: 0,
    stale: 0,
    released: 0,
    releasedCredits: 0,
    alreadyHandled: 0,
    claimFailed: 0,
    releaseDeferred: 0,
    releaseFailed: 0,
    invalidCredits: 0,
    auditFailed: 0,
  };

  const { data, error } = await supabase
    .from('withdrawal_requests')
    .select('id, center_id, credits_deducted, cash_amount, requested_at, notes')
    .eq('status', 'pending')
    .lt('requested_at', cutoffIso)
    .order('requested_at', { ascending: true })
    .limit(limit * 2);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as PendingWithdrawalRow[];
  result.candidates = rows.length;

  const { stale, invalidCredits } = selectStaleWithdrawals(rows, todayCairoYmd, limit);
  result.stale = stale.length;
  result.invalidCredits = invalidCredits.length;

  // Stale but unusable. These are NOT swept, and without this loop they would
  // be re-skipped in silence on every run for the life of the row.
  for (const bad of invalidCredits) {
    console.error(
      '[sweep-withdrawal-reservations] unusable credits_deducted, row skipped and still fenced',
      bad.id,
      `center=${bad.center_id}`,
      `requested=${bad.requestedYmd}`,
      `credits_deducted=${JSON.stringify(bad.rawCredits)}`,
    );
    try {
      await hooks.onInvalidCredits?.(bad);
    } catch (hookErr) {
      console.error('[sweep-withdrawal-reservations] onInvalidCredits hook', bad.id, hookErr);
    }
  }

  for (const row of stale) {
    const marker =
      `[auto] reservation released by sweep-withdrawal-reservations on ${todayCairoYmd}: ` +
      `requested ${row.requestedYmd}, quarterly window closed ${row.windowEndYmd}, ` +
      `unprocessed past the ${RESERVATION_GRACE_DAYS}-day grace. Credits returned to the balance.`;
    const existing = (row.notes ?? '').trim();
    const notes = existing ? `${existing}\n${marker}` : marker;

    // Claim the row first — see the ordering note above.
    const { data: claimed, error: claimErr } = await supabase
      .from('withdrawal_requests')
      .update({ status: 'rejected', processed_at: now.toISOString(), notes })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id');

    if (claimErr) {
      // Nothing was written: the row is untouched, still pending, still
      // admin-reachable, and the next run retries it. Benign and retryable —
      // counted and signalled separately from a stranded fence so that
      // cron_log.metadata can tell the two apart.
      console.error('[sweep-withdrawal-reservations] claim', row.id, claimErr.message);
      result.claimFailed++;
      try {
        await hooks.onClaimFailed?.(row, claimErr.message);
      } catch (hookErr) {
        console.error('[sweep-withdrawal-reservations] onClaimFailed hook', row.id, hookErr);
      }
      continue;
    }
    if (!claimed || claimed.length === 0) {
      // Someone else (an admin, or an overlapping run) got there first.
      result.alreadyHandled++;
      continue;
    }

    const { error: rpcErr } = await supabase.rpc('cancel_reservation_atomic', {
      p_center_id: row.center_id,
      p_amount: row.credits,
    });

    if (rpcErr) {
      console.error('[sweep-withdrawal-reservations] cancel_reservation_atomic', row.id, rpcErr.message);

      // REVERT THE CLAIM. The reservation was not released, so the row must go
      // back to being what it was a moment ago: pending, un-processed, and
      // therefore workable by `PATCH /api/admin/withdrawals/[id]` — the only
      // existing path that can free this fence, and one that refuses any row
      // whose status is not 'pending'. Leaving it 'rejected' would strand the
      // credits permanently.
      const failMarker =
        `[auto] sweep-withdrawal-reservations tried to release this reservation on ${todayCairoYmd} ` +
        `and cancel_reservation_atomic failed (${rpcErr.message.slice(0, 200)}). The status flip was ` +
        `reverted to pending: the credits are still fenced, and the request is still workable by hand ` +
        `and will be retried on the next run.`;
      const revertNotes = existing ? `${existing}\n${failMarker}` : failMarker;

      const { data: reverted, error: revertErr } = await supabase
        .from('withdrawal_requests')
        .update({ status: 'pending', processed_at: null, notes: revertNotes })
        .eq('id', row.id)
        // Only undo the claim this run made; never resurrect a row somebody
        // else moved on in the meantime.
        .eq('status', 'rejected')
        .select('id');

      if (!revertErr && reverted && reverted.length > 0) {
        result.releaseDeferred++;
        try {
          await hooks.onReleaseDeferred?.(row, rpcErr.message);
        } catch (hookErr) {
          console.error('[sweep-withdrawal-reservations] onReleaseDeferred hook', row.id, hookErr);
        }
        continue;
      }

      // The revert itself failed. THIS is the genuinely stranded case: a
      // terminal status with the reservation still held, out of reach of both
      // this sweeper and the admin route. Only now does the red flag fire.
      const revertMessage = revertErr
        ? revertErr.message
        : 'revert matched no row (status was no longer "rejected")';
      console.error(
        '[sweep-withdrawal-reservations] STRANDED: revert after RPC failure failed',
        row.id,
        revertMessage,
      );
      result.releaseFailed++;
      try {
        await hooks.onReleaseFailed?.(
          row,
          `cancel_reservation_atomic failed (${rpcErr.message}); revert to pending also failed (${revertMessage})`,
        );
      } catch (hookErr) {
        console.error('[sweep-withdrawal-reservations] onReleaseFailed hook', row.id, hookErr);
      }
      continue;
    }

    result.released++;
    result.releasedCredits += row.credits;

    // Audit trail. supabase-js RETURNS {error} rather than throwing, so the
    // `try { ... } catch {}` pattern used at 33 other call sites drops the
    // failure without even logging it (§7.4). Check the error explicitly.
    const { error: auditErr } = await supabase.from('audit_log').insert({
      center_id: row.center_id,
      user_id: null,
      action: 'withdrawal_reservation_released',
      entity_type: 'withdrawal_request',
      entity_id: row.id,
      details: {
        source: 'cron:sweep-withdrawal-reservations',
        spec: 'PAYOUT-SYSTEM-SPEC.md#2.5',
        credits_released: row.credits,
        cash_amount: Number(row.cash_amount ?? 0),
        requested_cairo_date: row.requestedYmd,
        window_end_cairo_date: row.windowEndYmd,
        stale_on_or_after_cairo_date: row.staleOnOrAfterYmd,
        released_cairo_date: todayCairoYmd,
        grace_days: RESERVATION_GRACE_DAYS,
        new_status: 'rejected',
      },
    });

    if (auditErr) {
      console.error('[sweep-withdrawal-reservations] audit_log', row.id, auditErr.message);
      result.auditFailed++;
    }

    try {
      await hooks.onReleased?.(row);
    } catch (hookErr) {
      console.error('[sweep-withdrawal-reservations] onReleased hook', row.id, hookErr);
    }
  }

  return result;
}
