import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * FIX 1 — clawbackCommissionsForOwner (the GENUINE-chargeback path).
 * Proves it is: owner-aware (center OR teacher), full-tier (T1 + T2 + loyalty, including
 * already-PAID tiers), and idempotent (terminal statuses are left untouched).
 */
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

const S = vi.hoisted(() => ({
  rows: [] as unknown[], // rows the commissions SELECT returns
  updates: [] as { patch: Record<string, unknown>; eqs: Record<string, unknown> }[],
  selectEqs: [] as { table: string; col: string; val: unknown }[],
  updateError: null as { message: string } | null, // injected error on the UPDATE
}));

vi.mock('@supabase/supabase-js', () => {
  function builder(table: string) {
    let op: 'select' | 'update' | 'insert' = 'select';
    let patch: Record<string, unknown> = {};
    const eqs: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'not', 'gte', 'lt', 'in', 'order', 'limit', 'is']) b[m] = () => b;
    b.eq = (col: string, val: unknown) => {
      eqs[col] = val;
      S.selectEqs.push({ table, col, val });
      return b;
    };
    b.update = (p: Record<string, unknown>) => {
      op = 'update';
      patch = p;
      return b;
    };
    b.insert = () => {
      op = 'insert';
      return b;
    };
    b.maybeSingle = async () => ({ data: null, error: null });
    b.single = async () => ({ data: null, error: null });
    b.then = (resolve: (v: { data: unknown; error: unknown }) => unknown) => {
      if (op === 'update') {
        S.updates.push({ patch, eqs });
        return resolve({ data: null, error: S.updateError });
      }
      if (op === 'insert') return resolve({ data: null, error: null });
      if (table === 'commissions') return resolve({ data: S.rows, error: null });
      return resolve({ data: [], error: null });
    };
    return b;
  }
  return { createClient: () => ({ from: (t: string) => builder(t) }) };
});

import { clawbackCommissionsForOwner } from '@/lib/commissions';

const commissionEqs = () => S.selectEqs.filter((e) => e.table === 'commissions');

beforeEach(() => {
  S.rows = [];
  S.updates = [];
  S.selectEqs = [];
  S.updateError = null;
});

describe('clawbackCommissionsForOwner', () => {
  it('TEACHER-aware: queries by teacher_id and reverses ALL live tiers (incl. already PAID)', async () => {
    S.rows = [{ id: 'r1', staff_id: 'sr1', t1_status: 'paid', t2_status: 'eligible', loyalty_bonus_status: 'locked' }];
    await clawbackCommissionsForOwner('teacher', 't1', 'chargeback');

    // Selected by teacher_id (not center_id).
    expect(commissionEqs().some((e) => e.col === 'teacher_id' && e.val === 't1')).toBe(true);
    expect(commissionEqs().some((e) => e.col === 'center_id')).toBe(false);

    expect(S.updates).toHaveLength(1);
    expect(S.updates[0].eqs.id).toBe('r1');
    // Full-tier: T1 (paid), T2 (eligible), loyalty (locked) all reversed.
    expect(S.updates[0].patch).toEqual({
      t1_status: 'clawed_back',
      t2_status: 'clawed_back',
      loyalty_bonus_status: 'clawed_back',
    });
  });

  it('CENTER-aware: queries by center_id', async () => {
    S.rows = [{ id: 'c-row', staff_id: 'sr1', t1_status: 'eligible', t2_status: 'locked', loyalty_bonus_status: 'locked' }];
    await clawbackCommissionsForOwner('center', 'c1', 'chargeback');
    expect(commissionEqs().some((e) => e.col === 'center_id' && e.val === 'c1')).toBe(true);
    expect(commissionEqs().some((e) => e.col === 'teacher_id')).toBe(false);
    expect(S.updates[0].patch).toEqual({
      t1_status: 'clawed_back',
      t2_status: 'clawed_back',
      loyalty_bonus_status: 'clawed_back',
    });
  });

  it('IDEMPOTENT: a row already terminal on every tier is not updated', async () => {
    S.rows = [{ id: 'r1', staff_id: 'sr1', t1_status: 'reassigned', t2_status: 'forfeited', loyalty_bonus_status: 'clawed_back' }];
    await clawbackCommissionsForOwner('teacher', 't1', 'chargeback');
    expect(S.updates).toHaveLength(0);
  });

  it('MIXED: only the still-live tiers flip; terminal tiers are preserved', async () => {
    S.rows = [{ id: 'r1', staff_id: 'sr1', t1_status: 'paid', t2_status: 'reassigned', loyalty_bonus_status: 'locked' }];
    await clawbackCommissionsForOwner('teacher', 't1', 'chargeback');
    expect(S.updates).toHaveLength(1);
    // T2 was already 'reassigned' → left as-is; only T1 + loyalty flip.
    expect(S.updates[0].patch).toEqual({
      t1_status: 'clawed_back',
      loyalty_bonus_status: 'clawed_back',
    });
  });

  it('NEVER claws the CEO-sourced eyad zero row (staff_id null) — keeps "CEO-sourced pays zero forever"', async () => {
    // The eyad zero row is all-'paid' at 0; clawing it would break once-per-customer.
    S.rows = [{ id: 'eyad', staff_id: null, t1_status: 'paid', t2_status: 'paid', loyalty_bonus_status: 'paid' }];
    await clawbackCommissionsForOwner('center', 'c1', 'chargeback');
    expect(S.updates).toHaveLength(0);
  });

  it('a REJECTED update (e.g. missing constraint migration) THROWS — never a silent skip', async () => {
    // Money-safety: a chargeback must not silently leave a rep paid on reversed money.
    S.rows = [{ id: 'r1', staff_id: 'sr1', t1_status: 'paid', t2_status: 'locked', loyalty_bonus_status: 'locked' }];
    S.updateError = { message: 'new row violates check constraint "commissions_t2_status_check"' };
    await expect(clawbackCommissionsForOwner('teacher', 't1', 'chargeback')).rejects.toThrow(/update failed/);
  });
});
