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

type AdminQueryResult = { data: unknown; error: { message: string; code?: string } | null };

// Queue-per-table mock, sibling of teacher-private-income.test.ts, extended
// with insert support (insertCalls records every payload for the
// server-side-scoping assertions).
const adminQueue: Record<string, AdminQueryResult[]> = {
  users_teacher: [],
  teacher_center: [],
  teacher_subscriptions: [],
  student_groups: [],
  enrollments: [],
  insert: [],
  rpc: [],
};

const tableHits: string[] = [];
const filterCalls: { table: string; method: string; column: string; value: unknown }[] = [];
const insertCalls: { table: string; payload: Record<string, unknown> }[] = [];

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
      in: (column: string, value: unknown) => {
        filterCalls.push({ table, method: 'in', column, value });
        return builder;
      },
      limit: () => builder,
      order: () => builder,
      maybeSingle: async () => resolveQuery(table),
      then: (
        onFulfilled: (v: AdminQueryResult) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => Promise.resolve(resolveQuery(table)).then(onFulfilled, onRejected),
    };
    return {
      select: () => builder,
      insert: (payload: Record<string, unknown>) => {
        insertCalls.push({ table, payload });
        return {
          select: () => ({
            single: async () => adminQueue.insert.shift() ?? { data: null, error: null },
          }),
        };
      },
    };
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

import { GET, POST } from '@/app/api/teacher/private/groups/route';

function makeRequest(body?: unknown): NextRequest {
  const headers = new Map<string, string>([['Authorization', 'Bearer fake-token']]);
  return {
    headers: { get: (k: string) => headers.get(k) ?? null },
    nextUrl: { searchParams: new URLSearchParams() },
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  } as unknown as NextRequest;
}

const VALID_USER = { id: 'user-1' };
const PRIVATE_DATA_TABLES = ['student_groups', 'enrollments'];

function queueTeacherAuthOk() {
  mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
  adminQueue.users_teacher = [
    { data: { id: 'user-1', role: 'teacher' }, error: null },
  ];
  adminQueue.teacher_center = [{ data: [], error: null }];
}

const INSERTED_GROUP = {
  data: { id: 'g-new', name: 'Physics', fee_per_class: 150, status: 'active' },
  error: null,
};

beforeEach(() => {
  mockGetUser.mockReset();
  mockRpc.mockClear();
  mockSentryCaptureException.mockReset();
  mockSentryCaptureMessage.mockReset();
  adminQueue.users_teacher = [];
  adminQueue.teacher_center = [];
  adminQueue.teacher_subscriptions = [];
  adminQueue.student_groups = [];
  adminQueue.enrollments = [];
  adminQueue.insert = [];
  adminQueue.rpc = [];
  tableHits.length = 0;
  filterCalls.length = 0;
  insertCalls.length = 0;
});

describe('GET /api/teacher/private/groups', () => {
  // Spine: the list is private data; lapsed sees nothing.
  it('lapsed teacher -> 403 NO_PRIVATE_ACCESS and no data query runs', async () => {
    queueTeacherAuthOk();
    adminQueue.rpc = [{ data: false, error: null }];

    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NO_PRIVATE_ACCESS');
    expect(tableHits.filter((t) => PRIVATE_DATA_TABLES.includes(t))).toEqual([]);
  });

  it('happy path -> 200 with counts, scoped to teacher_id + kind private', async () => {
    queueTeacherAuthOk();
    adminQueue.rpc = [{ data: true, error: null }];
    adminQueue.student_groups = [
      {
        data: [
          { id: 'g1', name: 'Physics', fee_per_class: 150, status: 'active', created_at: '2026-06-01T00:00:00Z' },
          { id: 'g2', name: 'Math', fee_per_class: '120.5', status: 'active', created_at: '2026-06-02T00:00:00Z' },
        ],
        error: null,
      },
    ];
    adminQueue.enrollments = [
      {
        data: [
          { group_id: 'g1', status: 'active' },
          { group_id: 'g1', status: 'active' },
          { group_id: 'g1', status: 'pending' },
          { group_id: 'g2', status: 'active' },
        ],
        error: null,
      },
    ];

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { groups: Record<string, unknown>[] };
    expect(body.groups).toEqual([
      { id: 'g1', name: 'Physics', fee_per_class: 150, status: 'active', activeStudents: 2, pendingStudents: 1 },
      { id: 'g2', name: 'Math', fee_per_class: 120.5, status: 'active', activeStudents: 1, pendingStudents: 0 },
    ]);
    const sgFilters = filterCalls.filter((f) => f.table === 'student_groups' && f.method === 'eq');
    expect(sgFilters).toContainEqual({ table: 'student_groups', method: 'eq', column: 'teacher_id', value: 'user-1' });
    expect(sgFilters).toContainEqual({ table: 'student_groups', method: 'eq', column: 'kind', value: 'private' });
  });
});

describe('POST /api/teacher/private/groups', () => {
  it('non-teacher -> auth failure passes through, no subscription read, no insert', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
    adminQueue.users_teacher = [
      { data: { id: 'user-1', role: 'owner' }, error: null },
    ];

    const res = await POST(makeRequest({ name: 'Physics', fee_per_class: 150 }));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_A_TEACHER');
    expect(tableHits).not.toContain('teacher_subscriptions');
    expect(insertCalls).toEqual([]);
  });

  it('first-group path: no subscription row -> 201, teacher_id and kind set server-side', async () => {
    queueTeacherAuthOk();
    adminQueue.teacher_subscriptions = [{ data: null, error: null }];
    adminQueue.insert = [INSERTED_GROUP];

    // The body tries to smuggle scoping fields; the server must ignore them.
    const res = await POST(
      makeRequest({
        name: '  Physics  ',
        fee_per_class: 150,
        teacher_id: 'attacker-id',
        kind: 'center',
        center_id: 'victim-center',
      }),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { group: { id: string } };
    expect(body.group.id).toBe('g-new');
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].table).toBe('student_groups');
    expect(insertCalls[0].payload).toEqual({
      name: 'Physics',
      fee_per_class: 150,
      kind: 'private',
      teacher_id: 'user-1',
      approval_mode: 'manual',
    });
  });

  it('trialing subscriber -> allowed (group #2 path)', async () => {
    queueTeacherAuthOk();
    adminQueue.teacher_subscriptions = [{ data: { status: 'trialing' }, error: null }];
    adminQueue.insert = [INSERTED_GROUP];

    const res = await POST(makeRequest({ name: 'Math', fee_per_class: 120.5 }));

    expect(res.status).toBe(201);
    expect(insertCalls).toHaveLength(1);
  });

  // THE denial of this step: lapsed cannot mint a fresh trial via a new group.
  it('suspended subscriber -> 403 RESUBSCRIBE_REQUIRED and insert is NEVER called', async () => {
    queueTeacherAuthOk();
    adminQueue.teacher_subscriptions = [{ data: { status: 'suspended' }, error: null }];

    const res = await POST(makeRequest({ name: 'Physics', fee_per_class: 150 }));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe('Forbidden');
    expect(body.code).toBe('RESUBSCRIBE_REQUIRED');
    expect(insertCalls).toEqual([]);
  });

  it('cancelled subscriber -> 403 RESUBSCRIBE_REQUIRED, no insert', async () => {
    queueTeacherAuthOk();
    adminQueue.teacher_subscriptions = [{ data: { status: 'cancelled' }, error: null }];

    const res = await POST(makeRequest({ name: 'Physics', fee_per_class: 150 }));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('RESUBSCRIBE_REQUIRED');
    expect(insertCalls).toEqual([]);
  });

  // Rule 151: an error reading subscription presence is not a state - never
  // guess (neither allow a possible lapsed teacher nor 403 a new one).
  it('subscription-presence read error -> 500 server_error and insert is never called', async () => {
    queueTeacherAuthOk();
    adminQueue.teacher_subscriptions = [
      { data: null, error: { message: 'db down' } },
    ];

    const res = await POST(makeRequest({ name: 'Physics', fee_per_class: 150 }));

    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('server_error');
    expect(insertCalls).toEqual([]);
    expect(mockSentryCaptureException).toHaveBeenCalled();
  });

  it.each([
    ['missing fee', { name: 'Physics' }],
    ['zero fee', { name: 'Physics', fee_per_class: 0 }],
    ['negative fee', { name: 'Physics', fee_per_class: -5 }],
    ['fee with 3 decimals', { name: 'Physics', fee_per_class: 10.123 }],
    ['fee as string', { name: 'Physics', fee_per_class: '150' }],
  ])('validation: %s -> 400 invalid_fee and insert never called', async (_label, body) => {
    queueTeacherAuthOk();

    const res = await POST(makeRequest(body));

    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('invalid_fee');
    expect(insertCalls).toEqual([]);
  });

  it('validation: missing/blank name -> 400 invalid_name and insert never called', async () => {
    queueTeacherAuthOk();

    const res = await POST(makeRequest({ name: '   ', fee_per_class: 150 }));

    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('invalid_name');
    expect(insertCalls).toEqual([]);
  });
});
