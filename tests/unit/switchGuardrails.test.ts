import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import {
  resolveScheduledCenterPlanChange,
  applyScheduledCenterPlanChange,
} from '@/lib/scheduledPlanChange';
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
  withScope: (fn: (s: { setTag: (k: string, v: string) => void; setLevel: (l: string) => void }) => void) =>
    fn({ setTag: () => undefined, setLevel: () => undefined }),
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
  invoices: [],
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

// Dates computed from `now` on purpose: a hardcoded next_payment_due rots into
// the past and silently changes which branch a test exercises — this is
// exactly what rotted the original G6 test into a false failure.
function ymdFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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

    const sched = await resolveScheduledCenterPlanChange(supa, 'pro', 'annual');
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
    await applyScheduledCenterPlanChange(mockAdmin as never, 'center-1', sched!);
    const flip = updateCalls.find((u) => u.table === 'centers');
    expect(flip?.payload).toMatchObject({
      plan: 'pro',
      billing_amount: sched!.billingAmount,
      scheduled_plan: null,
      scheduled_billing_period: null,
    });
  });
});

describe('interval changes are not upgrades and leave this route', () => {
  it('monthly → annual is rejected and points at checkout, charging nothing', async () => {
    adminQueue.centers = [
      {
        data: {
          ...annualBusinessCenter(),
          plan: 'pro',
          subscription_billing_period: 'monthly',
          billing_period: 'monthly',
          all_in_price: PLANS.pro.quarterlyAllIn,
          next_payment_due: ymdFromNow(20),
        },
        error: null,
      },
    ];

    const res = await postCenterUpgrade(
      makeRequest({ newPlan: 'business', newBillingPeriod: 'annual' }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string; i18nKey?: string };
    expect(body.code).toBe('INTERVAL_SWITCH_AT_CHECKOUT');
    expect(body.i18nKey).toBe('billing.upgrade.intervalSwitchAtCheckout');

    // Rejected before any money or plan state moves.
    expect(insertCalls).toEqual([]);
    expect(updateCalls).toEqual([]);
    expect(rpcCalls).toEqual([]);
    // Rejected before the plan price is even read — no pricing_plans round-trip.
    expect(tableHits).toEqual(['centers']);
  });

  it('annual → monthly is rejected outright, never priced as a proration', async () => {
    adminQueue.centers = [
      { data: { ...annualBusinessCenter(), next_payment_due: ymdFromNow(200) }, error: null },
    ];

    const res = await postCenterUpgrade(
      makeRequest({ newPlan: 'enterprise', newBillingPeriod: 'monthly' }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string; i18nKey?: string };
    expect(body.code).toBe('INTERVAL_CHANGE_NOT_UPGRADE');
    expect(body.i18nKey).toBe('billing.upgrade.intervalChangeNotUpgrade');

    expect(insertCalls).toEqual([]);
    expect(updateCalls).toEqual([]);
    expect(rpcCalls).toEqual([]);
    expect(tableHits).toEqual(['centers']);
  });

  it('same-interval annual → annual tier upgrade is NOT caught by the interval gate', async () => {
    // Guards the gate itself: it must reject only genuine interval CHANGES. An
    // annual center upgrading tier on the annual cadence still prorates.
    adminQueue.centers = [
      {
        data: {
          ...annualBusinessCenter(),
          plan: 'pro',
          // Must track `plan` — annualBusinessCenter() carries the business price,
          // which would make the tier difference zero and trip USE_DOWNGRADE.
          all_in_price: PLANS.pro.quarterlyAllIn,
          next_payment_due: ymdFromNow(200),
        },
        error: null,
      },
    ];
    adminQueue.pricing_plans = [
      { data: { all_in_price: PLANS.business.quarterlyAllIn, plan_key: 'business' }, error: null },
    ];
    adminQueue.insert = [
      { data: { id: 'inv-1' }, error: null },
      { data: { id: 'sess-1' }, error: null },
    ];

    const res = await postCenterUpgrade(
      makeRequest({ newPlan: 'business', newBillingPeriod: 'annual' }),
    );

    expect(res.status).toBe(200);
    // It got past the gate and priced the plan.
    expect(tableHits).toContain('pricing_plans');
    const body = (await res.json()) as { breakdown?: { daysRemaining?: number } };
    expect(body.breakdown?.daysRemaining).toBeGreaterThan(0);
  });
});

describe('G6 — an upgrade activates only after payment', () => {
  // Business, monthly, pro → business throughout: nothing above business is
  // cheaper, so pro → business keeps the daily-rate difference positive for
  // the mid-cycle cases and gives a real full-period price for the day-zero
  // cases. All dates below are computed from `now` — a hardcoded
  // next_payment_due is what rotted the original version of this test.
  function proMonthlyCenter(npd: string, overrides: Record<string, unknown> = {}) {
    return {
      ...annualBusinessCenter(),
      plan: 'pro',
      subscription_billing_period: 'monthly',
      billing_period: 'monthly',
      all_in_price: PLANS.pro.quarterlyAllIn,
      next_payment_due: npd,
      ...overrides,
    };
  }

  const businessPriceRow = { all_in_price: PLANS.business.quarterlyAllIn, plan_key: 'business' };

  it('G6a — mid-cycle (daysRemaining > 0): pending invoice + session, checkout URL, plan NOT flipped', async () => {
    adminQueue.centers = [{ data: proMonthlyCenter(ymdFromNow(20)), error: null }];
    adminQueue.pricing_plans = [{ data: businessPriceRow, error: null }];
    adminQueue.insert = [
      { data: { id: 'inv-1' }, error: null },
      { data: { id: 'sess-1' }, error: null },
    ];

    const res = await postCenterUpgrade(makeRequest({ newPlan: 'business', newBillingPeriod: 'monthly' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      paymobUrl?: string;
      breakdown?: { amountDue?: number; processingFee?: number; chargedTotal?: number };
    };
    expect(body.paymobUrl).toBe('https://pay/upgrade');

    expect(insertCalls.map((c) => c.table)).toEqual(['invoices', 'combined_payment_sessions']);
    expect(body.breakdown?.processingFee).toBe(20);
    expect(body.breakdown?.chargedTotal).toBeCloseTo((body.breakdown?.amountDue ?? 0) + 20, 2);

    // No pending-renewal lookup happens at request time for the mid-cycle path
    // — that reprice happens at PAYMENT time (combinedPaymentFinalize), not here.
    expect(tableHits).toEqual(['centers', 'pricing_plans']);

    // CRUCIAL: the plan is NOT activated here — only at payment finalize.
    expect(updateCalls.find((u) => u.table === 'centers' && 'plan' in u.payload)).toBeUndefined();
  });

  it('G6b — mid-cycle: the per-period quota still applies (day-zero does not bypass it here)', async () => {
    adminQueue.centers = [
      { data: proMonthlyCenter(ymdFromNow(20), { upgrade_count_this_period: 1 }), error: null },
    ];
    adminQueue.pricing_plans = [{ data: businessPriceRow, error: null }];

    const res = await postCenterUpgrade(makeRequest({ newPlan: 'business', newBillingPeriod: 'monthly' }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('Upgrade limit reached');
    expect(insertCalls).toEqual([]);
  });

  it('G6c — day-zero: reprices the EXISTING pending renewal invoice, no proration, no session', async () => {
    adminQueue.centers = [{ data: proMonthlyCenter(ymdFromNow(0)), error: null }];
    adminQueue.pricing_plans = [{ data: businessPriceRow, error: null }];
    // [0] route.ts's own existence check; [1] repriceSubscriptionInvoice's own fetch.
    adminQueue.invoices = [
      { data: { id: 'renewal-inv-1' }, error: null },
      {
        data: {
          id: 'renewal-inv-1',
          center_id: 'center-1',
          invoice_type: 'subscription',
          status: 'pending',
          amount_received: 0,
          processing_fee: 20,
          vat_rate: 0.14,
          metadata: { processing_fee: 20 },
        },
        error: null,
      },
    ];

    const res = await postCenterUpgrade(makeRequest({ newPlan: 'business', newBillingPeriod: 'monthly' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      paymobUrl?: string;
      dayZero?: boolean;
      invoiceId?: string;
      breakdown?: { daysRemaining?: number; amountDue?: number; chargedTotal?: number };
    };
    expect(body.paymobUrl).toBe('https://pay/upgrade');
    expect(body.dayZero).toBe(true);
    expect(body.invoiceId).toBe('renewal-inv-1');
    expect(body.breakdown?.daysRemaining).toBe(0);
    // Full new-tier period price — no proration, no credit.
    expect(body.breakdown?.amountDue).toBeCloseTo(PLANS.business.quarterlyAllIn, 2);

    // No NEW invoice, no session — the EXISTING renewal invoice was repriced (updated).
    expect(insertCalls).toEqual([]);
    expect(updateCalls.some((u) => u.table === 'invoices')).toBe(true);

    // scheduled_plan set — the plan flips only when this (re)priced invoice is paid.
    const sched = updateCalls.find((u) => u.table === 'centers' && 'scheduled_plan' in u.payload);
    expect(sched?.payload).toMatchObject({ scheduled_plan: 'business', scheduled_billing_period: 'monthly' });

    // Never a 400 USE_DOWNGRADE for a paid-up center on its due date — the bug this whole PR fixes.
    expect(res.status).not.toBe(400);
  });

  it('G6d — day-zero: no pending renewal invoice exists (cron outage) — creates one fresh', async () => {
    adminQueue.centers = [{ data: proMonthlyCenter(ymdFromNow(0)), error: null }];
    adminQueue.pricing_plans = [{ data: businessPriceRow, error: null }];
    adminQueue.invoices = [{ data: null, error: null }]; // no existing renewal
    adminQueue.insert = [{ data: { id: 'fresh-renewal-inv' }, error: null }];

    const res = await postCenterUpgrade(makeRequest({ newPlan: 'business', newBillingPeriod: 'monthly' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoiceId?: string; dayZero?: boolean };
    expect(body.dayZero).toBe(true);
    expect(body.invoiceId).toBe('fresh-renewal-inv');

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].table).toBe('invoices');
    expect((insertCalls[0].payload as Record<string, unknown>).invoice_type).toBe('subscription');

    const sched = updateCalls.find((u) => u.table === 'centers' && 'scheduled_plan' in u.payload);
    expect(sched?.payload).toMatchObject({ scheduled_plan: 'business', scheduled_billing_period: 'monthly' });
  });

  it('G6e — day-zero bypasses the per-period quota (contrast with G6b)', async () => {
    adminQueue.centers = [
      { data: proMonthlyCenter(ymdFromNow(0), { upgrade_count_this_period: 1 }), error: null },
    ];
    adminQueue.pricing_plans = [{ data: businessPriceRow, error: null }];
    adminQueue.invoices = [
      { data: { id: 'renewal-inv-1' }, error: null },
      {
        data: {
          id: 'renewal-inv-1',
          center_id: 'center-1',
          invoice_type: 'subscription',
          status: 'pending',
          amount_received: 0,
          processing_fee: 20,
          vat_rate: 0.14,
          metadata: { processing_fee: 20 },
        },
        error: null,
      },
    ];

    const res = await postCenterUpgrade(makeRequest({ newPlan: 'business', newBillingPeriod: 'monthly' }));

    // Quota already at the monthly limit (1) — G6b shows this blocks mid-cycle.
    // Day-zero bypasses it: the period is rolling over regardless.
    expect(res.status).toBe(200);
  });

  it('G6f — day-zero still enforces the rank gate (quota bypass ≠ rank bypass)', async () => {
    adminQueue.centers = [{ data: proMonthlyCenter(ymdFromNow(0)), error: null }];

    const res = await postCenterUpgrade(makeRequest({ newPlan: 'starter', newBillingPeriod: 'monthly' }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('downgrade');
    // Rejected before pricing/invoices are ever touched.
    expect(tableHits).toEqual(['centers']);
    expect(updateCalls).toEqual([]);
  });

  it('G6g — scheduled_plan last-write-wins: a day-zero upgrade overwrites a pending downgrade schedule', async () => {
    adminQueue.centers = [
      {
        data: proMonthlyCenter(ymdFromNow(0), {
          scheduled_plan: 'solo',
          scheduled_billing_period: 'monthly',
        }),
        error: null,
      },
    ];
    adminQueue.pricing_plans = [{ data: businessPriceRow, error: null }];
    adminQueue.invoices = [
      { data: { id: 'renewal-inv-1' }, error: null },
      {
        data: {
          id: 'renewal-inv-1',
          center_id: 'center-1',
          invoice_type: 'subscription',
          status: 'pending',
          amount_received: 0,
          processing_fee: 20,
          vat_rate: 0.14,
          metadata: { processing_fee: 20 },
        },
        error: null,
      },
    ];

    const res = await postCenterUpgrade(makeRequest({ newPlan: 'business', newBillingPeriod: 'monthly' }));

    expect(res.status).toBe(200);
    // The customer's most recent request (this upgrade) wins outright — the
    // schedule write is a plain overwrite, never a merge with the prior 'solo'.
    const sched = updateCalls.find((u) => u.table === 'centers' && 'scheduled_plan' in u.payload);
    expect(sched?.payload).toEqual({ scheduled_plan: 'business', scheduled_billing_period: 'monthly' });
  });

  it('G6h — day-zero reprice refusal (partial payment already received) surfaces as an explicit error, never silent', async () => {
    adminQueue.centers = [{ data: proMonthlyCenter(ymdFromNow(0)), error: null }];
    adminQueue.pricing_plans = [{ data: businessPriceRow, error: null }];
    adminQueue.invoices = [
      { data: { id: 'renewal-inv-1' }, error: null },
      {
        data: {
          id: 'renewal-inv-1',
          center_id: 'center-1',
          invoice_type: 'subscription',
          status: 'pending',
          amount_received: 500, // partial payment already on the renewal invoice
          processing_fee: 20,
          vat_rate: 0.14,
          metadata: { processing_fee: 20 },
        },
        error: null,
      },
    ];

    const res = await postCenterUpgrade(makeRequest({ newPlan: 'business', newBillingPeriod: 'monthly' }));

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('PARTIAL_PAYMENT_RECEIVED');

    // Refused BEFORE scheduling anything — nothing should look "in flight".
    expect(updateCalls.find((u) => u.table === 'centers' && 'scheduled_plan' in u.payload)).toBeUndefined();
  });
});
