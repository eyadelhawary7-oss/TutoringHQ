import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recomputeT2Amount, recomputeLoyaltyAmount, loadTierCandidates } from '@/lib/commission/tierUnlock';

function makeClient(responses: Record<string, unknown>) {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'not', 'gte', 'lt', 'in', 'order', 'limit', 'is']) b[m] = () => b;
    b.maybeSingle = async () => ({ data: responses[table] ?? null, error: null });
    b.single = async () => ({ data: responses[table] ?? null, error: null });
    b.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
      resolve({ data: responses[table] ?? [], error: null });
    return b;
  }
  return { from: (t: string) => builder(t) } as unknown as SupabaseClient;
}

const cand = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'x',
  staff_id: 's',
  commission_type: 'self_sourced',
  ownerType: 'teacher' as const,
  ownerId: 't1',
  firstPaymentDate: '2026-01-01',
  activeDays: 200,
  ...over,
});

describe('recomputeT2Amount — second half at CURRENT price', () => {
  it('self_sourced = 20% ÷ 2 of the current monthly price', async () => {
    const client = makeClient({ teacher_subscriptions: { plan_key: 'teacher_pro', price_gross: 2000 } });
    expect(await recomputeT2Amount(client, cand())).toBe(200); // 2000*0.2/2
  });

  it('override = 20% of the rep’s recomputed T2', async () => {
    const client = makeClient({ teacher_subscriptions: { plan_key: 'teacher_pro', price_gross: 2000 } });
    expect(await recomputeT2Amount(client, cand({ commission_type: 'override' }))).toBe(40); // 200*0.2
  });
});

describe('recomputeLoyaltyAmount — 1% of 12-month revenue', () => {
  it('self_sourced = 1% of realized revenue', async () => {
    const client = makeClient({ invoices: [{ payment_amount: 50000, total_amount: 50000 }] });
    expect(await recomputeLoyaltyAmount(client, cand())).toBe(500);
  });

  it('override = 20% of the rep’s loyalty', async () => {
    const client = makeClient({ invoices: [{ payment_amount: 50000, total_amount: 50000 }] });
    expect(await recomputeLoyaltyAmount(client, cand({ commission_type: 'override' }))).toBe(100); // 500*0.2
  });
});

describe('loadTierCandidates — center gating', () => {
  const freshDue = new Date().toISOString().slice(0, 10);

  it('includes an active center row past the active-days threshold', async () => {
    const client = makeClient({
      commissions: [
        {
          id: 'c-comm',
          staff_id: 's1',
          commission_type: 'self_sourced',
          center_id: 'c1',
          center_first_payment_date: '2020-01-01', // very old → well past 180 days
          clock_pause_log: [],
          centers: { billing_status: 'active', next_payment_due: freshDue },
        },
      ],
    });
    const rows = await loadTierCandidates(client, 't2_status', 180);
    // The same stub answers the teacher pass too, but those rows have no teacher_id and
    // no matching subscription, so only the center candidate survives.
    const center = rows.filter((r) => r.ownerType === 'center');
    expect(center).toHaveLength(1);
    expect(center[0]).toMatchObject({ id: 'c-comm', ownerType: 'center', ownerId: 'c1' });
  });

  it('excludes a suspended center even past the threshold', async () => {
    const client = makeClient({
      commissions: [
        {
          id: 'c-comm',
          staff_id: 's1',
          commission_type: 'self_sourced',
          center_id: 'c1',
          center_first_payment_date: '2020-01-01',
          clock_pause_log: [],
          centers: { billing_status: 'suspended', next_payment_due: freshDue },
        },
      ],
    });
    const rows = await loadTierCandidates(client, 't2_status', 180);
    expect(rows.filter((r) => r.ownerType === 'center')).toHaveLength(0);
  });
});
