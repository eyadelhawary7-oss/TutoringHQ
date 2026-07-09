import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeMrrSnapshot } from '@/lib/mrrSnapshot';
import { getImpliedMonthlyMrr } from '@/lib/pricing';

/** Build a minimal Supabase client mock that returns a fixed list from centers.select('*'). */
function makeSupabaseMock(centers: unknown[]): SupabaseClient {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: centers, error: null }),
    }),
  } as unknown as SupabaseClient;
}

describe('computeMrrSnapshot', () => {
  // ─────────────────────────────────────────────
  // PART 1 – Scenario 1: ELIGIBILITY
  // ─────────────────────────────────────────────
  describe('eligibility filtering', () => {
    it(
      'counts only the eligible paying solo centre; excludes suspended and is_test centres',
      async () => {
        const soloCentre = {
          id: '1',
          plan: 'solo',
          all_in_price: 999,
          billing_period: 'quarterly',
          status: 'active',
          billing_type: 'fixed',
          is_test: false,
          is_early_adopter: false,
          early_adopter_price: null,
        };
        const suspendedCentre = {
          id: '2',
          plan: 'pro',
          all_in_price: 7999,
          billing_period: 'quarterly',
          status: 'suspended',
          billing_type: 'fixed',
          is_test: false,
          is_early_adopter: false,
          early_adopter_price: null,
        };
        const testCentre = {
          id: '3',
          plan: 'nano',
          all_in_price: 1999,
          billing_period: 'quarterly',
          status: 'active',
          billing_type: 'fixed',
          is_test: true,
          is_early_adopter: false,
          early_adopter_price: null,
        };

        const supabase = makeSupabaseMock([soloCentre, suspendedCentre, testCentre]);
        const snapshot = await computeMrrSnapshot(supabase);

        const expectedMrr = getImpliedMonthlyMrr(soloCentre);

        expect(snapshot.total_mrr).toBe(expectedMrr);
        expect(snapshot.active_centers).toBe(1);
      },
    );
  });

  // ─────────────────────────────────────────────
  // PART 1 – Scenario 2: IS_TEST SHORT-CIRCUIT
  // ─────────────────────────────────────────────
  describe('is_test short-circuit (c843bda fix)', () => {
    it(
      'excludes a centre with is_test=true even when status=active — is_test check runs before status check',
      async () => {
        const testActiveCentre = {
          id: '1',
          plan: 'starter',
          all_in_price: 4499,
          billing_period: 'quarterly',
          status: 'active',
          billing_type: 'fixed',
          is_test: true,
          is_early_adopter: false,
          early_adopter_price: null,
        };

        const supabase = makeSupabaseMock([testActiveCentre]);
        const snapshot = await computeMrrSnapshot(supabase);

        expect(snapshot.total_mrr).toBe(0);
        expect(snapshot.active_centers).toBe(0);
      },
    );
  });

  // ─────────────────────────────────────────────
  // PART 1 – Scenario 3: BY_PLAN BREAKDOWN
  // ─────────────────────────────────────────────
  describe('by_plan breakdown', () => {
    it(
      'buckets solo and pro into their respective keys; top_centers stays distinct and is not blended into scaled tiers',
      async () => {
        const soloCentre = {
          id: '1',
          plan: 'solo',
          all_in_price: 999,
          billing_period: 'quarterly',
          status: 'active',
          billing_type: 'fixed',
          is_test: false,
          is_early_adopter: false,
          early_adopter_price: null,
        };
        const proCentre = {
          id: '2',
          plan: 'pro',
          all_in_price: 7999,
          billing_period: 'quarterly',
          status: 'active',
          billing_type: 'fixed',
          is_test: false,
          is_early_adopter: false,
          early_adopter_price: null,
        };
        const topCentre = {
          id: '3',
          plan: 'top_centers',
          all_in_price: 25_000,
          billing_period: 'quarterly',
          status: 'active',
          billing_type: 'fixed',
          is_test: false,
          is_early_adopter: false,
          early_adopter_price: null,
        };

        const supabase = makeSupabaseMock([soloCentre, proCentre, topCentre]);
        const snapshot = await computeMrrSnapshot(supabase);

        const soloMrr = getImpliedMonthlyMrr(soloCentre);
        const proMrr = getImpliedMonthlyMrr(proCentre);
        const topMrr = getImpliedMonthlyMrr(topCentre);

        expect(snapshot.by_plan['solo'].count).toBe(1);
        expect(snapshot.by_plan['solo'].mrr).toBe(soloMrr);

        expect(snapshot.by_plan['pro'].count).toBe(1);
        expect(snapshot.by_plan['pro'].mrr).toBe(proMrr);

        // top_centers lives in its own bucket, not blended into solo or pro
        expect(snapshot.by_plan['top_centers'].count).toBe(1);
        expect(snapshot.by_plan['top_centers'].mrr).toBe(topMrr);

        // Confirm the scaled-tier buckets only contain their own centres
        expect(snapshot.by_plan['solo'].count).toBe(1);
        expect(snapshot.by_plan['pro'].count).toBe(1);
        expect(snapshot.active_centers).toBe(3);
      },
    );
  });

  // ─────────────────────────────────────────────
  // PART 1 – Scenario 5: DAILY IDEMPOTENCY
  // ─────────────────────────────────────────────
  // Note: computeMrrSnapshot is a pure read+compute function — it does not call
  // upsert/insert on mrr_snapshots. Therefore idempotency is verified by calling
  // the function twice and asserting deep equality of the returned objects.
  // The task brief referenced "upsert mock's captured args" but no such write
  // exists in the function; this deviation is documented in the final summary.
  describe('determinism / idempotency', () => {
    it(
      'calling computeMrrSnapshot twice with the same centre list produces identical output',
      async () => {
        const centres = [
          {
            id: '1',
            plan: 'solo',
            all_in_price: 999,
            billing_period: 'quarterly',
            status: 'active',
            billing_type: 'fixed',
            is_test: false,
            is_early_adopter: false,
            early_adopter_price: null,
          },
          {
            id: '2',
            plan: 'pro',
            all_in_price: 7999,
            billing_period: 'quarterly',
            status: 'active',
            billing_type: 'fixed',
            is_test: false,
            is_early_adopter: false,
            early_adopter_price: null,
          },
        ];

        const selectMock = vi.fn().mockResolvedValue({ data: centres, error: null });
        const fromMock = vi.fn().mockReturnValue({ select: selectMock });
        const supabase = { from: fromMock } as unknown as SupabaseClient;

        const result1 = await computeMrrSnapshot(supabase);
        const result2 = await computeMrrSnapshot(supabase);

        expect(result1).toEqual(result2);
        // Each computeMrrSnapshot call triggers exactly one from()/select() pair
        expect(fromMock).toHaveBeenCalledTimes(2);
        expect(selectMock).toHaveBeenCalledTimes(2);
      },
    );
  });
});
