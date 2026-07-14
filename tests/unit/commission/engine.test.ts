import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mutable stub state, shared with the hoisted mock of @supabase/supabase-js.
const S = vi.hoisted(() => ({
  reads: {} as Record<string, unknown>,
  commissionIds: [] as (string | null)[], // FIFO ids returned by commissions inserts (null = 23505)
  inserts: {} as Record<string, Record<string, unknown>[]>,
}));

vi.mock('@supabase/supabase-js', () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    let mode: 'select' | 'insert' = 'select';
    for (const m of ['select', 'eq', 'not', 'gte', 'lt', 'in', 'order', 'limit', 'is', 'update']) b[m] = () => b;
    b.insert = (row: Record<string, unknown>) => {
      mode = 'insert';
      (S.inserts[table] ??= []).push(row);
      return b;
    };
    b.maybeSingle = async () => ({ data: S.reads[table] ?? null, error: null });
    b.single = async () => {
      if (mode === 'insert' && table === 'commissions') {
        const id = S.commissionIds.shift();
        if (id === null) return { data: null, error: { code: '23505' } };
        return { data: { id: id ?? 'gen-id' }, error: null };
      }
      return { data: S.reads[table] ?? null, error: null };
    };
    b.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
      resolve({ data: S.reads[table] ?? [], error: null });
    return b;
  }
  return { createClient: () => ({ from: (t: string) => builder(t) }) };
});

import { createCommissionsForOwner } from '@/lib/commissions';

beforeEach(() => {
  S.reads = {};
  S.commissionIds = [];
  S.inserts = {};
});

describe('createCommissionsForOwner — rep + manager override (teacher, monthly 2000)', () => {
  beforeEach(() => {
    S.reads.teacher_subscriptions = { plan_key: 'teacher_pro', price_gross: 2000 };
    S.reads.teacher_assignments = { staff_id: 'sr1', sourced_by: 'sr', assignment_status: 'approved' };
    S.reads.staff = { id: 'sr1', role: 'sr', reports_to: 'sm1' };
    S.commissionIds = ['rep-id', 'ov-id'];
  });

  it('inserts a rep self_sourced row = 20% of monthly, split in halves', async () => {
    await createCommissionsForOwner('teacher', 't1');
    const rep = (S.inserts.commissions ?? []).find((r) => r.commission_type === 'self_sourced');
    expect(rep).toMatchObject({
      owner_type: 'teacher',
      teacher_id: 't1',
      center_id: null,
      staff_id: 'sr1',
      role_at_time: 'sr',
      plan_at_signing: 'teacher_pro',
      total_commission: 400,
      t1_amount: 200,
      t2_amount: 200,
      loyalty_bonus_amount: 0,
    });
  });

  it('inserts a manager override = 20% of the rep’s halves, linked to the rep', async () => {
    await createCommissionsForOwner('teacher', 't1');
    const ov = (S.inserts.commissions ?? []).find((r) => r.commission_type === 'override');
    expect(ov).toMatchObject({
      owner_type: 'teacher',
      staff_id: 'sm1',
      role_at_time: 'sm',
      parent_commission_id: 'rep-id',
      t1_amount: 40,
      t2_amount: 40,
      loyalty_bonus_amount: 0,
    });
  });
});

describe('createCommissionsForOwner — rep base reflects a one-time promo (FIX 3)', () => {
  it('T1/T2 halves + the override come off the POST-promo price (2000 → 10% promo → base 1800)', async () => {
    S.reads.teacher_subscriptions = { plan_key: 'teacher_pro', price_gross: 2000 };
    S.reads.teacher_assignments = { staff_id: 'sr1', sourced_by: 'sr', assignment_status: 'approved' };
    S.reads.staff = { id: 'sr1', role: 'sr', reports_to: 'sm1' };
    // First paid invoice carried a 10% promo: 2000 → 1800 charged.
    S.reads.invoices = { promo_code: 'SUMMER10', promo_original_amount: 2000, total_amount: 1800 };
    S.commissionIds = ['rep-id', 'ov-id'];

    await createCommissionsForOwner('teacher', 't1');

    const rep = (S.inserts.commissions ?? []).find((r) => r.commission_type === 'self_sourced');
    // 20% of the post-promo 1800 = 360, halves 180/180 (vs 400/200/200 at full 2000).
    expect(rep).toMatchObject({ total_commission: 360, t1_amount: 180, t2_amount: 180 });
    const ov = (S.inserts.commissions ?? []).find((r) => r.commission_type === 'override');
    // Override tracks the rep halves: 20% of 180 = 36 each.
    expect(ov).toMatchObject({ t1_amount: 36, t2_amount: 36 });
  });
});

describe('createCommissionsForOwner — eyad-sourced', () => {
  it('inserts a single zero self_sourced row (no rep, no override)', async () => {
    S.reads.teacher_subscriptions = { plan_key: 'teacher_standard', price_gross: 499 };
    S.reads.teacher_assignments = { staff_id: null, sourced_by: 'eyad', assignment_status: 'approved' };
    S.commissionIds = ['eyad-id'];

    await createCommissionsForOwner('teacher', 't1');

    expect(S.inserts.commissions).toHaveLength(1);
    expect(S.inserts.commissions[0]).toMatchObject({
      staff_id: null,
      role_at_time: 'eyad',
      commission_type: 'self_sourced',
      total_commission: 0,
      t1_status: 'paid',
      t2_status: 'paid',
      loyalty_bonus_status: 'paid',
    });
  });
});

describe('createCommissionsForOwner — a center referred by another center earns nothing', () => {
  it('short-circuits with no commission rows', async () => {
    S.reads.centers = { id: 'c1', plan: 'starter', all_in_price: 4499, billing_period: 'quarterly', status: 'active' };
    S.reads.center_assignments = {
      staff_id: 'sr1',
      sourced_by: 'sr',
      referred_by_center: true,
      assignment_status: 'approved',
    };
    await createCommissionsForOwner('center', 'c1');
    expect(S.inserts.commissions ?? []).toHaveLength(0);
  });
});
