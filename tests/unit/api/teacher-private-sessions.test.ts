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

const adminQueue: Record<string, AdminQueryResult[]> = {
  users_teacher: [],
  teacher_center: [],
  student_groups: [],
  sessions: [],
  enrollments: [],
  students: [],
  attendance_scans: [],
  transactions: [],
  insert: [],
};

const rpcQueues: Record<string, AdminQueryResult[]> = {
  teacher_private_access: [],
  finish_class_and_bill: [],
};
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

const tableHits: string[] = [];
const filterCalls: { table: string; method: string; column: string; value: unknown }[] = [];
const insertCalls: { table: string; payload: Record<string, unknown> }[] = [];
const deleteCalls: { table: string }[] = [];

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

const mockRpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
  rpcCalls.push({ fn, args });
  return rpcQueues[fn]?.shift() ?? { data: null, error: null };
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
      is: (column: string, value: unknown) => {
        filterCalls.push({ table, method: 'is', column, value });
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
        const result = () => adminQueue.insert.shift() ?? { data: null, error: null };
        return {
          select: () => ({ single: async () => result() }),
          then: (
            onFulfilled: (v: AdminQueryResult) => unknown,
            onRejected?: (e: unknown) => unknown,
          ) => Promise.resolve(result()).then(onFulfilled, onRejected),
        };
      },
      delete: () => {
        deleteCalls.push({ table });
        const del = {
          eq: (column: string, value: unknown) => {
            filterCalls.push({ table, method: 'delete_eq', column, value });
            return del;
          },
          then: (
            onFulfilled: (v: AdminQueryResult) => unknown,
            onRejected?: (e: unknown) => unknown,
          ) => Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected),
        };
        return del;
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

import { GET as getSessions, POST as postSession } from '@/app/api/teacher/private/groups/[groupId]/sessions/route';
import { GET as getDetail } from '@/app/api/teacher/private/groups/[groupId]/sessions/[sessionId]/route';
import { POST as postAttendance } from '@/app/api/teacher/private/groups/[groupId]/sessions/[sessionId]/attendance/route';
import { POST as postFinish } from '@/app/api/teacher/private/groups/[groupId]/sessions/[sessionId]/finish/route';

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const STUDENT_ID = '44444444-4444-4444-8444-444444444444';
const VALID_USER = { id: 'user-1' };
const DATA_TABLES = ['student_groups', 'sessions', 'enrollments', 'students', 'attendance_scans', 'transactions'];

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

function groupCtx() {
  return { params: Promise.resolve({ groupId: GROUP_ID }) };
}
function sessionCtx() {
  return { params: Promise.resolve({ groupId: GROUP_ID, sessionId: SESSION_ID }) };
}

function queueTeacherAuthOk() {
  mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
  adminQueue.users_teacher = [
    { data: { id: 'user-1', role: 'teacher' }, error: null },
  ];
  adminQueue.teacher_center = [{ data: [], error: null }];
}

function queueGateGranted() {
  queueTeacherAuthOk();
  rpcQueues.teacher_private_access = [{ data: true, error: null }];
}

function queueGateLapsed() {
  queueTeacherAuthOk();
  rpcQueues.teacher_private_access = [{ data: false, error: null }];
}

const OWNED_GROUP = {
  data: {
    id: GROUP_ID,
    name: 'Physics',
    fee_per_class: 150,
    approval_mode: 'manual',
    status: 'active',
  },
  error: null,
};

const OPEN_SESSION = {
  data: {
    id: SESSION_ID,
    group_id: GROUP_ID,
    kind: 'private',
    scheduled_at: '2026-06-10T10:00:00Z',
    status: 'scheduled',
    billed: false,
    billed_at: null,
    finished_at: null,
  },
  error: null,
};

const BILLED_SESSION = {
  data: { ...(OPEN_SESSION.data as Record<string, unknown>), status: 'finished', billed: true, billed_at: '2026-06-10T12:00:00Z' },
  error: null,
};

beforeEach(() => {
  mockGetUser.mockReset();
  mockRpc.mockClear();
  mockSentryCaptureException.mockReset();
  mockSentryCaptureMessage.mockReset();
  for (const k of Object.keys(adminQueue)) adminQueue[k] = [];
  for (const k of Object.keys(rpcQueues)) rpcQueues[k] = [];
  rpcCalls.length = 0;
  tableHits.length = 0;
  filterCalls.length = 0;
  insertCalls.length = 0;
  deleteCalls.length = 0;
});

describe('GET/POST /sessions (list + record class)', () => {
  it('GET lapsed -> 403, no data query (spine)', async () => {
    queueGateLapsed();

    const res = await getSessions(makeRequest(), groupCtx());

    expect(res.status).toBe(403);
    expect(tableHits.filter((t) => DATA_TABLES.includes(t))).toEqual([]);
  });

  it('GET foreign group -> 404, sessions never read (THE denial)', async () => {
    queueGateGranted();
    adminQueue.student_groups = [{ data: null, error: null }];

    const res = await getSessions(makeRequest(), groupCtx());

    expect(res.status).toBe(404);
    expect(tableHits).not.toContain('sessions');
  });

  it('GET happy -> 200 with counts and billed totals', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.sessions = [
      {
        data: [
          { id: SESSION_ID, scheduled_at: '2026-06-10T10:00:00Z', status: 'finished', billed: true, billed_at: '2026-06-10T12:00:00Z' },
        ],
        error: null,
      },
    ];
    adminQueue.attendance_scans = [
      { data: [{ session_id: SESSION_ID }, { session_id: SESSION_ID }], error: null },
    ];
    adminQueue.transactions = [
      {
        data: [
          { session_id: SESSION_ID, amount_billed: 150 },
          { session_id: SESSION_ID, amount_billed: 150 },
        ],
        error: null,
      },
    ];

    const res = await getSessions(makeRequest(), groupCtx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: Record<string, unknown>[] };
    expect(body.sessions).toEqual([
      {
        id: SESSION_ID,
        scheduled_at: '2026-06-10T10:00:00Z',
        status: 'finished',
        billed: true,
        presentCount: 2,
        billedTotal: 300,
      },
    ]);
    expect(filterCalls).toContainEqual({ table: 'sessions', method: 'eq', column: 'group_id', value: GROUP_ID });
    expect(filterCalls).toContainEqual({ table: 'transactions', method: 'eq', column: 'teacher_id', value: 'user-1' });
  });

  it('POST create happy -> 201, group/kind/creator set server-side', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.insert = [
      {
        data: { id: SESSION_ID, scheduled_at: '2026-06-10T10:00:00Z', status: 'scheduled', billed: false },
        error: null,
      },
    ];

    const res = await postSession(makeRequest({}), groupCtx());

    expect(res.status).toBe(201);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].table).toBe('sessions');
    expect(insertCalls[0].payload).toMatchObject({
      group_id: GROUP_ID,
      kind: 'private',
      created_by: 'user-1',
    });
    expect(typeof insertCalls[0].payload.scheduled_at).toBe('string');
  });

  it('POST create with a future date -> 400 invalid_date, no insert', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];

    const res = await postSession(makeRequest({ scheduled_date: '2030-01-01' }), groupCtx());

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_date');
    expect(insertCalls).toEqual([]);
  });

  it('POST lapsed -> 403, no insert (spine)', async () => {
    queueGateLapsed();

    const res = await postSession(makeRequest({}), groupCtx());

    expect(res.status).toBe(403);
    expect(insertCalls).toEqual([]);
  });
});

describe('GET /sessions/[sessionId] (attendance sheet payload)', () => {
  it('lapsed -> 403 (spine)', async () => {
    queueGateLapsed();

    const res = await getDetail(makeRequest(), sessionCtx());

    expect(res.status).toBe(403);
    expect(tableHits.filter((t) => DATA_TABLES.includes(t))).toEqual([]);
  });

  it('session not in the verified group -> 404 session_not_found, roster never read (THE denial)', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.sessions = [{ data: null, error: null }];

    const res = await getDetail(makeRequest(), sessionCtx());

    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('session_not_found');
    expect(tableHits).not.toContain('enrollments');
  });

  it('ownership CORE read error -> 500, never an error-minted 404', async () => {
    queueGateGranted();
    adminQueue.student_groups = [{ data: null, error: { message: 'db down' } }];

    const res = await getDetail(makeRequest(), sessionCtx());

    expect(res.status).toBe(500);
    expect(mockSentryCaptureException).toHaveBeenCalled();
  });

  it('billed session happy -> roster with present flags + charges', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.sessions = [BILLED_SESSION];
    adminQueue.enrollments = [
      { data: [{ id: 'e1', student_id: STUDENT_ID, payer: 'student' }], error: null },
    ];
    adminQueue.students = [
      { data: [{ id: STUDENT_ID, name: 'Ahmed', phone: '+201012345678' }], error: null },
    ];
    adminQueue.attendance_scans = [
      { data: [{ student_id: STUDENT_ID }], error: null },
    ];
    adminQueue.transactions = [
      { data: [{ student_id: STUDENT_ID, amount_billed: 150, status: 'pending' }], error: null },
    ];

    const res = await getDetail(makeRequest(), sessionCtx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session: { billed: boolean };
      roster: { studentId: string; present: boolean; name: string }[];
      charges: { studentId: string; amount: number; status: string }[];
    };
    expect(body.session.billed).toBe(true);
    expect(body.roster).toEqual([
      { studentId: STUDENT_ID, name: 'Ahmed', payer: 'student', present: true },
    ]);
    expect(body.charges).toEqual([
      { studentId: STUDENT_ID, amount: 150, status: 'pending' },
    ]);
  });
});

describe('POST /attendance (toggle present)', () => {
  const TOGGLE_ON = { student_id: STUDENT_ID, present: true };

  it('lapsed -> 403, no write (spine)', async () => {
    queueGateLapsed();

    const res = await postAttendance(makeRequest(TOGGLE_ON), sessionCtx());

    expect(res.status).toBe(403);
    expect(insertCalls).toEqual([]);
    expect(deleteCalls).toEqual([]);
  });

  it('foreign session -> 404, no write (THE denial)', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.sessions = [{ data: null, error: null }];

    const res = await postAttendance(makeRequest(TOGGLE_ON), sessionCtx());

    expect(res.status).toBe(404);
    expect(insertCalls).toEqual([]);
  });

  it('billed session -> 409 already_billed, sheet frozen', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.sessions = [BILLED_SESSION];

    const res = await postAttendance(makeRequest(TOGGLE_ON), sessionCtx());

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('already_billed');
    expect(insertCalls).toEqual([]);
  });

  it('student without active enrollment in the group -> 404, no write', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.sessions = [OPEN_SESSION];
    adminQueue.enrollments = [{ data: null, error: null }];

    const res = await postAttendance(makeRequest(TOGGLE_ON), sessionCtx());

    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('student_not_in_group');
    expect(insertCalls).toEqual([]);
  });

  it('present=true happy -> billable scan row with server-set scanner identity', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.sessions = [OPEN_SESSION];
    adminQueue.enrollments = [{ data: { id: 'e1' }, error: null }];
    adminQueue.insert = [{ data: null, error: null }];

    const res = await postAttendance(makeRequest(TOGGLE_ON), sessionCtx());

    expect(res.status).toBe(200);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].table).toBe('attendance_scans');
    expect(insertCalls[0].payload).toEqual({
      session_id: SESSION_ID,
      student_id: STUDENT_ID,
      group_id: GROUP_ID,
      center_id: null,
      billable: true,
      status: 'present',
      method: 'confirm',
      scanned_by: 'user-1',
    });
  });

  it('duplicate present tap (23505) is idempotent -> 200', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.sessions = [OPEN_SESSION];
    adminQueue.enrollments = [{ data: { id: 'e1' }, error: null }];
    adminQueue.insert = [
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
    ];

    const res = await postAttendance(makeRequest(TOGGLE_ON), sessionCtx());

    expect(res.status).toBe(200);
  });

  it('present=false -> scan row deleted for session+student', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.sessions = [OPEN_SESSION];
    adminQueue.enrollments = [{ data: { id: 'e1' }, error: null }];

    const res = await postAttendance(
      makeRequest({ student_id: STUDENT_ID, present: false }),
      sessionCtx(),
    );

    expect(res.status).toBe(200);
    expect(deleteCalls).toEqual([{ table: 'attendance_scans' }]);
    expect(filterCalls).toContainEqual({ table: 'attendance_scans', method: 'delete_eq', column: 'session_id', value: SESSION_ID });
    expect(filterCalls).toContainEqual({ table: 'attendance_scans', method: 'delete_eq', column: 'student_id', value: STUDENT_ID });
  });
});

describe('POST /finish (finish_class_and_bill)', () => {
  it('lapsed -> 403, billing fn never called (spine)', async () => {
    queueGateLapsed();

    const res = await postFinish(makeRequest(), sessionCtx());

    expect(res.status).toBe(403);
    expect(rpcCalls.filter((c) => c.fn === 'finish_class_and_bill')).toEqual([]);
  });

  it('foreign session -> 404, billing fn never called (THE denial)', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.sessions = [{ data: null, error: null }];

    const res = await postFinish(makeRequest(), sessionCtx());

    expect(res.status).toBe(404);
    expect(rpcCalls.filter((c) => c.fn === 'finish_class_and_bill')).toEqual([]);
  });

  it('happy -> fn called with (session, auth.userId), billed summary surfaced', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.sessions = [OPEN_SESSION];
    rpcQueues.finish_class_and_bill = [
      { data: [{ session_id: SESSION_ID, billed_now: true, charges_created: 2 }], error: null },
    ];
    adminQueue.transactions = [
      {
        data: [
          { student_id: STUDENT_ID, amount_billed: 150, status: 'pending' },
          { student_id: 'student-2', amount_billed: 150, status: 'pending' },
        ],
        error: null,
      },
    ];

    const res = await postFinish(makeRequest(), sessionCtx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      billedNow: boolean;
      alreadyBilled: boolean;
      chargesCreated: number;
      charges: unknown[];
      total: number;
    };
    expect(body.billedNow).toBe(true);
    expect(body.alreadyBilled).toBe(false);
    expect(body.chargesCreated).toBe(2);
    expect(body.charges).toHaveLength(2);
    expect(body.total).toBe(300);
    expect(rpcCalls.find((c) => c.fn === 'finish_class_and_bill')?.args).toEqual({
      p_session_id: SESSION_ID,
      p_actor_id: 'user-1',
    });
  });

  it('already-billed session -> verified idempotent no-op (billed_now false, zero new charges, fn called exactly once)', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.sessions = [BILLED_SESSION];
    rpcQueues.finish_class_and_bill = [
      { data: [{ session_id: SESSION_ID, billed_now: false, charges_created: 0 }], error: null },
    ];
    adminQueue.transactions = [
      { data: [{ student_id: STUDENT_ID, amount_billed: 150, status: 'pending' }], error: null },
    ];

    const res = await postFinish(makeRequest(), sessionCtx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { alreadyBilled: boolean; chargesCreated: number };
    expect(body.alreadyBilled).toBe(true);
    expect(body.chargesCreated).toBe(0);
    // The mock contract: one rpc call, no second bill possible.
    expect(rpcCalls.filter((c) => c.fn === 'finish_class_and_bill')).toHaveLength(1);
  });

  it('cancelled session -> 409 session_cancelled', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.sessions = [OPEN_SESSION];
    rpcQueues.finish_class_and_bill = [
      { data: null, error: { message: 'cannot bill a cancelled session s', code: '23514' } },
    ];

    const res = await postFinish(makeRequest(), sessionCtx());

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('session_cancelled');
  });

  it('other business 23514 (e.g. no fee) -> 409 cannot_bill', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.sessions = [OPEN_SESSION];
    rpcQueues.finish_class_and_bill = [
      { data: null, error: { message: 'group g has no fee_per_class; cannot bill', code: '23514' } },
    ];

    const res = await postFinish(makeRequest(), sessionCtx());

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('cannot_bill');
  });

  it('unknown fn error (e.g. missing teacher_profile, 23503) -> 500 + Sentry', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.sessions = [OPEN_SESSION];
    rpcQueues.finish_class_and_bill = [
      { data: null, error: { message: 'no teacher_profile for user u; cannot bill group g', code: '23503' } },
    ];

    const res = await postFinish(makeRequest(), sessionCtx());

    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe('server_error');
    expect(mockSentryCaptureException).toHaveBeenCalled();
  });
});
