/**
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

/** Pure selection step: which fetched rows are actually releasable today. */
export function selectStaleWithdrawals(
  rows: readonly PendingWithdrawalRow[],
  todayCairoYmd: string,
  limit: number = DEFAULT_SWEEP_LIMIT,
): StaleWithdrawal[] {
  const out: StaleWithdrawal[] = [];
  for (const row of rows) {
    if (!isWithdrawalReservationStale(row.requested_at, todayCairoYmd)) continue;
    const credits = Number(row.credits_deducted ?? 0);
    // A non-positive or non-finite reservation is not something to hand to
    // cancel_reservation_atomic; flag it rather than releasing an unknown
    // amount. The row is still not swept, so it stays visible as pending.
    if (!Number.isFinite(credits) || credits <= 0) continue;
    const requestedYmd = cairoDateKey(new Date(row.requested_at as string));
    out.push({
      ...row,
      credits,
      requestedYmd,
      windowEndYmd: withdrawalWindowEndYmd(requestedYmd),
      staleOnOrAfterYmd: reservationStaleOnOrAfterYmd(requestedYmd),
    });
  }
  out.sort((a, b) => (a.requested_at ?? '').localeCompare(b.requested_at ?? ''));
  return out.slice(0, Math.max(0, limit));
}

export type SweepHooks = {
  /** Tell the centre owner. Non-fatal: a throw is caught and counted. */
  onReleased?: (row: StaleWithdrawal) => Promise<void>;
  /**
   * The status flip succeeded but cancel_reservation_atomic did not, so the
   * credits are still fenced and no further run will retry (the row is no
   * longer pending). This needs a human. Non-fatal: a throw is caught.
   */
  onReleaseFailed?: (row: StaleWithdrawal, message: string) => Promise<void>;
};

export type SweepResult = {
  todayCairoYmd: string;
  cutoffIso: string;
  candidates: number;
  stale: number;
  released: number;
  releasedCredits: number;
  alreadyHandled: number;
  releaseFailed: number;
  auditFailed: number;
};

/**
 * Release every fenced credit reservation whose withdrawal request has been
 * pending past its window plus grace.
 *
 * Safe to re-run, and the ordering is the reason. The manual admin path calls
 * `cancel_reservation_atomic` *first* and flips the status afterwards, which is
 * exactly the shape §2.2 describes: two concurrent passes both release, and
 * `credit_reserved` is decremented twice for one request — which would silently
 * free some *other* pending session's reservation (`GREATEST(0, ...)` hides the
 * underflow) and open a double-spend. This sweeper inverts it: the conditional
 * `UPDATE ... WHERE status='pending'` is the lock. Only the pass whose update
 * actually changed a row goes on to release, so a retry, an overlapping run, or
 * an admin working the queue at the same moment can never double-release. The
 * cost of the inversion is the `onReleaseFailed` case above — credits stay
 * fenced, which is the pre-existing state, not a new loss.
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
    releaseFailed: 0,
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

  const stale = selectStaleWithdrawals(rows, todayCairoYmd, limit);
  result.stale = stale.length;

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
      console.error('[sweep-withdrawal-reservations] claim', row.id, claimErr.message);
      result.releaseFailed++;
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
      result.releaseFailed++;
      try {
        await hooks.onReleaseFailed?.(row, rpcErr.message);
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
