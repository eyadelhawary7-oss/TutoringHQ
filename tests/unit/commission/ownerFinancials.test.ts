import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveOwnerMonthlyPrice, firstTwelveMonthsRevenue } from '@/lib/commission/ownerFinancials';

// Minimal recording stub: `.from(table)` → chainable builder that is both awaitable
// (resolves {data}) and supports .maybeSingle()/.single(). Responses are keyed by table.
function makeClient(responses: Record<string, unknown>) {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'not', 'gte', 'lt', 'in', 'order', 'limit', 'is']) {
      b[m] = () => b;
    }
    b.maybeSingle = async () => ({ data: responses[table] ?? null, error: null });
    b.single = async () => ({ data: responses[table] ?? null, error: null });
    b.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
      resolve({ data: responses[table] ?? [], error: null });
    return b;
  }
  return { from: (t: string) => builder(t) } as unknown as SupabaseClient;
}

describe('resolveOwnerMonthlyPrice', () => {
  it('teacher: uses live price_gross', async () => {
    const client = makeClient({ teacher_subscriptions: { plan_key: 'teacher_pro', price_gross: 999 } });
    expect(await resolveOwnerMonthlyPrice(client, 'teacher', 't1')).toEqual({ monthly: 999, planKey: 'teacher_pro' });
  });

  it('teacher: falls back to the plan list price when price_gross is 0', async () => {
    const client = makeClient({ teacher_subscriptions: { plan_key: 'teacher_standard', price_gross: 0 } });
    const r = await resolveOwnerMonthlyPrice(client, 'teacher', 't1');
    expect(r?.monthly).toBe(499); // teacher_standard list price
  });

  it('returns null when the owner row is missing', async () => {
    const client = makeClient({});
    expect(await resolveOwnerMonthlyPrice(client, 'teacher', 't1')).toBeNull();
  });
});

describe('firstTwelveMonthsRevenue', () => {
  it('sums COALESCE(payment_amount, total_amount) over paid invoices', async () => {
    const client = makeClient({
      invoices: [
        { payment_amount: 1020, total_amount: 1000 }, // payment_amount wins
        { payment_amount: null, total_amount: 500 }, // falls back to total_amount
        { payment_amount: 2000, total_amount: 2000 },
      ],
    });
    expect(await firstTwelveMonthsRevenue(client, 'center', 'c1', '2026-01-01')).toBe(3520);
  });

  it('ignores non-positive amounts and returns 0 with no firstPaymentDate', async () => {
    const client = makeClient({ invoices: [{ payment_amount: -5, total_amount: -5 }] });
    expect(await firstTwelveMonthsRevenue(client, 'center', 'c1', '2026-01-01')).toBe(0);
    expect(await firstTwelveMonthsRevenue(client, 'center', 'c1', null)).toBe(0);
  });
});
