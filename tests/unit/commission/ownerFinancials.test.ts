import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveOwnerMonthlyPrice,
  resolveOwnerConversionMonthlyPrice,
  firstTwelveMonthsRevenue,
} from '@/lib/commission/ownerFinancials';
import { round2 } from '@/lib/commission/rates';

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

// FIX 3 — the rep's FIRST half (T1) must come off the amount ACTUALLY paid after any
// one-time promo, not the standing plan rate. (The SECOND half is repriced by the T2 cron
// from the current standing price, where the one-time promo no longer applies.)
describe('resolveOwnerConversionMonthlyPrice — post-promo T1 base', () => {
  it('scales the standing monthly price down by the first-invoice promo fraction', async () => {
    const client = makeClient({
      teacher_subscriptions: { plan_key: 'teacher_pro', price_gross: 1000 },
      invoices: { promo_code: 'SUMMER10', promo_original_amount: 1000, total_amount: 900 },
    });
    // (1000 − 900)/1000 = 0.10 → 1000 × 0.90 = 900
    expect(await resolveOwnerConversionMonthlyPrice(client, 'teacher', 't1')).toEqual({
      monthly: 900,
      planKey: 'teacher_pro',
      promoFraction: 0.1,
    });
  });

  it('NO promo → standing price is unchanged (negotiated price flows through)', async () => {
    const client = makeClient({
      teacher_subscriptions: { plan_key: 'teacher_pro', price_gross: 1000 },
      // no invoices row → no promo
    });
    expect(await resolveOwnerConversionMonthlyPrice(client, 'teacher', 't1')).toEqual({
      monthly: 1000,
      planKey: 'teacher_pro',
      promoFraction: 0,
    });
  });

  it("center early-adopter price flows through, with the promo applied on top of IT", async () => {
    const client = makeClient({
      centers: {
        id: 'c1',
        plan: 'starter',
        all_in_price: 4499,
        billing_period: 'monthly',
        status: 'active',
        is_test: false,
        is_early_adopter: true,
        early_adopter_price: 800, // negotiated/early-adopter price (NOT the 4499 list)
      },
      invoices: { promo_code: 'X', promo_original_amount: 800, total_amount: 720 }, // 10% off
    });
    const standing = await resolveOwnerMonthlyPrice(client, 'center', 'c1');
    const conv = await resolveOwnerConversionMonthlyPrice(client, 'center', 'c1');
    // The standing base is the EARLY-ADOPTER price (800), not the 4499 list price…
    expect(standing?.monthly).toBe(800);
    // …and the promo scales THAT: 800 × 0.90 = 720.
    expect(conv?.monthly).toBe(round2(800 * 0.9));
    expect(conv?.promoFraction).toBeCloseTo(0.1, 10);
  });

  it('an invoice with no real discount (total ≥ original) contributes nothing', async () => {
    const client = makeClient({
      teacher_subscriptions: { plan_key: 'teacher_pro', price_gross: 1000 },
      invoices: { promo_code: 'X', promo_original_amount: 1000, total_amount: 1000 },
    });
    expect(await resolveOwnerConversionMonthlyPrice(client, 'teacher', 't1')).toEqual({
      monthly: 1000,
      planKey: 'teacher_pro',
      promoFraction: 0,
    });
  });

  it('returns null when the owner has no price row', async () => {
    expect(await resolveOwnerConversionMonthlyPrice(makeClient({}), 'teacher', 't1')).toBeNull();
  });
});
