import { describe, it, expect, beforeEach, vi } from 'vitest';

// Purpose-built sequenced mock for reassignCommissions, which reads the commissions
// table TWICE (pre-snapshot, then fresh rows after createCommissionsForOwner) and
// issues per-row updates we need to capture exactly.
const S = vi.hoisted(() => ({
  commissionsSelects: [] as unknown[][], // FIFO: one entry per awaited commissions select
  reads: {} as Record<string, unknown>, // single-row maybeSingle()/single() reads per table
  staffReads: [] as unknown[], // FIFO for staff maybeSingle()/single()
  commissionInsertIds: [] as (string | null)[], // FIFO ids for commissions inserts (null = 23505)
  updates: [] as { table: string; patch: Record<string, unknown>; eqs: Record<string, unknown> }[],
  inserts: [] as { table: string; row: Record<string, unknown> }[],
}));

vi.mock('@supabase/supabase-js', () => {
  function builder(table: string) {
    let op: 'select' | 'insert' | 'update' = 'select';
    let patch: Record<string, unknown> = {};
    const eqs: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'not', 'gte', 'lt', 'in', 'order', 'limit']) b[m] = () => b;
    b.is = () => b;
    b.eq = (col: string, val: unknown) => {
      eqs[col] = val;
      return b;
    };
    b.update = (p: Record<string, unknown>) => {
      op = 'update';
      patch = p;
      return b;
    };
    b.insert = (row: Record<string, unknown>) => {
      op = 'insert';
      S.inserts.push({ table, row });
      return b;
    };
    b.maybeSingle = async () => {
      if (table === 'staff') return { data: S.staffReads.shift() ?? null, error: null };
      return { data: S.reads[table] ?? null, error: null };
    };
    b.single = async () => {
      if (op === 'insert' && table === 'commissions') {
        const id = S.commissionInsertIds.shift();
        if (id === null) return { data: null, error: { code: '23505' } };
        return { data: { id: id ?? 'gen-id' }, error: null };
      }
      if (table === 'staff') return { data: S.staffReads.shift() ?? null, error: null };
      return { data: S.reads[table] ?? null, error: null };
    };
    b.then = (resolve: (v: { data: unknown; error: null }) => unknown) => {
      if (op === 'update') {
        S.updates.push({ table, patch, eqs });
        return resolve({ data: null, error: null });
      }
      if (op === 'insert') return resolve({ data: null, error: null });
      if (table === 'commissions') {
        return resolve({ data: S.commissionsSelects.shift() ?? [], error: null });
      }
      return resolve({ data: (S.reads[table] as unknown[]) ?? [], error: null });
    };
    return b;
  }
  return { createClient: () => ({ from: (t: string) => builder(t) }) };
});

import { reassignCommissions } from '@/lib/commissions';

const updatesFor = (id: string) => S.updates.filter((u) => u.table === 'commissions' && u.eqs.id === id);

beforeEach(() => {
  S.commissionsSelects = [];
  S.reads = {};
  S.staffReads = [];
  S.commissionInsertIds = [];
  S.updates = [];
  S.inserts = [];
});

/** Common fixture: teacher T, monthly 2000 → rep total 400 (t1 200 / t2 200), override 80 (40/40). */
function armCreateForOwner(newRep: string, manager: string | null) {
  S.reads.teacher_subscriptions = { plan_key: 'teacher_pro', price_gross: 2000 };
  S.reads.teacher_assignments = { staff_id: newRep, sourced_by: 'sr', assignment_status: 'approved' };
  // createCommissionsForOwner's staff single() read:
  S.staffReads.push({ id: newRep, role: 'sr', reports_to: manager });
}

describe('reassignCommissions — ONCE-PER-CUSTOMER (never double-pay)', () => {
  it('suppresses tiers already PAID to the prior rep on the fresh row (t1+t2 paid → both reassigned)', async () => {
    const snapshot = [
      {
        id: 'a-row',
        staff_id: 'rep-a',
        commission_type: 'self_sourced',
        t1_status: 'paid',
        t2_status: 'paid',
        loyalty_bonus_status: 'locked',
        center_first_payment_date: '2026-01-01',
        role_at_time: 'sr',
      },
    ];
    const fresh = [
      ...snapshot,
      {
        id: 'b-row',
        staff_id: 'rep-b',
        commission_type: 'self_sourced',
        t1_status: 'pending',
        center_first_payment_date: null,
      },
    ];
    S.commissionsSelects = [snapshot, fresh];
    S.staffReads.push({ reports_to: 'mgr-m' }); // reassign's own manager lookup for rep-b
    armCreateForOwner('rep-b', 'mgr-m');
    S.commissionInsertIds = ['b-row', 'ov-new'];

    await reassignCommissions('teacher', 't1', 'rep-b');

    // rep A's paid tiers untouched; only the unearned loyalty voids.
    const aPatches = updatesFor('a-row');
    expect(aPatches).toHaveLength(1);
    expect(aPatches[0].patch).toEqual({ loyalty_bonus_status: 'reassigned' });

    // rep B's fresh row: clock transfers, but the already-paid T1/T2 are SUPPRESSED
    // (never payable again), while loyalty (never paid) stays earnable.
    const bPatches = updatesFor('b-row');
    expect(bPatches).toHaveLength(1);
    expect(bPatches[0].patch).toMatchObject({
      center_first_payment_date: '2026-01-01',
      t1_status: 'reassigned',
      t2_status: 'reassigned',
    });
    expect(bPatches[0].patch.loyalty_bonus_status).toBeUndefined();
  });

  it('transfers genuinely UNEARNED tiers as earnable (old rep t1 eligible-not-paid → voided; new rep t1 eligible)', async () => {
    const snapshot = [
      {
        id: 'a-row',
        staff_id: 'rep-a',
        commission_type: 'self_sourced',
        t1_status: 'eligible',
        t2_status: 'locked',
        loyalty_bonus_status: 'locked',
        center_first_payment_date: '2026-01-01',
        role_at_time: 'sr',
      },
    ];
    const fresh = [
      ...snapshot,
      {
        id: 'b-row',
        staff_id: 'rep-b',
        commission_type: 'self_sourced',
        t1_status: 'pending',
        center_first_payment_date: null,
      },
    ];
    S.commissionsSelects = [snapshot, fresh];
    S.staffReads.push({ reports_to: null });
    armCreateForOwner('rep-b', null);
    S.commissionInsertIds = ['b-row'];

    await reassignCommissions('teacher', 't1', 'rep-b');

    // Old rep fully voided (nothing was paid).
    expect(updatesFor('a-row')[0].patch).toEqual({
      t1_status: 'reassigned',
      t2_status: 'reassigned',
      loyalty_bonus_status: 'reassigned',
    });
    // New rep inherits the clock with an EARNABLE T1 (and t2/loyalty left locked).
    const bPatch = updatesFor('b-row')[0].patch;
    expect(bPatch).toMatchObject({ center_first_payment_date: '2026-01-01', t1_status: 'eligible' });
    expect(bPatch.t2_status).toBeUndefined();
    expect(bPatch.loyalty_bonus_status).toBeUndefined();
  });

  it('FIX C — a CLAWED-BACK tier (chargeback) is terminal: not voided on the old rep, not resurrected on the new rep', async () => {
    const snapshot = [
      {
        id: 'a-row',
        staff_id: 'rep-a',
        commission_type: 'self_sourced',
        t1_status: 'clawed_back',
        t2_status: 'clawed_back',
        loyalty_bonus_status: 'clawed_back',
        center_first_payment_date: '2026-01-01',
        role_at_time: 'sr',
      },
    ];
    const fresh = [
      ...snapshot,
      {
        id: 'b-row',
        staff_id: 'rep-b',
        commission_type: 'self_sourced',
        t1_status: 'pending',
        center_first_payment_date: null,
      },
    ];
    S.commissionsSelects = [snapshot, fresh];
    S.staffReads.push({ reports_to: null });
    armCreateForOwner('rep-b', null);
    S.commissionInsertIds = ['b-row'];

    await reassignCommissions('teacher', 't1', 'rep-b');

    // Old rep's clawed_back tiers are LEFT INTACT — never flipped to 'reassigned'.
    expect(updatesFor('a-row')).toHaveLength(0);
    // New rep earns NOTHING: every tier is suppressed because the prior rep's tiers were
    // consumed (chargeback-reversed money must never be resurrected to a new rep).
    const bPatch = updatesFor('b-row')[0].patch;
    expect(bPatch).toMatchObject({
      t1_status: 'reassigned',
      t2_status: 'reassigned',
      loyalty_bonus_status: 'reassigned',
    });
  });
});

describe('reassignCommissions — same-manager override survives', () => {
  it('does NOT void the manager override when the incoming rep reports to the same manager', async () => {
    const snapshot = [
      {
        id: 'a-row',
        staff_id: 'rep-a',
        commission_type: 'self_sourced',
        t1_status: 'eligible',
        t2_status: 'locked',
        loyalty_bonus_status: 'locked',
        center_first_payment_date: '2026-01-01',
        role_at_time: 'sr',
      },
      {
        id: 'm-override',
        staff_id: 'mgr-m',
        commission_type: 'override',
        t1_status: 'eligible',
        t2_status: 'locked',
        loyalty_bonus_status: 'locked',
        center_first_payment_date: '2026-01-01',
        role_at_time: 'sm',
      },
    ];
    const fresh = [
      ...snapshot,
      {
        id: 'b-row',
        staff_id: 'rep-b',
        commission_type: 'self_sourced',
        t1_status: 'pending',
        center_first_payment_date: null,
      },
    ];
    S.commissionsSelects = [snapshot, fresh];
    S.staffReads.push({ reports_to: 'mgr-m' }); // rep-b reports to the SAME manager M
    armCreateForOwner('rep-b', 'mgr-m');
    // rep insert gets an id; the override insert collides (row exists) → 23505.
    S.commissionInsertIds = ['b-row', null];

    await reassignCommissions('teacher', 't1', 'rep-b');

    // The manager's override row must receive NO void update — it stays live.
    expect(updatesFor('m-override')).toHaveLength(0);
    // The old rep is still voided.
    expect(updatesFor('a-row')).toHaveLength(1);
  });

  it('DOES void the old manager override on a cross-manager reassignment', async () => {
    const snapshot = [
      {
        id: 'a-row',
        staff_id: 'rep-a',
        commission_type: 'self_sourced',
        t1_status: 'eligible',
        t2_status: 'locked',
        loyalty_bonus_status: 'locked',
        center_first_payment_date: '2026-01-01',
        role_at_time: 'sr',
      },
      {
        id: 'm1-override',
        staff_id: 'mgr-old',
        commission_type: 'override',
        t1_status: 'eligible',
        t2_status: 'locked',
        loyalty_bonus_status: 'locked',
        center_first_payment_date: '2026-01-01',
        role_at_time: 'sm',
      },
    ];
    const fresh = [...snapshot];
    S.commissionsSelects = [snapshot, fresh];
    S.staffReads.push({ reports_to: 'mgr-new' }); // rep-b reports to a DIFFERENT manager
    armCreateForOwner('rep-b', 'mgr-new');
    S.commissionInsertIds = ['b-row', 'ov-new'];

    await reassignCommissions('teacher', 't1', 'rep-b');

    // The OLD manager's override is voided (their rep lost the account).
    const m1 = updatesFor('m1-override');
    expect(m1).toHaveLength(1);
    expect(m1[0].patch).toEqual({
      t1_status: 'reassigned',
      t2_status: 'reassigned',
      loyalty_bonus_status: 'reassigned',
    });
  });
});
