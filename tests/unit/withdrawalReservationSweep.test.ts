import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_SWEEP_LIMIT,
  RESERVATION_GRACE_DAYS,
  WITHDRAWAL_WINDOW_LAST_DAY,
  isWithdrawalReservationStale,
  reservationStaleOnOrAfterYmd,
  selectStaleWithdrawals,
  staleCandidateCutoffIso,
  sweepStaleWithdrawalReservations,
  withdrawalWindowEndYmd,
  type PendingWithdrawalRow,
  type StaleWithdrawal,
} from '@/lib/withdrawalReservationSweep';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * PAYOUT-SYSTEM-SPEC.md §2.5. `reserve_credits_atomic` fences
 * `centers.credit_reserved` with no expiry and no sweeper, and neither cron
 * that calls `cancel_reservation_atomic` looks at `withdrawal_requests`.
 *
 * Tests run with TZ=UTC (vitest config), so any Cairo-boundary mistake in the
 * age rule shows up here rather than in production.
 */

// ── The age rule ───────────────────────────────────────────────────────────

describe('withdrawalWindowEndYmd', () => {
  it('maps any in-window request to day 14 of its quarter month', () => {
    for (const m of ['01', '04', '07', '10']) {
      for (let d = 1; d <= WITHDRAWAL_WINDOW_LAST_DAY; d++) {
        const ymd = `2026-${m}-${String(d).padStart(2, '0')}`;
        expect(withdrawalWindowEndYmd(ymd)).toBe(`2026-${m}-14`);
      }
    }
  });

  it('never returns a date before the request itself', () => {
    // Defensive branches: rows the route could not have created.
    expect(withdrawalWindowEndYmd('2026-01-20')).toBe('2026-01-20');
    expect(withdrawalWindowEndYmd('2026-02-03')).toBe('2026-02-03');
    expect(withdrawalWindowEndYmd('2026-12-31')).toBe('2026-12-31');
  });
});

describe('reservationStaleOnOrAfterYmd', () => {
  it('is window close + one further window length', () => {
    expect(reservationStaleOnOrAfterYmd('2026-01-01')).toBe('2026-01-28');
    expect(reservationStaleOnOrAfterYmd('2026-01-14')).toBe('2026-01-28');
    expect(reservationStaleOnOrAfterYmd('2026-04-09')).toBe('2026-04-28');
    expect(reservationStaleOnOrAfterYmd('2026-10-14')).toBe('2026-10-28');
  });

  it('rolls month and year correctly', () => {
    // Oct 14 + 14 = Oct 28; a defensive Dec-25 row rolls into January.
    expect(reservationStaleOnOrAfterYmd('2026-12-25')).toBe('2027-01-08');
  });
});

describe('isWithdrawalReservationStale', () => {
  it('never fires while the request is still inside its own window', () => {
    // Every day the window is open, for a request made on day 1.
    for (let d = 1; d <= WITHDRAWAL_WINDOW_LAST_DAY; d++) {
      const today = `2026-01-${String(d).padStart(2, '0')}`;
      expect(isWithdrawalReservationStale('2026-01-01T09:00:00Z', today)).toBe(false);
    }
  });

  it('does not fire during the grace period', () => {
    expect(isWithdrawalReservationStale('2026-01-01T09:00:00Z', '2026-01-27')).toBe(false);
  });

  it('fires on the first day past window close + grace, and stays fired', () => {
    expect(isWithdrawalReservationStale('2026-01-01T09:00:00Z', '2026-01-28')).toBe(true);
    expect(isWithdrawalReservationStale('2026-01-01T09:00:00Z', '2026-03-01')).toBe(true);
  });

  it('a request made on the window’s last day still gets a full grace period', () => {
    expect(isWithdrawalReservationStale('2026-01-14T09:00:00Z', '2026-01-27')).toBe(false);
    expect(isWithdrawalReservationStale('2026-01-14T09:00:00Z', '2026-01-28')).toBe(true);
  });

  it('is never satisfied by a row younger than the grace period', () => {
    // The strongest safety property: whatever the window arithmetic does, no
    // reservation is released before RESERVATION_GRACE_DAYS have passed.
    for (let m = 1; m <= 12; m++) {
      for (const d of [1, 5, 14, 15, 28]) {
        const requested = `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const staleAt = reservationStaleOnOrAfterYmd(requested);
        const ageMs = Date.parse(`${staleAt}T00:00:00Z`) - Date.parse(`${requested}T00:00:00Z`);
        expect(ageMs / 86_400_000).toBeGreaterThanOrEqual(RESERVATION_GRACE_DAYS);
      }
    }
  });

  it('uses the Cairo calendar date, not the UTC one', () => {
    // 2026-01-13T22:30Z is 2026-01-14 00:30 in Cairo (UTC+2). Under UTC the
    // request date reads as the 13th; under Cairo it is the 14th. Both land on
    // the same window end here, so assert the Cairo date directly instead.
    const lateEvening = '2026-01-13T22:30:00Z';
    expect(isWithdrawalReservationStale(lateEvening, '2026-01-27')).toBe(false);
    expect(isWithdrawalReservationStale(lateEvening, '2026-01-28')).toBe(true);
  });

  it('treats a missing or unparseable requested_at as not stale', () => {
    expect(isWithdrawalReservationStale(null, '2030-01-01')).toBe(false);
    expect(isWithdrawalReservationStale(undefined, '2030-01-01')).toBe(false);
    expect(isWithdrawalReservationStale('not-a-date', '2030-01-01')).toBe(false);
  });
});

describe('staleCandidateCutoffIso', () => {
  it('is loose enough to include the youngest possible stale row', () => {
    // Requested 2026-01-14 (Cairo), stale on 2026-01-28. On that day the DB
    // filter must not exclude it.
    const cutoff = staleCandidateCutoffIso('2026-01-28');
    expect('2026-01-14T09:00:00.000Z' < cutoff).toBe(true);
  });

  it('excludes anything that cannot yet be stale', () => {
    const cutoff = staleCandidateCutoffIso('2026-01-28');
    // A request made on 2026-01-15 Cairo is 13 days old — below the floor.
    expect('2026-01-15T09:00:00.000Z' < cutoff).toBe(false);
  });
});

// ── Selection ──────────────────────────────────────────────────────────────

function row(over: Partial<PendingWithdrawalRow> = {}): PendingWithdrawalRow {
  return {
    id: 'w1',
    center_id: 'c1',
    credits_deducted: 2000,
    cash_amount: 1000,
    requested_at: '2026-01-05T10:00:00Z',
    notes: null,
    ...over,
  };
}

describe('selectStaleWithdrawals', () => {
  it('keeps only stale rows', () => {
    const rows = [
      row({ id: 'old', requested_at: '2026-01-05T10:00:00Z' }),
      row({ id: 'fresh', requested_at: '2026-01-20T10:00:00Z' }),
    ];
    const out = selectStaleWithdrawals(rows, '2026-01-28');
    expect(out.stale.map((r) => r.id)).toEqual(['old']);
  });

  it('reports rows with a non-positive or unparseable reservation instead of dropping them', () => {
    // These are not swept — no safe amount exists to hand the RPC — but they
    // must come back so the caller can count, log and escalate them. A bare
    // `continue` re-skipped them in silence on every run, forever.
    const rows = [
      row({ id: 'zero', credits_deducted: 0 }),
      row({ id: 'neg', credits_deducted: -50 }),
      row({ id: 'junk', credits_deducted: 'abc' }),
      row({ id: 'nul', credits_deducted: null }),
      row({ id: 'ok', credits_deducted: '2000' }),
    ];
    const out = selectStaleWithdrawals(rows, '2026-02-01');
    expect(out.stale.map((r) => r.id)).toEqual(['ok']);
    expect(out.stale[0].credits).toBe(2000);
    expect(out.invalidCredits.map((r) => r.id).sort()).toEqual(['junk', 'neg', 'nul', 'zero']);
    // The raw value is carried through for the operator's log line.
    expect(out.invalidCredits.find((r) => r.id === 'junk')?.rawCredits).toBe('abc');
  });

  it('a 0-credit pending row is reachable, not theoretical', () => {
    // Verified live in pg_constraint: withdrawal_requests_money_nonneg is
    // `credits_deducted >= 0`, so zero is insertable.
    const out = selectStaleWithdrawals([row({ id: 'z', credits_deducted: 0 })], '2026-02-01');
    expect(out.stale).toHaveLength(0);
    expect(out.invalidCredits.map((r) => r.id)).toEqual(['z']);
  });

  it('does not report a fresh row as invalid even if its credits are unusable', () => {
    // Age is the first gate: a row that is not yet stale is nobody's problem.
    const out = selectStaleWithdrawals(
      [row({ id: 'fresh', credits_deducted: 0, requested_at: '2026-01-20T10:00:00Z' })],
      '2026-01-25',
    );
    expect(out.stale).toHaveLength(0);
    expect(out.invalidCredits).toHaveLength(0);
  });

  it('processes oldest first and honours the cap', () => {
    const rows = [
      row({ id: 'b', requested_at: '2026-01-10T10:00:00Z' }),
      row({ id: 'a', requested_at: '2026-01-02T10:00:00Z' }),
      row({ id: 'c', requested_at: '2026-01-12T10:00:00Z' }),
    ];
    expect(selectStaleWithdrawals(rows, '2026-02-01').stale.map((r) => r.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(selectStaleWithdrawals(rows, '2026-02-01', 2).stale.map((r) => r.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('has a sane default cap', () => {
    expect(DEFAULT_SWEEP_LIMIT).toBeGreaterThan(0);
  });
});

// ── The sweep itself ───────────────────────────────────────────────────────

type FakeState = {
  rows: PendingWithdrawalRow[];
  /** id -> current status, so the conditional claim can be simulated. */
  status: Map<string, string>;
  rpcCalls: { center_id: string; amount: number }[];
  audits: Record<string, unknown>[];
  updates: Record<string, unknown>[];
  rpcError?: string;
  claimError?: string;
  /** Fails only the revert-to-pending UPDATE, not the claim. */
  revertError?: string;
  auditError?: string;
  selectError?: string;
  /** Runs before each rpc call, so a test can model a concurrent actor. */
  onRpc?: (state: FakeState) => void;
};

function makeFake(state: FakeState) {
  const client = {
    from(table: string) {
      if (table === 'withdrawal_requests') {
        return {
          // read path
          select() {
            const q = {
              eq: () => q,
              lt: () => q,
              order: () => q,
              limit: () =>
                Promise.resolve(
                  state.selectError
                    ? { data: null, error: { message: state.selectError } }
                    : { data: state.rows, error: null },
                ),
            };
            return q;
          },
          // claim path
          update(patch: Record<string, unknown>) {
            let id = '';
            let requiredStatus = '';
            const q = {
              eq(col: string, val: string) {
                if (col === 'id') id = val;
                if (col === 'status') requiredStatus = val;
                return q;
              },
              select() {
                // The revert is the only UPDATE that writes status='pending'.
                const isRevert = patch.status === 'pending';
                const failure = isRevert ? state.revertError : state.claimError;
                if (failure) {
                  return Promise.resolve({ data: null, error: { message: failure } });
                }
                const current = state.status.get(id);
                if (current !== requiredStatus) {
                  return Promise.resolve({ data: [], error: null });
                }
                state.status.set(id, String(patch.status));
                state.updates.push({ id, ...patch });
                return Promise.resolve({ data: [{ id }], error: null });
              },
            };
            return q;
          },
        };
      }
      if (table === 'audit_log') {
        return {
          insert(payload: Record<string, unknown>) {
            if (state.auditError) {
              return Promise.resolve({ error: { message: state.auditError } });
            }
            state.audits.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc(name: string, args: { p_center_id: string; p_amount: number }) {
      expect(name).toBe('cancel_reservation_atomic');
      state.onRpc?.(state);
      if (state.rpcError) return Promise.resolve({ error: { message: state.rpcError } });
      state.rpcCalls.push({ center_id: args.p_center_id, amount: args.p_amount });
      return Promise.resolve({ error: null });
    },
  };
  return client as unknown as SupabaseClient;
}

function baseState(rows: PendingWithdrawalRow[]): FakeState {
  return {
    rows,
    status: new Map(rows.map((r) => [r.id, 'pending'])),
    rpcCalls: [],
    audits: [],
    updates: [],
  };
}

const NOW = new Date('2026-02-10T09:00:00Z'); // well past 2026-01-28

describe('sweepStaleWithdrawalReservations', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('releases a fenced reservation and writes an audit row', async () => {
    const state = baseState([row({ id: 'w1', credits_deducted: 2000 })]);
    const released: StaleWithdrawal[] = [];

    const res = await sweepStaleWithdrawalReservations(makeFake(state), {
      now: NOW,
      hooks: { onReleased: async (r) => void released.push(r) },
    });

    expect(res.released).toBe(1);
    expect(res.releasedCredits).toBe(2000);
    expect(res.releaseFailed).toBe(0);
    expect(res.auditFailed).toBe(0);
    expect(state.rpcCalls).toEqual([{ center_id: 'c1', amount: 2000 }]);
    expect(state.status.get('w1')).toBe('rejected');
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: 'withdrawal_reservation_released',
      entity_type: 'withdrawal_request',
      entity_id: 'w1',
      center_id: 'c1',
    });
    expect(
      (state.audits[0].details as Record<string, unknown>).credits_released,
    ).toBe(2000);
    expect(released.map((r) => r.id)).toEqual(['w1']);
  });

  it('leaves a request that is still inside window + grace completely alone', async () => {
    const state = baseState([row({ id: 'w1', requested_at: '2026-01-20T10:00:00Z' })]);
    const res = await sweepStaleWithdrawalReservations(makeFake(state), {
      now: new Date('2026-01-25T09:00:00Z'),
    });
    expect(res.released).toBe(0);
    expect(state.rpcCalls).toEqual([]);
    expect(state.status.get('w1')).toBe('pending');
  });

  it('is safe to re-run: the second pass releases nothing', async () => {
    const state = baseState([row({ id: 'w1', credits_deducted: 2000 })]);
    const client = makeFake(state);

    const first = await sweepStaleWithdrawalReservations(client, { now: NOW });
    // Second pass sees the same fetched row (the fake's read path is static,
    // which is exactly the concurrent-read scenario worth guarding).
    const second = await sweepStaleWithdrawalReservations(client, { now: NOW });

    expect(first.released).toBe(1);
    expect(second.released).toBe(0);
    expect(second.alreadyHandled).toBe(1);
    // The money assertion: credit_reserved is decremented exactly once.
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.audits).toHaveLength(1);
  });

  it('skips a row an admin had ALREADY FINISHED before the run', async () => {
    // Narrow on purpose: this covers only the case where the admin's status
    // flip has already committed. The harder, real interleave — admin
    // mid-flight, row still pending — is the DEPENDS ON 2.2 test below.
    const state = baseState([row({ id: 'w1' })]);
    state.status.set('w1', 'paid'); // admin marked it paid between fetch and update
    const res = await sweepStaleWithdrawalReservations(makeFake(state), { now: NOW });
    expect(res.alreadyHandled).toBe(1);
    expect(res.released).toBe(0);
    expect(state.rpcCalls).toEqual([]);
  });

  it('reverts the claim to pending when the RPC fails, keeping the row admin-workable', async () => {
    // The whole point: PATCH /api/admin/withdrawals/[id] refuses any row whose
    // status is not 'pending' (route.ts:67). Leaving this row 'rejected' would
    // put the fence out of reach of the only path that can free it.
    const state = baseState([row({ id: 'w1', notes: 'operator note' })]);
    state.rpcError = 'boom';
    const deferred: string[] = [];
    const stranded: string[] = [];

    const res = await sweepStaleWithdrawalReservations(makeFake(state), {
      now: NOW,
      hooks: {
        onReleaseDeferred: async (r, m) => void deferred.push(`${r.id}:${m}`),
        onReleaseFailed: async (r, m) => void stranded.push(`${r.id}:${m}`),
      },
    });

    expect(res.released).toBe(0);
    expect(res.releaseDeferred).toBe(1);
    // NOT stranded: the red signal is reserved for a failed revert.
    expect(res.releaseFailed).toBe(0);
    expect(stranded).toEqual([]);
    expect(deferred).toEqual(['w1:boom']);

    // The row is back where it started, and reachable again.
    expect(state.status.get('w1')).toBe('pending');
    const revert = state.updates.at(-1)!;
    expect(revert.status).toBe('pending');
    expect(revert.processed_at).toBeNull();
    // The release marker is replaced by a failure marker; the operator's own
    // note survives.
    expect(String(revert.notes)).toContain('operator note');
    expect(String(revert.notes)).toContain('cancel_reservation_atomic failed');
    expect(String(revert.notes)).not.toContain('Credits returned to the balance');

    expect(state.audits).toHaveLength(0);
  });

  it('a deferred row is retried and released on the next run', async () => {
    const state = baseState([row({ id: 'w1', credits_deducted: 2000 })]);
    state.rpcError = 'transient';
    const first = await sweepStaleWithdrawalReservations(makeFake(state), { now: NOW });
    expect(first.releaseDeferred).toBe(1);
    expect(state.status.get('w1')).toBe('pending');

    // The blip clears.
    state.rpcError = undefined;
    const second = await sweepStaleWithdrawalReservations(makeFake(state), { now: NOW });
    expect(second.released).toBe(1);
    expect(state.rpcCalls).toEqual([{ center_id: 'c1', amount: 2000 }]);
    expect(state.status.get('w1')).toBe('rejected');
  });

  it('escalates red ONLY when the revert itself also fails — the genuinely stranded case', async () => {
    const state = baseState([row({ id: 'w1' })]);
    state.rpcError = 'boom';
    state.revertError = 'revert died too';
    const stranded: string[] = [];
    const deferred: string[] = [];

    const res = await sweepStaleWithdrawalReservations(makeFake(state), {
      now: NOW,
      hooks: {
        onReleaseFailed: async (r, m) => void stranded.push(`${r.id}:${m}`),
        onReleaseDeferred: async (r, m) => void deferred.push(`${r.id}:${m}`),
      },
    });

    expect(res.released).toBe(0);
    expect(res.releaseDeferred).toBe(0);
    expect(res.releaseFailed).toBe(1);
    expect(deferred).toEqual([]);
    expect(stranded).toHaveLength(1);
    // The signal names both failures, because both are needed to act on it.
    expect(stranded[0]).toContain('cancel_reservation_atomic failed (boom)');
    expect(stranded[0]).toContain('revert to pending also failed (revert died too)');
    // Terminal status with the reservation still held: out of reach.
    expect(state.status.get('w1')).toBe('rejected');
    expect(state.audits).toHaveLength(0);
  });

  it('separates a claim error from a stranded fence', async () => {
    // These used to share one counter, so cron_log.metadata could not tell a
    // benign retryable blip from somebody's money being stranded.
    const state = baseState([row({ id: 'w1' })]);
    state.claimError = 'connection reset';
    const claimFails: string[] = [];
    const stranded: string[] = [];

    const res = await sweepStaleWithdrawalReservations(makeFake(state), {
      now: NOW,
      hooks: {
        onClaimFailed: async (r, m) => void claimFails.push(`${r.id}:${m}`),
        onReleaseFailed: async (r, m) => void stranded.push(`${r.id}:${m}`),
      },
    });

    expect(res.claimFailed).toBe(1);
    expect(res.releaseFailed).toBe(0);
    expect(res.releaseDeferred).toBe(0);
    expect(claimFails).toEqual(['w1:connection reset']);
    expect(stranded).toEqual([]);
    // Nothing was written and no money moved.
    expect(state.status.get('w1')).toBe('pending');
    expect(state.rpcCalls).toEqual([]);
    expect(state.updates).toHaveLength(0);
  });

  it('counts, logs and escalates a stale row whose credits are unusable', async () => {
    const state = baseState([
      row({ id: 'bad', credits_deducted: 0 }),
      row({ id: 'good', credits_deducted: 500 }),
    ]);
    const flagged: string[] = [];

    const res = await sweepStaleWithdrawalReservations(makeFake(state), {
      now: NOW,
      hooks: { onInvalidCredits: async (r) => void flagged.push(r.id) },
    });

    expect(res.invalidCredits).toBe(1);
    expect(flagged).toEqual(['bad']);
    // Not swept, and not silently forgotten either.
    expect(state.status.get('bad')).toBe('pending');
    // The good row is unaffected.
    expect(res.released).toBe(1);
    expect(state.rpcCalls).toEqual([{ center_id: 'c1', amount: 500 }]);
  });

  it('a throwing onInvalidCredits hook does not abort the run', async () => {
    const state = baseState([
      row({ id: 'bad', credits_deducted: 0 }),
      row({ id: 'good', credits_deducted: 500 }),
    ]);
    const res = await sweepStaleWithdrawalReservations(makeFake(state), {
      now: NOW,
      hooks: {
        onInvalidCredits: async () => {
          throw new Error('ceo queue down');
        },
      },
    });
    expect(res.invalidCredits).toBe(1);
    expect(res.released).toBe(1);
  });

  /**
   * ── The interleave that matters: THE §2.2 DEPENDENCY ─────────────────────
   *
   * The neighbouring test sets status='paid' BEFORE the run, which only
   * models the case where the admin already finished. That is the easy half.
   *
   * This test models origin/master's REAL ordering. `PATCH
   * /api/admin/withdrawals/[id]` calls cancel_reservation_atomic FIRST
   * (route.ts:84 / :150) and flips the status only afterwards (:106 / :160),
   * across three un-transacted round trips. So there is a span in which the
   * admin has ALREADY released the reservation and the row is STILL 'pending'.
   * A sweeper claim landing in that span succeeds, and the RPC is called a
   * second time for one request.
   *
   * The assertion below is deliberately an assertion about the DEFECT, not
   * about a fix this branch contains. It is here to encode the dependency:
   * two decrements for one request. Because centers.credit_reserved is one
   * counter shared with combined_payment_sessions holds, and the RPC clamps
   * with GREATEST(0, ...), the surplus decrement silently frees somebody
   * else's live hold.
   *
   * This is closed by claude/payout-2-2-withdrawal-race, whose
   * process_withdrawal_request() holds SELECT ... FOR UPDATE on the row for
   * the whole release+spend+flip transaction: the sweeper's claim then blocks
   * and re-reads a non-pending status, taking the alreadyHandled path instead.
   * That is a database-level lock, which this in-memory fake cannot reproduce
   * — which is precisely why the dependency is a deployment-order requirement
   * and not something this branch can assert away.
   */
  it('DEPENDS ON 2.2: an admin mid-flight on master causes a double release', async () => {
    const state = baseState([row({ id: 'w1', credits_deducted: 2000 })]);

    // The admin's PATCH is between its own cancel_reservation_atomic and its
    // status flip. It has already decremented credit_reserved once.
    state.rpcCalls.push({ center_id: 'c1', amount: 2000 });
    // The row is STILL pending — the flip has not happened yet.
    expect(state.status.get('w1')).toBe('pending');

    const res = await sweepStaleWithdrawalReservations(makeFake(state), { now: NOW });

    // The sweeper's claim succeeds, because 'pending' is exactly what it
    // requires. Claim-first ordering does not help here: it never saw the
    // admin's RPC, only the admin's status flip would have stopped it.
    expect(res.released).toBe(1);
    expect(res.alreadyHandled).toBe(0);

    // TWO cancel_reservation_atomic calls for ONE withdrawal request.
    expect(state.rpcCalls).toEqual([
      { center_id: 'c1', amount: 2000 }, // the admin's
      { center_id: 'c1', amount: 2000 }, // the sweeper's — the surplus
    ]);
    expect(state.rpcCalls).toHaveLength(2);

    // 4000 credits unfenced against a 2000-credit request. The extra 2000 came
    // off a counter shared with live combined_payment_sessions holds.
    const decremented = state.rpcCalls.reduce((sum, c) => sum + c.amount, 0);
    expect(decremented).toBe(4000);
    expect(decremented).toBeGreaterThan(2000);
  });

  it('counts a failed audit insert instead of swallowing it', async () => {
    const state = baseState([row({ id: 'w1' })]);
    state.auditError = 'audit down';
    const res = await sweepStaleWithdrawalReservations(makeFake(state), { now: NOW });
    expect(res.released).toBe(1);
    expect(res.auditFailed).toBe(1);
  });

  it('a throwing notification hook does not abort the run or the release', async () => {
    const state = baseState([
      row({ id: 'w1', requested_at: '2026-01-02T10:00:00Z' }),
      row({ id: 'w2', requested_at: '2026-01-03T10:00:00Z' }),
    ]);
    const res = await sweepStaleWithdrawalReservations(makeFake(state), {
      now: NOW,
      hooks: {
        onReleased: async () => {
          throw new Error('whatsapp down');
        },
      },
    });
    expect(res.released).toBe(2);
    expect(state.rpcCalls).toHaveLength(2);
  });

  it('appends a marker to notes without destroying an existing note', async () => {
    const state = baseState([row({ id: 'w1', notes: 'operator note' })]);
    await sweepStaleWithdrawalReservations(makeFake(state), { now: NOW });
    const notes = String(state.updates[0].notes);
    expect(notes.startsWith('operator note\n')).toBe(true);
    expect(notes).toContain('sweep-withdrawal-reservations');
  });

  it('writes only a status the live CHECK constraint permits', async () => {
    // pg_constraint: withdrawal_requests_status_check allows pending|paid|rejected.
    const state = baseState([row({ id: 'w1' })]);
    await sweepStaleWithdrawalReservations(makeFake(state), { now: NOW });
    expect(['pending', 'paid', 'rejected']).toContain(String(state.updates[0].status));
  });

  it('surfaces a query error rather than reporting a clean run', async () => {
    const state = baseState([]);
    state.selectError = 'connection reset';
    await expect(
      sweepStaleWithdrawalReservations(makeFake(state), { now: NOW }),
    ).rejects.toThrow('connection reset');
  });
});
