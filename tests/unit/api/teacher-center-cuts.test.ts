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

// transactions is queried twice in order: paid-this-month, then pending.
const adminQueue: Record<string, AdminQueryResult[]> = {
  users_teacher: [],
  teacher_center: [],
  transactions: [],
  centers: [],
  student_groups: [],
};

const filterCalls: { table: string; method: string; column: string; value: unknown }[] = [];

function resolveQuery(table: string): AdminQueryResult {
  if (table === 'users') {
    return adminQueue.users_teacher.shift() ?? { data: null, error: null };
  }
  if (table === 'teacher_center') {
    return adminQueue.teacher_center.shift() ?? { data: [], error: null };
  }
  const queue = adminQueue[table];
  return queue?.shift() ?? { data: null, error: null };
}

const mockGetSupabaseAdmin = vi.fn(() => ({
  from: (table: string) => {
    const builder = {
      eq: (column: string, value: unknown) => {
        filterCalls.push({ table, method: 'eq', column, value });
        return builder;
      },
      in: (column: string, value: unknown) => {
        filterCalls.push({ table, method: 'in', column, value });
        return builder;
      },
      gte: (column: string, value: unknown) => {
        filterCalls.push({ table, method: 'gte', column, value });
        return builder;
      },
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

import { GET } from '@/app/api/teacher/center-cuts/route';

const VALID_USER = { id: 'user-1' };
const CENTER_A = 'center-a';
const CENTER_B = 'center-b';

function makeRequest(): NextRequest {
  const headers = new Map<string, string>([['Authorization', 'Bearer fake-token']]);
  return {
    headers: { get: (k: string) => headers.get(k) ?? null },
    nextUrl: { searchParams: new URLSearchParams() },
  } as unknown as NextRequest;
}

function queueTeacherAuth(centerIds: string[] = [CENTER_A, CENTER_B]) {
  mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
  adminQueue.users_teacher = [{ data: { id: 'user-1', role: 'teacher' }, error: null }];
  adminQueue.teacher_center = [
    { data: centerIds.map((id) => ({ center_id: id })), error: null },
  ];
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockSentryCaptureException.mockReset();
  mockSentryCaptureMessage.mockReset();
  for (const k of Object.keys(adminQueue)) adminQueue[k] = [];
  filterCalls.length = 0;
});

describe('GET /api/teacher/center-cuts', () => {
  it('non-teacher -> auth failure passes through (403 NOT_A_TEACHER)', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_teacher = [{ data: { id: 'user-1', role: 'owner' }, error: null }];

    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_A_TEACHER');
    // No center-cut data was queried.
    expect(filterCalls.filter((f) => f.table === 'transactions')).toEqual([]);
  });

  it('happy path -> 200, names resolved, cut sums scoped to teacher_id + center_id', async () => {
    queueTeacherAuth([CENTER_A, CENTER_B]);
    // Paid this month: the teacher's take is the whole amount_billed. There is
    // no percentage to apply — the platform takes no share of tuition.
    adminQueue.transactions = [
      {
        data: [
          { center_id: CENTER_A, group_id: 'g1', amount_billed: 200, created_at: '2026-06-05T00:00:00Z' },
          { center_id: CENTER_A, group_id: 'g1', amount_billed: 100, created_at: '2026-06-07T00:00:00Z' },
          { center_id: CENTER_B, group_id: 'g2', amount_billed: 200, created_at: '2026-06-06T00:00:00Z' },
        ],
        error: null,
      },
      // Pending (outstanding)
      {
        data: [
          { center_id: CENTER_A, group_id: 'g1', amount_billed: 100, created_at: '2026-06-08T00:00:00Z' },
        ],
        error: null,
      },
    ];
    adminQueue.centers = [
      { data: [{ id: CENTER_A, name: 'Alpha Center' }, { id: CENTER_B, name: 'Beta Center' }], error: null },
    ];
    adminQueue.student_groups = [
      {
        data: [
          { id: 'g1', name: 'Physics', center_id: CENTER_A },
          { id: 'g2', name: 'Math', center_id: CENTER_B },
        ],
        error: null,
      },
    ];

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      centers: { id: string; name: string; collectedThisMonth: number; outstanding: number; groups: { id: string; collectedThisMonth: number; outstanding: number }[] }[];
      totalCollectedThisMonth: number;
      totalOutstanding: number;
      ledgerRows: number;
    };

    const a = body.centers.find((c) => c.id === CENTER_A)!;
    const b = body.centers.find((c) => c.id === CENTER_B)!;
    expect(a.name).toBe('Alpha Center');
    // 200 + 100 = 300 collected; pending 100.
    expect(a.collectedThisMonth).toBe(300);
    expect(a.outstanding).toBe(100);
    expect(b.name).toBe('Beta Center');
    expect(b.collectedThisMonth).toBe(200);
    expect(b.outstanding).toBe(0);
    expect(body.totalCollectedThisMonth).toBe(500);
    expect(body.totalOutstanding).toBe(100);
    // 3 paid + 1 pending rows were read, so the zero-vs-absence signal is 4.
    expect(body.ledgerRows).toBe(4);

    // Per-group breakdown.
    const g1 = a.groups.find((g) => g.id === 'g1')!;
    expect(g1.collectedThisMonth).toBe(300);
    expect(g1.outstanding).toBe(100);

    // Scoping: both transaction queries filtered teacher_id + center_id IN ids.
    const txnTeacherScopes = filterCalls.filter(
      (f) => f.table === 'transactions' && f.column === 'teacher_id' && f.value === 'user-1',
    );
    expect(txnTeacherScopes.length).toBe(2);
    const txnCenterScopes = filterCalls.filter(
      (f) => f.table === 'transactions' && f.method === 'in' && f.column === 'center_id',
    );
    expect(txnCenterScopes.length).toBe(2);
    expect(txnCenterScopes[0].value).toEqual([CENTER_A, CENTER_B]);
    // is_test=false applied on both.
    expect(filterCalls.filter((f) => f.table === 'transactions' && f.column === 'is_test' && f.value === false).length).toBe(2);
  });

  it('no center memberships -> 200, centers [], totals 0, no queries run', async () => {
    queueTeacherAuth([]);

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { centers: unknown[]; totalCollectedThisMonth: number; totalOutstanding: number; ledgerRows: number };
    expect(body.centers).toEqual([]);
    expect(body.totalCollectedThisMonth).toBe(0);
    expect(body.totalOutstanding).toBe(0);
    // No rows read at all -> absence, not a measured zero.
    expect(body.ledgerRows).toBe(0);
    expect(filterCalls.filter((f) => f.table === 'transactions')).toEqual([]);
  });

  it('CORE headline query errors -> 500 + Sentry exception', async () => {
    queueTeacherAuth([CENTER_A]);
    adminQueue.transactions = [
      { data: null, error: { message: 'db down' } },
    ];

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('server_error');
    expect(mockSentryCaptureException).toHaveBeenCalled();
  });

  it('center-names display query errors -> 200 with name null + Sentry warning (best-effort)', async () => {
    queueTeacherAuth([CENTER_A]);
    adminQueue.transactions = [
      { data: [{ center_id: CENTER_A, group_id: 'g1', amount_billed: 200, created_at: '2026-06-05T00:00:00Z' }], error: null },
      { data: [], error: null },
    ];
    adminQueue.centers = [{ data: null, error: { message: 'centers unavailable' } }];
    adminQueue.student_groups = [{ data: [{ id: 'g1', name: 'Physics', center_id: CENTER_A }], error: null }];

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { centers: { id: string; name: string | null; collectedThisMonth: number }[] };
    expect(body.centers[0].name).toBeNull();
    expect(body.centers[0].collectedThisMonth).toBe(200);
    expect(mockSentryCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining('centre-name lookup failed'),
      'warning',
    );
  });

  it('group-breakdown query errors -> 200 with groups [] + Sentry warning (best-effort)', async () => {
    queueTeacherAuth([CENTER_A]);
    adminQueue.transactions = [
      { data: [{ center_id: CENTER_A, group_id: 'g1', amount_billed: 200, created_at: '2026-06-05T00:00:00Z' }], error: null },
      { data: [], error: null },
    ];
    adminQueue.centers = [{ data: [{ id: CENTER_A, name: 'Alpha' }], error: null }];
    adminQueue.student_groups = [{ data: null, error: { message: 'groups unavailable' } }];

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { centers: { collectedThisMonth: number; groups: unknown[] }[] };
    // Headline numbers survive; breakdown degrades to empty.
    expect(body.centers[0].collectedThisMonth).toBe(200);
    expect(body.centers[0].groups).toEqual([]);
    expect(mockSentryCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining('group-breakdown lookup failed'),
      'warning',
    );
  });
});
