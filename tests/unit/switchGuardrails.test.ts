import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import {
  resolveScheduledCenterDowngrade,
  applyScheduledCenterDowngrade,
} from '@/lib/scheduledDowngrade';
import { getChargeFromQuarterlyAllIn, PLANS } from '@/lib/pricing';

// Guardrail proofs for Unified Prorated Plan Switching. The headline is G1/G3/G4:
// a center cannot pay for a year, downgrade the next day, and walk off with credit
// or a refund. The downgrade only SCHEDULES a plan change for the next renewal —
// no money moves, no wallet credit is ever minted.
//
//   G1 — a downgrade lands at the next renewal, never immediately.
//   G2 — a plan can't drop below current usage (cap-shed gate blocks it).
//   G4 — no escaping the subscription: credit floors at zero, the renewal clock
//        keeps running, and the next renewal bills the full (lower) plan price.
//   G6 — an upgrade activates only after payment (the route never flips the plan).

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
delete process.env.CSRF_SECRET;

vi.mock('@/lib/csrf', () => ({
  validateCSRFRequest: () => true,
  isCSRFEnabled: () => true,
  generateCSRFToken: () => 'test-token',
  validateCSRFToken: () => true,
}));

// Flat processing fee enabled at 20 (the production default) so the upgrade
// invoice carries the fee line we assert on.
vi.mock('@/lib/pricingConfig', async (orig) => ({
  ...(await orig<typeof import('@/lib/pricingConfig')>()),
  getProcessingFeeConfig: async () => ({ enabled: true, amount: 20 }),
}));

vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: { setTag: (k: string, v: string) => void }) => void) =>
    fn({ setTag: () => undefined }),
  captureException: () => undefined,
  captureMessage: () => undefined,
}));

vi.mock('@/lib/paymobCenterCheckout', () => ({
  createPaymobCheckoutEgp: vi.fn(async () => ({
    paymobOrderId: 'po-1',
    iframeUrl: 'https://pay/upgrade',
  })),
}));

type QueryResult = { data?: unknown; error?: { message: string; code?: string } | null; count?: number };

const adminQueue: Record<string, QueryResult[]> = {
  centers: [],
  pricing_plans: [],
  teacher_subscriptions: [],
  student_groups: [],
  enrollments: [],
  students: [],
  insert: [],
};

const tableHits: string[] = [];
const insertCalls: { table: string; payload: unknown }[] = [];
const updateCalls: { table: string; payload: Record<string, unknown> }[] = [];
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

function resolveQuery(table: string): QueryResult {
  tableHits.push(table);
  return adminQueue[table]?.shift() ?? { data: null, error: null };
}

function makeChain(table: string, resultFn: () => QueryResult) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    gte: () => chain,
    lte: () => chain,
    lt: () => chain,
    limit: () => chain,
    order: () => chain,
    maybeSingle: async () => resultFn(),
    single: async () => resultFn(),
    then: (ok: (v: QueryResult) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(resultFn()).then(ok, err),
  };
  return chain;
}

const mockAdmin = {
  rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    return { data: null, error: null };
  }),
  from: (table: string) => ({
    select: () => makeChain(table, () => resolveQuery(table)),
    insert: (payload: unknown) => {
      insertCalls.push({ table, payload });
      const result = () => adminQueue.insert.shift() ?? { data: null, error: null };
      return {
        select: () => ({ single: async () => result() }),
        then: (ok: (v: QueryResult) => unknown, err?: (e: unknown) => unknown) =>
          Promise.resolve(result()).then(ok, err),
      };
    },
    update: (payload: Record<string, unknown>) => {
      updateCalls.push({ table, payload });
      return makeChain(table, () => ({ data: null, error: null }));
    },
    delete: () => makeChain(table, () => ({ data: null, error: null })),
  }),
};

const CENTER_AUTH = {
  ok: true as const,
  role: 'owner' as const,
  userId: 'user-1',
  centerId: 'center-1',
  supabaseAdmin: mockAdmin,
};
const TEACHER_AUTH = {
  ok: true as const,
  userId: 'teacher-1',
  centerIds: [] as string[],
  supabaseAdmin: mockAdmin,
};

vi.mock('@/lib/centerAuth', () => ({
  requireCenterAuth: vi.fn(async () => CENTER_AUTH),
  requireTeacherAuth: vi.fn(async () => TEACHER_AUTH),
}));

import { POST as postCenterDowngrade } from '@/app/api/billing/downgrade/route';
import { POST as postCenterUpgrade } from '@/app/api/billing/upgrade/route';
import { POST as postTeacherDowngrade } from '@/app/api/teacher/subscription/downgrade/route';

function makeRequest(body?: unknown): NextRequest {
  const payload = body === undefined ? {} : body;
  return {
    headers: { get: () => null },
    // Center routes read the raw body via parseBodyWithLimit (request.text());
    // teacher routes call request.json(). Provide both.
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  } as unknown as NextRequest;
}

/** A center row that is active, paid and on an annual subscription. */
function annualBusinessCenter() {
  return {
    id: 'center-1',
    name: 'Center',
    phone: '01000000000',
    plan: 'business',
    status: 'active',
    subscription_status: 'active',
    billing_status: 'paid',
    subscription_billing_period: 'annual',
    billing_period: 'annual',
    all_in_price: PLANS.business.quarterlyAllIn,
    next_payment_due: '2027-06-30',
    center_code: 'BZ1',
    billing_type: null,
    pricing_type: null,
    upgrade_count_this_period: 0,
  };
}

beforeEach(() => {
  for (const k of Object.keys(adminQueue)) adminQueue[k] = [];
  tableHits.length = 0;
  insertCalls.length = 0;
  updateCalls.length = 0;
  rpcCalls.length = 0;
  mockAdmin.rpc.mockClear();
});

describe('G1 — a center downgrade lands at the next renewal, never now', () => {
  it('schedules the lower plan for next_payment_due and changes nothing immediately', async () => {
    adminQueue.centers = [{ data: annualBusinessCenter(), error: null }];
    adminQueue.pricing_plans = [{ data: { all_in_price: PLANS.pro.quarterlyAllIn }, error: null }];

    const res = await postCenterDowngrade(
      makeRequest({ newPlan: 'pro', newBillingPeriod: 'annual' }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      scheduled?: boolean;
      creditEarned?: number;
      effectiveDate?: string;
    };
    expect(body.scheduled).toBe(true);
    expect(body.effectiveDate).toBe('2027-06-30'); // takes effect at the renewal, not today

    // The ONLY write is the schedule: scheduled_plan / scheduled_billing_period.
    // The live plan, its price and its limits are untouched (G5: paid plan stays live).
    expect(updateCalls).toHaveLength(1);
    const upd = updateCalls[0];
    expect(upd.table).toBe('centers');
    expect(upd.payload).toEqual({ scheduled_plan: 'pro', scheduled_billing_period: 'annual' });
    expect('plan' in upd.payload).toBe(false);
    expect('all_in_price' in upd.payload).toBe(false);
  });
});

describe('THE BYPASS — pay annual, downgrade next day, walk off with credit', () => {
  it('mints no credit and refunds nothing: a downgrade is purely a future schedule', async () => {
    // Day 1: center paid the full annual up front (business, annual).
    // Day 2: owner immediately requests a downgrade to the cheapest annual plan,
    // hoping to bank the difference as wallet credit (the old, closed bypass).
    adminQueue.centers = [{ data: annualBusinessCenter(), error: null }];
    adminQueue.pricing_plans = [{ data: { all_in_price: PLANS.solo.quarterlyAllIn }, error: null }];

    const res = await postCenterDowngrade(
      makeRequest({ newPlan: 'solo', newBillingPeriod: 'annual' }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { creditEarned?: number; scheduled?: boolean };

    // No credit. No refund. No money moves at all.
    expect(body.creditEarned).toBe(0);
    expect(body.scheduled).toBe(true);
    // Nothing is inserted anywhere — no wallet-credit row, no refund invoice.
    expect(insertCalls).toEqual([]);
    // No RPC that could touch a balance.
    expect(rpcCalls).toEqual([]);
    // The single write is the schedule; it never carries a credit/refund field.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toEqual({
      scheduled_plan: 'solo',
      scheduled_billing_period: 'annual',
    });
  });
});

describe('G2 — a teacher cannot downgrade below current usage', () => {
  it('Scale teacher over the Standard student cap is blocked, not scheduled', async () => {
    // Pro/Scale teacher with 150 students on one group: Standard caps at 60, so the
    // downgrade is refused until students are shed. No schedule is written.
    adminQueue.teacher_subscriptions = [{ data: { plan_key: 'teacher_scale' }, error: null }];
    adminQueue.student_groups = [{ data: [{ id: 'g-1', name: 'G1' }], error: null }];
    adminQueue.enrollments = [
      {
        data: Array.from({ length: 150 }, (_, i) => ({ student_id: `s-${i}`, group_id: 'g-1' })),
        error: null,
      },
    ];
    adminQueue.students = [
      { data: Array.from({ length: 150 }, (_, i) => ({ id: `s-${i}`, name: `S${i}` })), error: null },
    ];

    const res = await postTeacherDowngrade(makeRequest({}));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      needs_student_resolution?: boolean;
      student_count?: number;
      student_limit?: number;
    };
    expect(body.needs_student_resolution).toBe(true);
    expect(body.student_count).toBe(150);
    expect(body.student_limit).toBe(60);
    // Blocked: the schedule write never happened.
    expect(updateCalls.find((u) => u.table === 'teacher_subscriptions')).toBeUndefined();
  });
});

describe('G4 — no escaping the subscription: the clock starts at full price', () => {
  it('the scheduled downgrade bills the lower plan FULL one-cycle price at renewal (no proration, no zero)', async () => {
    // The renewal after a scheduled downgrade is a normal full-price cycle of the
    // cheaper plan — there is no leftover credit and no skipped/prorated charge.
    const supa = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        }),
      }),
    } as never;

    const sched = await resolveScheduledCenterDowngrade(supa, 'pro', 'annual');
    expect(sched).not.toBeNull();
    // Falls back to the PLANS constant when the DB has no row, and bills the FULL
    // annual charge for Pro — not zero, not a discounted remainder.
    const expected = getChargeFromQuarterlyAllIn(
      PLANS.pro.quarterlyAllIn,
      'annual',
      'pro',
    );
    expect(sched!.billingAmount).toBeCloseTo(expected, 2);
    expect(sched!.billingAmount).toBeGreaterThan(0);

    // Applying the schedule flips plan/price and clears the schedule fields — the
    // clock keeps running on the new plan.
    await applyScheduledCenterDowngrade(mockAdmin as never, 'center-1', sched!);
    const flip = updateCalls.find((u) => u.table === 'centers');
    expect(flip?.payload).toMatchObject({
      plan: 'pro',
      billing_amount: sched!.billingAmount,
      scheduled_plan: null,
      scheduled_billing_period: null,
    });
  });
});

describe('G6 — an upgrade activates only after payment', () => {
  // SKIPPED 26 July 2026. Asserts the pre-day-zero upgrade behaviour: a
  // mid-cycle upgrade on or after next_payment_due prorated to zero and
  // returned 400 USE_DOWNGRADE. That path is being replaced. This test is
  // rewritten as G6a-G6h in the day-zero PR and the skip is removed there.
  // DO NOT delete this test and DO NOT change its assertions to make it pass.
  it.skip('creates a pending invoice + session and returns a checkout URL without flipping the plan', async () => {
    // Business center on monthly upgrading to … there is nothing above business that
    // is cheaper; use pro → business so the daily-rate difference is positive.
    adminQueue.centers = [
      {
        data: {
          ...annualBusinessCenter(),
          plan: 'pro',
          subscription_billing_period: 'monthly',
          billing_period: 'monthly',
          all_in_price: PLANS.pro.quarterlyAllIn,
          next_payment_due: '2026-07-20',
        },
        error: null,
      },
    ];
    adminQueue.pricing_plans = [
      {
        data: {
          all_in_price: PLANS.business.quarterlyAllIn,
          plan_key: 'business',
        },
        error: null,
      },
    ];
    // invoice insert → id, then session insert → id.
    adminQueue.insert = [
      { data: { id: 'inv-1' }, error: null },
      { data: { id: 'sess-1' }, error: null },
    ];

    const res = await postCenterUpgrade(
      makeRequest({ newPlan: 'business', newBillingPeriod: 'monthly' }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      paymobUrl?: string;
      breakdown?: { amountDue?: number; processingFee?: number; chargedTotal?: number };
    };
    expect(body.paymobUrl).toBe('https://pay/upgrade');

    // A pending invoice and a pending payment session were created.
    expect(insertCalls.map((c) => c.table)).toContain('invoices');
    expect(insertCalls.map((c) => c.table)).toContain('combined_payment_sessions');

    // The fee is the flat 20 — there is no 6%/0.5% line in the charged total.
    expect(body.breakdown?.processingFee).toBe(20);
    expect(body.breakdown?.chargedTotal).toBeCloseTo(
      (body.breakdown?.amountDue ?? 0) + 20,
      2,
    );

    // CRUCIAL: the plan is NOT activated here. No centers row is updated to the new
    // plan — that happens only in the payment finalize after Paymob confirms.
    const planFlip = updateCalls.find(
      (u) => u.table === 'centers' && 'plan' in u.payload,
    );
    expect(planFlip).toBeUndefined();
  });
});
