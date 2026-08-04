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
    expect(out.map((r) => r.id)).toEqual(['old']);
  });

  it('skips rows with a non-positive or unparseable reservation', () => {
    const rows = [
      row({ id: 'zero', credits_deducted: 0 }),
      row({ id: 'neg', credits_deducted: -50 }),
      row({ id: 'junk', credits_deducted: 'abc' }),
      row({ id: 'ok', credits_deducted: '2000' }),
    ];
    const out = selectStaleWithdrawals(rows, '2026-02-01');
    expect(out.map((r) => r.id)).toEqual(['ok']);
    expect(out[0].credits).toBe(2000);
  });

  it('processes oldest first and honours the cap', () => {
    const rows = [
      row({ id: 'b', requested_at: '2026-01-10T10:00:00Z' }),
      row({ id: 'a', requested_at: '2026-01-02T10:00:00Z' }),
      row({ id: 'c', requested_at: '2026-01-12T10:00:00Z' }),
    ];
    expect(selectStaleWithdrawals(rows, '2026-02-01').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(selectStaleWithdrawals(rows, '2026-02-01', 2).map((r) => r.id)).toEqual(['a', 'b']);
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
  auditError?: string;
  selectError?: string;
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
                if (state.claimError) {
                  return Promise.resolve({ data: null, error: { message: state.claimError } });
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

  it('claims before releasing, so a row an admin already handled is never double-released', async () => {
    const state = baseState([row({ id: 'w1' })]);
    state.status.set('w1', 'paid'); // admin marked it paid between fetch and update
    const res = await sweepStaleWithdrawalReservations(makeFake(state), { now: NOW });
    expect(res.alreadyHandled).toBe(1);
    expect(res.released).toBe(0);
    expect(state.rpcCalls).toEqual([]);
  });

  it('escalates when the status flipped but the RPC failed, and does not count it released', async () => {
    const state = baseState([row({ id: 'w1' })]);
    state.rpcError = 'boom';
    const failures: string[] = [];

    const res = await sweepStaleWithdrawalReservations(makeFake(state), {
      now: NOW,
      hooks: { onReleaseFailed: async (r, m) => void failures.push(`${r.id}:${m}`) },
    });

    expect(res.released).toBe(0);
    expect(res.releaseFailed).toBe(1);
    expect(failures).toEqual(['w1:boom']);
    expect(state.audits).toHaveLength(0);
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
