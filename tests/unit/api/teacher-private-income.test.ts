import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.SUPER_ADMIN_PHONES = '';

const mockGetUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
}));

type AdminQueryResult = { data: unknown; error: { message: string } | null };

// Queue-per-table mock, sibling of teacher-context-route.test.ts. The route
// runs the REAL requireTeacherPrivateAccess (users + teacher_center + rpc),
// then its own data selects. `transactions` is consulted three times in
// order: paid-this-month, pending, recent-activity.
const adminQueue: Record<string, AdminQueryResult[]> = {
  users_teacher: [],
  teacher_center: [],
  student_groups: [],
  transactions: [],
  ar_by_teacher: [],
  rpc: [],
};

// Which tables were actually queried (gate-refusal tests assert NO data
// table is touched) and every filter arg (tenant-scoping assertions).
const tableHits: string[] = [];
const filterCalls: { table: string; method: string; column: string; value: unknown }[] = [];

function resolveQuery(table: string): AdminQueryResult {
  tableHits.push(table);
  if (table === 'users') {
    return adminQueue.users_teacher.shift() ?? { data: null, error: null };
  }
  if (table === 'teacher_center') {
    return adminQueue.teacher_center.shift() ?? { data: [], error: null };
  }
  const queue = adminQueue[table];
  return queue?.shift() ?? { data: null, error: null };
}

const mockRpc = vi.fn(async () => {
  return adminQueue.rpc.shift() ?? { data: null, error: null };
});

const mockGetSupabaseAdmin = vi.fn(() => ({
  rpc: mockRpc,
  from: (table: string) => {
    const builder = {
      eq: (column: string, value: unknown) => {
        filterCalls.push({ table, method: 'eq', column, value });
        return builder;
      },
      gte: (column: string, value: unknown) => {
        filterCalls.push({ table, method: 'gte', column, value });
        return builder;
      },
      in: (column: string, value: unknown) => {
        filterCalls.push({ table, method: 'in', column, value });
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => resolveQuery(table),
      then: (
        onFulfilled: (v: AdminQueryResult) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => Promise.resolve(resolveQuery(table)).then(onFulfilled, onRejected),
    };
    return { select: () => builder };
  },
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => mockGetSupabaseAdmin(),
}));

const mockSentryCaptureException = vi.fn();
const mockSentryCaptureMessage = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: { setTag: (k: string, v: string) => void }) => void) => {
    fn({ setTag: () => undefined });
  },
  captureException: (err: unknown) => mockSentryCaptureException(err),
  captureMessage: (msg: string, level?: string) => mockSentryCaptureMessage(msg, level),
}));

import { GET } from '@/app/api/teacher/private/income/route';

function makeRequest(): NextRequest {
  const headers = new Map<string, string>([['Authorization', 'Bearer fake-token']]);
  return {
    headers: { get: (k: string) => headers.get(k) ?? null },
    nextUrl: { searchParams: new URLSearchParams() },
  } as unknown as NextRequest;
}

const VALID_USER = { id: 'user-1' };
const DATA_TABLES = ['student_groups', 'transactions', 'ar_by_teacher'];

function queueTeacherAuthOk() {
  mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
  adminQueue.users_teacher = [
    { data: { id: 'user-1', role: 'teacher' }, error: null },
  ];
  adminQueue.teacher_center = [{ data: [], error: null }];
}

function queueGateGranted() {
  queueTeacherAuthOk();
  adminQueue.rpc = [{ data: true, error: null }];
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockRpc.mockClear();
  mockSentryCaptureException.mockReset();
  mockSentryCaptureMessage.mockReset();
  adminQueue.users_teacher = [];
  adminQueue.teacher_center = [];
  adminQueue.student_groups = [];
  adminQueue.transactions = [];
  adminQueue.ar_by_teacher = [];
  adminQueue.rpc = [];
  tableHits.length = 0;
  filterCalls.length = 0;
});

describe('GET /api/teacher/private/income', () => {
  // THE spine test: the gate refuses a lapsed teacher BEFORE any income data
  // is queried.
  it('lapsed teacher calling directly -> 403 NO_PRIVATE_ACCESS and no data query runs', async () => {
    queueTeacherAuthOk();
    adminQueue.rpc = [{ data: false, error: null }];

    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe('Forbidden');
    expect(body.code).toBe('NO_PRIVATE_ACCESS');
    expect(tableHits.filter((t) => DATA_TABLES.includes(t))).toEqual([]);
  });

  it('gate RPC error -> 500 GATE_CHECK_FAILED and no data query runs', async () => {
    queueTeacherAuthOk();
    adminQueue.rpc = [{ data: null, error: { message: 'db down' } }];

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('GATE_CHECK_FAILED');
    expect(tableHits.filter((t) => DATA_TABLES.includes(t))).toEqual([]);
    expect(mockSentryCaptureException).toHaveBeenCalled();
  });

  it('happy path -> 200 contract shape with teacher_id scoping on every data query', async () => {
    queueGateGranted();
    adminQueue.student_groups = [
      {
        data: [
          { id: 'g1', name: 'Physics 3rd Sec' },
          { id: 'g2', name: 'Math 2nd Sec' },
        ],
        error: null,
      },
    ];
    adminQueue.transactions = [
      // paid this month
      {
        data: [
          { group_id: 'g1', amount_billed: 200 },
          { group_id: 'g1', amount_billed: 100 },
          { group_id: 'g2', amount_billed: 50 },
        ],
        error: null,
      },
      // pending
      {
        data: [
          { group_id: 'g1', amount_billed: 75 },
          { group_id: 'g2', amount_billed: 25.5 },
        ],
        error: null,
      },
      // recent activity: two attendees of the same session fold into one row
      {
        data: [
          {
            id: 'tx-1',
            session_id: 's1',
            group_id: 'g1',
            amount_billed: 200,
            created_at: '2026-06-09T10:00:00Z',
          },
          {
            id: 'tx-2',
            session_id: 's1',
            group_id: 'g1',
            amount_billed: 100,
            created_at: '2026-06-09T10:00:01Z',
          },
          {
            id: 'tx-3',
            session_id: 's2',
            group_id: 'g2',
            amount_billed: 50,
            created_at: '2026-06-08T16:00:00Z',
          },
        ],
        error: null,
      },
    ];
    adminQueue.ar_by_teacher = [
      { data: { total_outstanding: 80.5 }, error: null },
    ];

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      collectedThisMonth: number;
      outstanding: number;
      groups: { id: string; collectedThisMonth: number; outstanding: number }[];
      recentActivity: { sessionId: string; amountBilled: number; groupName: string | null }[];
    };
    expect(body.collectedThisMonth).toBe(350);
    // Headline outstanding comes from the credit-aware ar_by_teacher view.
    expect(body.outstanding).toBe(80.5);
    expect(body.groups).toEqual([
      { id: 'g1', name: 'Physics 3rd Sec', collectedThisMonth: 300, outstanding: 75 },
      { id: 'g2', name: 'Math 2nd Sec', collectedThisMonth: 50, outstanding: 25.5 },
    ]);
    expect(body.recentActivity).toHaveLength(2);
    expect(body.recentActivity[0]).toMatchObject({
      sessionId: 's1',
      amountBilled: 300,
      groupName: 'Physics 3rd Sec',
    });
    expect(body.recentActivity[1]).toMatchObject({ sessionId: 's2', amountBilled: 50 });

    // TENANT SCOPING: every data query filtered to the authenticated teacher.
    for (const table of DATA_TABLES) {
      const scoping = filterCalls.filter(
        (f) => f.table === table && f.method === 'eq' && f.column === 'teacher_id',
      );
      expect(scoping.length).toBeGreaterThan(0);
      for (const f of scoping) expect(f.value).toBe('user-1');
    }
    // The transactions table is queried three times, each teacher-scoped.
    expect(
      filterCalls.filter(
        (f) => f.table === 'transactions' && f.column === 'teacher_id' && f.value === 'user-1',
      ),
    ).toHaveLength(3);
  });

  it('CORE query error (private groups) -> 500 server_error + Sentry, not empty-data-200', async () => {
    queueGateGranted();
    adminQueue.student_groups = [
      { data: null, error: { message: 'connection refused' } },
    ];

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('server_error');
    expect(mockSentryCaptureException).toHaveBeenCalled();
  });

  it('CORE query error (ar_by_teacher headline) -> 500 server_error + Sentry', async () => {
    queueGateGranted();
    adminQueue.student_groups = [{ data: [], error: null }];
    adminQueue.transactions = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    adminQueue.ar_by_teacher = [
      { data: null, error: { message: 'view unavailable' } },
    ];

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('server_error');
    expect(mockSentryCaptureException).toHaveBeenCalled();
  });

  it('empty practice -> 200 with zeroed/empty contract (UI empty state derives from data, not error)', async () => {
    queueGateGranted();
    adminQueue.student_groups = [{ data: [], error: null }];
    adminQueue.transactions = [
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ];
    // A teacher with no transactions has no ar_by_teacher row at all.
    adminQueue.ar_by_teacher = [{ data: null, error: null }];

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      collectedThisMonth: 0,
      outstanding: 0,
      methodBreakdown: { cash: 0, instapay: 0, vodafone_cash: 0, other: 0 },
      groups: [],
      recentActivity: [],
    });
  });

  it('recent-activity error is best-effort -> 200 with activity [] + Sentry warning', async () => {
    queueGateGranted();
    adminQueue.student_groups = [
      { data: [{ id: 'g1', name: 'Physics 3rd Sec' }], error: null },
    ];
    adminQueue.transactions = [
      { data: [{ group_id: 'g1', amount_billed: 200 }], error: null },
      { data: [], error: null },
      { data: null, error: { message: 'timeout' } },
    ];
    adminQueue.ar_by_teacher = [{ data: { total_outstanding: 0 }, error: null }];

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      collectedThisMonth: number;
      recentActivity: unknown[];
    };
    expect(body.collectedThisMonth).toBe(200);
    expect(body.recentActivity).toEqual([]);
    expect(mockSentryCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining('recent-activity lookup failed'),
      'warning',
    );
  });
});
