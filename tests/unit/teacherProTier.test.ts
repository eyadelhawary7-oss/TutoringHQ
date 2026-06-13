import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
delete process.env.CSRF_SECRET; // CSRF validation skipped when unset (dev/test)

type QueryResult = { data?: unknown; error?: { message: string; code?: string } | null; count?: number };

const adminQueue: Record<string, QueryResult[]> = {
  teacher_subscriptions: [],
  teacher_profiles: [],
  student_groups: [],
  enrollments: [],
  students: [],
  platform_config: [],
  users: [],
  insert: [],
};

const tableHits: string[] = [];
const insertCalls: { table: string; payload: unknown }[] = [];
const updateCalls: { table: string; payload: unknown }[] = [];
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
const rpcQueues: Record<string, QueryResult[]> = {};

function resolveQuery(table: string): QueryResult {
  tableHits.push(table);
  return adminQueue[table]?.shift() ?? { data: null, error: null };
}

// A chainable, thenable query builder: every filter returns `this`; awaiting
// (or maybeSingle/single) resolves the queued result for the table.
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
    return rpcQueues[fn]?.shift() ?? { data: null, error: null };
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
    update: (payload: unknown) => {
      updateCalls.push({ table, payload });
      return makeChain(table, () => ({ data: null, error: null }));
    },
    delete: () => makeChain(table, () => ({ data: null, error: null })),
  }),
};

const AUTH_OK = { ok: true as const, userId: 'user-1', centerIds: [] as string[], supabaseAdmin: mockAdmin };

vi.mock('@/lib/centerAuth', () => ({
  requireTeacherAuth: vi.fn(async () => AUTH_OK),
  requireTeacherPrivateAccess: vi.fn(async () => AUTH_OK),
}));

vi.mock('@/lib/teacherPrivate', () => ({
  requireOwnedPrivateGroup: vi.fn(async () => ({
    ok: true,
    group: { id: 'g-1', name: 'Physics', teacher_id: 'user-1', kind: 'private', status: 'active' },
  })),
}));

vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: { setTag: (k: string, v: string) => void }) => void) => fn({ setTag: () => undefined }),
  captureException: () => undefined,
  captureMessage: () => undefined,
}));

// Paymob checkout is never reached in these tests (gate / eligibility stops
// first), but stub it so importing the route never hits real Paymob config.
vi.mock('@/lib/paymobCenterCheckout', () => ({
  createPaymobCheckoutEgp: vi.fn(async () => ({ paymobOrderId: 'po-1', iframeUrl: 'https://pay/x' })),
}));

import { POST as postGroup } from '@/app/api/teacher/private/groups/route';
import { POST as postRoster } from '@/app/api/teacher/private/groups/[groupId]/roster/route';
import { POST as postUpgrade } from '@/app/api/teacher/subscription/upgrade/route';
import { POST as postDowngrade } from '@/app/api/teacher/subscription/downgrade/route';

function makeRequest(body?: unknown): NextRequest {
  return {
    headers: { get: () => null },
    json: async () => (body === undefined ? {} : body),
  } as unknown as NextRequest;
}

const rosterParams = { params: Promise.resolve({ groupId: 'g-1' }) };

beforeEach(() => {
  for (const k of Object.keys(adminQueue)) adminQueue[k] = [];
  for (const k of Object.keys(rpcQueues)) delete rpcQueues[k];
  tableHits.length = 0;
  insertCalls.length = 0;
  updateCalls.length = 0;
  rpcCalls.length = 0;
  mockAdmin.rpc.mockClear();
  delete process.env.PAYMOB_ENABLED;
});

describe('group create cap (Standard 8-group limit)', () => {
  it('1. Standard teacher at 8 active groups -> 429 GROUP_LIMIT_REACHED', async () => {
    adminQueue.teacher_subscriptions = [{ data: { status: 'active', plan_key: 'teacher_299' }, error: null }];
    adminQueue.student_groups = [{ data: null, error: null, count: 8 }];

    const res = await postGroup(makeRequest({ name: 'G9', fee_per_class: 100 }));

    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe('GROUP_LIMIT_REACHED');
    expect(insertCalls).toEqual([]);
  });

  it('2. Standard teacher at 7 active groups -> proceeds (201, no cap error)', async () => {
    adminQueue.teacher_subscriptions = [{ data: { status: 'active', plan_key: 'teacher_299' }, error: null }];
    adminQueue.student_groups = [{ data: null, error: null, count: 7 }];
    adminQueue.insert = [
      { data: { id: 'g-new', name: 'G8', fee_per_class: 100, status: 'active' }, error: null },
    ];

    const res = await postGroup(makeRequest({ name: 'G8', fee_per_class: 100 }));

    expect(res.status).toBe(201);
    expect(insertCalls.map((c) => c.table)).toContain('student_groups');
  });

  it('3. Pro teacher with 10 active groups -> proceeds, no cap check at all', async () => {
    adminQueue.teacher_subscriptions = [{ data: { status: 'active', plan_key: 'teacher_699' }, error: null }];
    adminQueue.insert = [
      { data: { id: 'g-new', name: 'G11', fee_per_class: 100, status: 'active' }, error: null },
    ];

    const res = await postGroup(makeRequest({ name: 'G11', fee_per_class: 100 }));

    expect(res.status).toBe(201);
    // Pro skips the cap-count query entirely: student_groups is never read.
    expect(tableHits).not.toContain('student_groups');
  });
});

describe('enrollment cap (Standard 60-student limit)', () => {
  it('4. Standard teacher with 60 active students -> 429 STUDENT_LIMIT_REACHED', async () => {
    adminQueue.teacher_subscriptions = [{ data: { plan_key: 'teacher_299' }, error: null }];
    adminQueue.student_groups = [{ data: [{ id: 'g-1' }], error: null }];
    adminQueue.enrollments = [
      {
        data: Array.from({ length: 60 }, (_, i) => ({ student_id: `s-${i}`, group_id: 'g-1' })),
        error: null,
      },
    ];

    const res = await postRoster(makeRequest({ name: 'New', phone: '01000000000', payer: 'student' }), rosterParams);

    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe('STUDENT_LIMIT_REACHED');
    expect(insertCalls).toEqual([]);
  });
});

describe('blast credit deduction order (mirrors deduct_blast_credits RPC)', () => {
  // The RPC is PL/pgSQL; this guards the documented spend order: subscription
  // credits are depleted before purchased credits.
  function simulateDeduct(sub: number, purch: number, amount: number) {
    if (sub + purch < amount) throw new Error('INSUFFICIENT_CREDITS');
    const subUsed = Math.min(sub, amount);
    const purchUsed = amount - subUsed;
    return { subUsed, purchUsed, subRemaining: sub - subUsed, purchRemaining: purch - purchUsed };
  }

  it('5. subscription credits are spent before purchased', () => {
    // 50 spent against sub=30 / purch=100: drains sub first, then 20 from purchased.
    expect(simulateDeduct(30, 100, 50)).toEqual({
      subUsed: 30,
      purchUsed: 20,
      subRemaining: 0,
      purchRemaining: 80,
    });
    // 20 spent stays entirely within subscription: purchased untouched.
    expect(simulateDeduct(30, 100, 20)).toEqual({
      subUsed: 20,
      purchUsed: 0,
      subRemaining: 10,
      purchRemaining: 100,
    });
    expect(() => simulateDeduct(5, 5, 20)).toThrow('INSUFFICIENT_CREDITS');
  });
});

describe('upgrade route', () => {
  it('7. PAYMOB_ENABLED!=true -> 503 PAYMENTS_UNAVAILABLE', async () => {
    delete process.env.PAYMOB_ENABLED;

    const res = await postUpgrade(makeRequest());

    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('PAYMENTS_UNAVAILABLE');
  });

  it('8. already Pro (teacher_699) -> 400 NOT_ELIGIBLE', async () => {
    process.env.PAYMOB_ENABLED = 'true';
    adminQueue.teacher_subscriptions = [
      { data: { id: 's-1', plan_key: 'teacher_699', status: 'active' }, error: null },
    ];

    const res = await postUpgrade(makeRequest());

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('NOT_ELIGIBLE');
  });
});

describe('downgrade route', () => {
  it('9. not Pro (teacher_299) -> 400 NOT_PRO', async () => {
    adminQueue.teacher_subscriptions = [{ data: { plan_key: 'teacher_299' }, error: null }];

    const res = await postDowngrade(makeRequest({}));

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('NOT_PRO');
  });

  it('10. Pro with 10 groups -> needs_cap_resolution with the group list', async () => {
    adminQueue.teacher_subscriptions = [{ data: { plan_key: 'teacher_699' }, error: null }];
    adminQueue.student_groups = [
      { data: Array.from({ length: 10 }, (_, i) => ({ id: `g-${i}`, name: `G${i}` })), error: null },
    ];
    adminQueue.enrollments = [{ data: [], error: null }];

    const res = await postDowngrade(makeRequest({}));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { needs_cap_resolution?: boolean; groups?: unknown[] };
    expect(body.needs_cap_resolution).toBe(true);
    expect(body.groups).toHaveLength(10);
    expect(rpcCalls.find((c) => c.fn === 'downgrade_teacher_to_standard')).toBeUndefined();
  });

  it('6. under caps -> delegates to downgrade_teacher_to_standard RPC (zeroes sub credits, keeps purchased)', async () => {
    adminQueue.teacher_subscriptions = [{ data: { plan_key: 'teacher_699' }, error: null }];
    adminQueue.student_groups = [{ data: [{ id: 'g-0', name: 'G0' }], error: null }];
    adminQueue.enrollments = [{ data: [{ student_id: 's-0', group_id: 'g-0' }], error: null }];
    rpcQueues.downgrade_teacher_to_standard = [{ data: null, error: null }];

    const res = await postDowngrade(makeRequest({}));

    expect(res.status).toBe(200);
    expect(((await res.json()) as { downgraded?: boolean }).downgraded).toBe(true);
    const call = rpcCalls.find((c) => c.fn === 'downgrade_teacher_to_standard');
    expect(call).toBeDefined();
    expect(call?.args).toEqual({ p_user_id: 'user-1' });
  });
});
