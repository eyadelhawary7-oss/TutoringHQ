import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveOwnerMonthlyPrice,
  resolveOwnerConversionMonthlyPrice,
} from '@/lib/commission/ownerFinancials';
import { recomputeT2Amount } from '@/lib/commission/tierUnlock';
import { computeRepCommission, computeT2AtCurrentPrice } from '@/lib/commission/rates';

/**
 * Money invariant 16 (Eyad 2026-07-16): promos are SIGNUP-ONLY, never on a renewal.
 *
 * That is what makes the split referral commission correct even though the rule is invisible
 * in the code:
 *   - T1 (first half, at conversion) comes off the POST-promo price actually paid → a signup
 *     promo REDUCES it.
 *   - T2 (second half, recomputed by the cron at the 6-month mark) comes off the CURRENT
 *     STANDING price → it is deliberately promo-UNAWARE, because by then the one-time signup
 *     promo no longer applies and the customer is paying full price.
 *
 * These tests pin that asymmetry. If a future change ever let a promo apply to a renewal (or
 * made the T2 recompute promo-aware), T1 and T2 would stop diverging the way they must, and
 * these tests break LOUDLY — the signal that the T2 commission base needs fixing first.
 */

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

const cand = () => ({
  id: 'x',
  staff_id: 's',
  commission_type: 'self_sourced',
  ownerType: 'teacher' as const,
  ownerId: 't1',
  firstPaymentDate: '2026-01-01',
  activeDays: 200,
});

describe('invariant 16 — a signup promo reduces ONLY T1; T2 recomputes at the standing price', () => {
  it('teacher with a 10% signup promo: T1 base is post-promo, T2 base stays full standing', async () => {
    // Standing monthly = 1000; the first paid invoice carried a 10% promo (1000 → 900).
    const client = makeClient({
      teacher_subscriptions: { plan_key: 'teacher_pro', price_gross: 1000 },
      invoices: { promo_code: 'SIGNUP10', promo_original_amount: 1000, total_amount: 900 },
    });

    const standing = await resolveOwnerMonthlyPrice(client, 'teacher', 't1');
    const conversion = await resolveOwnerConversionMonthlyPrice(client, 'teacher', 't1');

    // Standing (the T2 base source) is UNTOUCHED by the promo; conversion (the T1 base) is reduced.
    expect(standing?.monthly).toBe(1000);
    expect(conversion?.monthly).toBe(900);
    expect(conversion?.promoFraction).toBeCloseTo(0.1, 10);

    // T1 comes off the post-promo 900; T2 (the real cron recompute) comes off the full 1000.
    const t1 = computeRepCommission(conversion?.monthly ?? 0).t1; // 20% of 900 ÷ 2 = 90
    const t2 = await recomputeT2Amount(client, cand()); // 20% of 1000 ÷ 2 = 100
    expect(t1).toBe(90);
    expect(t2).toBe(100);

    // The whole point: the signup promo pushed T1 BELOW T2. If a promo ever leaked into the T2
    // recompute (or into a renewal), t2 would drop to 90 and this breaks.
    expect(t1).toBeLessThan(t2);
    expect(t2).toBe(computeT2AtCurrentPrice(1000)); // promo-blind, full standing price
  });

  it('control — with NO promo, T1 and T2 are equal (both halves off the same standing price)', async () => {
    const client = makeClient({
      teacher_subscriptions: { plan_key: 'teacher_pro', price_gross: 1000 },
      // no invoices row → no promo
    });

    const conversion = await resolveOwnerConversionMonthlyPrice(client, 'teacher', 't1');
    const t1 = computeRepCommission(conversion?.monthly ?? 0).t1; // 20% of 1000 ÷ 2 = 100
    const t2 = await recomputeT2Amount(client, cand()); // 100

    expect(conversion?.monthly).toBe(1000);
    expect(conversion?.promoFraction).toBe(0);
    expect(t1).toBe(t2); // no promo → the two halves match; the asymmetry above is caused ONLY by the promo
  });
});
