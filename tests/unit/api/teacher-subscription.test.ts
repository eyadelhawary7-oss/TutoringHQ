import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.SUPER_ADMIN_PHONES = '';
delete process.env.CSRF_SECRET;

const mockGetUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mockGetUser } })),
}));

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };

const queues: Record<string, QueryResult[]> = {};
const insertCalls: { table: string; payload: Record<string, unknown> }[] = [];

function pop(key: string): QueryResult {
  return queues[key]?.shift() ?? { data: null, error: null };
}

const mockAdmin = {
  from: (table: string) => ({
    select: () => {
      const builder = {
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => pop(table),
        then: (
          onFulfilled: (v: QueryResult) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) => Promise.resolve(pop(table)).then(onFulfilled, onRejected),
      };
      return builder;
    },
    insert: (payload: Record<string, unknown>) => {
      insertCalls.push({ table, payload });
      const result = () => pop(`${table}_insert`);
      return {
        select: () => ({ single: async () => result() }),
        then: (
          onFulfilled: (v: QueryResult) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) => Promise.resolve(result()).then(onFulfilled, onRejected),
      };
    },
    delete: () => {
      const del = {
        eq: () => del,
        then: (
          onFulfilled: (v: QueryResult) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) => Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected),
      };
      return del;
    },
  }),
};

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => mockAdmin,
}));

vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn((cb: (scope: { setTag: () => void }) => void) =>
    cb({ setTag: vi.fn() } as never),
  ),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { GET as STATUS } from '@/app/api/teacher/subscription/status/route';
import { POST as RESUBSCRIBE } from '@/app/api/teacher/subscription/resubscribe/route';

const TEACHER_ID = 'teacher-1';

const PLAN_CONFIG = {
  data: {
    value: {
      plan_key: 'teacher_299',
      price_gross: 299,
      price_net: 262.28,
      vat_amount: 36.72,
      trial_days: 14,
    },
  },
  error: null,
};

function seedTeacherAuth(role = 'teacher') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: TEACHER_ID, email: '201000000000@centerhq.local' } },
    error: null,
  });
  queues.users = [{ data: { id: TEACHER_ID, role }, error: null }];
  queues.teacher_center = [{ data: [], error: null }];
}

function makeRequest(method: 'GET' | 'POST', token: string | null = 'tok'): NextRequest {
  return new Request('http://localhost/api/teacher/subscription/x', {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockGetUser.mockReset();
  for (const k of Object.keys(queues)) delete queues[k];
  insertCalls.length = 0;
});

describe('GET /api/teacher/subscription/status', () => {
  it('no teacher_subscriptions row -> has_subscription=false with config price', async () => {
    seedTeacherAuth();
    queues.platform_config = [PLAN_CONFIG];
    queues.teacher_subscriptions = [{ data: null, error: null }];

    const res = await STATUS(makeRequest('GET'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      has_subscription: false,
      status: null,
      plan_key: 'teacher_299',
      price_gross: 299,
      trial_ends_at: null,
      current_period_end: null,
      next_billing_at: null,
      grace_until: null,
      free_months_credit: 0,
    });
  });

  it('active subscription -> full shape with subscription fields', async () => {
    seedTeacherAuth();
    queues.platform_config = [PLAN_CONFIG];
    queues.teacher_subscriptions = [
      {
        data: {
          status: 'active',
          plan_key: 'teacher_299',
          trial_ends_at: '2026-06-01T00:00:00Z',
          current_period_end: '2026-07-01T00:00:00Z',
          next_billing_at: '2026-07-01T00:00:00Z',
          grace_until: null,
          free_months_credit: 2,
        },
        error: null,
      },
    ];

    const res = await STATUS(makeRequest('GET'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      has_subscription: true,
      status: 'active',
      plan_key: 'teacher_299',
      price_gross: 299,
      trial_ends_at: '2026-06-01T00:00:00Z',
      current_period_end: '2026-07-01T00:00:00Z',
      next_billing_at: '2026-07-01T00:00:00Z',
      grace_until: null,
      free_months_credit: 2,
    });
  });
});

describe('POST /api/teacher/subscription/resubscribe', () => {
  it('PAYMOB_ENABLED=false -> 200 { paymob_disabled: true }, NOT an error, no session insert', async () => {
    seedTeacherAuth();
    queues.teacher_subscriptions = [
      { data: { id: 'sub-1', status: 'past_due' }, error: null },
    ];
    queues.platform_config = [PLAN_CONFIG];

    const res = await RESUBSCRIBE(makeRequest('POST'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.paymob_disabled).toBe(true);
    expect(json.amount).toBe(299);
    expect(insertCalls).toHaveLength(0);
  });

  it('trialing/active subscription -> 400 ALREADY_ACTIVE', async () => {
    seedTeacherAuth();
    queues.teacher_subscriptions = [
      { data: { id: 'sub-1', status: 'trialing' }, error: null },
    ];

    const res = await RESUBSCRIBE(makeRequest('POST'));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('ALREADY_ACTIVE');
    expect(insertCalls).toHaveLength(0);
  });

  it('non-teacher role -> 403 NOT_A_TEACHER', async () => {
    seedTeacherAuth('owner');

    const res = await RESUBSCRIBE(makeRequest('POST'));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe('NOT_A_TEACHER');
  });

  it('missing bearer token -> 401', async () => {
    const res = await RESUBSCRIBE(makeRequest('POST', null));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.code).toBe('NO_BEARER');
  });
});
