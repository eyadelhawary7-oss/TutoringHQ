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
  schedule_exceptions: [],
  sessions: [],
  enrollments: [],
  students: [],
  attendance_scans: [],
  transactions: [],
  teacher_subscriptions: [],
  insert: [],
};

const rpcQueues: Record<string, AdminQueryResult[]> = {
  apply_session_transition: [],
  finish_class_and_bill: [],
  apply_transaction_transition: [],
};
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

const tableHits: string[] = [];
const insertCalls: { table: string; payload: unknown }[] = [];
const deleteCalls: { table: string }[] = [];
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

const mockRpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
  rpcCalls.push({ fn, args });
  return rpcQueues[fn]?.shift() ?? { data: null, error: null };
});

const mockGetSupabaseAdmin = vi.fn(() => ({
  rpc: mockRpc,
  from: (table: string) => {
    const builder = {
      eq: () => builder,
      in: () => builder,
      is: () => builder,
      gte: () => builder,
      lte: () => builder,
      lt: () => builder,
      limit: () => builder,
      order: () => builder,
      maybeSingle: async () => resolveQuery(table),
      single: async () => resolveQuery(table),
      then: (
        onFulfilled: (v: AdminQueryResult) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => Promise.resolve(resolveQuery(table)).then(onFulfilled, onRejected),
    };
    return {
      select: () => builder,
      insert: (payload: unknown) => {
        insertCalls.push({ table, payload });
        const result = () => adminQueue.insert.shift() ?? { data: null, error: null };
        return {
          select: () => ({ single: async () => result(), then: (
            onFulfilled: (v: AdminQueryResult) => unknown,
            onRejected?: (e: unknown) => unknown,
          ) => Promise.resolve(result()).then(onFulfilled, onRejected) }),
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
          in: (column: string, value: unknown) => {
            filterCalls.push({ table, method: 'delete_in', column, value });
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

import { POST as postStart } from '@/app/api/teacher/private/schedule/sessions/start/route';
import { PATCH as patchAttendance } from '@/app/api/teacher/private/schedule/sessions/[sessionId]/attendance/route';
import { POST as postFinish } from '@/app/api/teacher/private/schedule/sessions/[sessionId]/finish/route';

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const SCHEDULE_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const STUDENT_ID = '44444444-4444-4444-8444-444444444444';
const NEW_ID = '55555555-5555-4555-8555-555555555555';
const CUR1_ID = '66666666-6666-4666-8666-666666666666';
const CUR2_ID = '77777777-7777-4777-8777-777777777777';
const VALID_USER = { id: 'user-1' };

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

function sessionCtx() {
  return { params: Promise.resolve({ sessionId: SESSION_ID }) };
}

function queueTeacherAuthOk() {
  mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
  adminQueue.users_teacher = [{ data: { id: 'user-1', role: 'teacher' }, error: null }];
  adminQueue.teacher_center = [{ data: [], error: null }];
}

const OWNED_GROUP = {
  data: { id: GROUP_ID, teacher_id: 'user-1', center_id: null, kind: 'private', status: 'active' },
  error: null,
};
const FOREIGN_GROUP = {
  data: { id: GROUP_ID, teacher_id: 'someone-else', center_id: null, kind: 'private', status: 'active' },
  error: null,
};

function startBody(overrides: Record<string, unknown> = {}) {
  return {
    group_id: GROUP_ID,
    schedule_id: SCHEDULE_ID,
    session_date: '2026-06-10',
    ...overrides,
  };
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockRpc.mockClear();
  mockSentryCaptureException.mockReset();
  mockSentryCaptureMessage.mockReset();
  for (const k of Object.keys(adminQueue)) adminQueue[k] = [];
  for (const k of Object.keys(rpcQueues)) rpcQueues[k] = [];
  rpcCalls.length = 0;
  tableHits.length = 0;
  insertCalls.length = 0;
  deleteCalls.length = 0;
  filterCalls.length = 0;
});

describe('POST /sessions/start', () => {
  it('422 for a future session_date, no session created', async () => {
    queueTeacherAuthOk();

    const res = await postStart(makeRequest(startBody({ session_date: '2999-01-01' })));

    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('FUTURE_DATE');
    expect(insertCalls).toEqual([]);
    expect(rpcCalls.filter((c) => c.fn === 'apply_session_transition')).toEqual([]);
  });

  it('403 when the group belongs to another teacher, no session created', async () => {
    queueTeacherAuthOk();
    adminQueue.student_groups = [FOREIGN_GROUP];

    const res = await postStart(makeRequest(startBody()));

    expect(res.status).toBe(403);
    expect(insertCalls).toEqual([]);
    expect(rpcCalls.filter((c) => c.fn === 'apply_session_transition')).toEqual([]);
  });

  it('existing live session -> 200 already_started with current attendees', async () => {
    queueTeacherAuthOk();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.schedule_exceptions = [{ data: null, error: null }];
    adminQueue.sessions = [{ data: [{ id: SESSION_ID, status: 'live' }], error: null }];
    adminQueue.attendance_scans = [{ data: [{ student_id: STUDENT_ID }], error: null }];

    const res = await postStart(makeRequest(startBody()));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session_id: string;
      status: string;
      already_started: boolean;
      attendees: string[];
    };
    expect(body).toEqual({
      session_id: SESSION_ID,
      status: 'live',
      already_started: true,
      attendees: [STUDENT_ID],
    });
    // Resuming never creates a session nor transitions status.
    expect(insertCalls).toEqual([]);
    expect(rpcCalls.filter((c) => c.fn === 'apply_session_transition')).toEqual([]);
  });

  it('existing finished session -> 409 SESSION_ALREADY_FINISHED', async () => {
    queueTeacherAuthOk();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.schedule_exceptions = [{ data: null, error: null }];
    adminQueue.sessions = [{ data: [{ id: SESSION_ID, status: 'finished' }], error: null }];

    const res = await postStart(makeRequest(startBody()));

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('SESSION_ALREADY_FINISHED');
    expect(insertCalls).toEqual([]);
  });
});

describe('PATCH /sessions/[sessionId]/attendance', () => {
  it('409 session_not_live when the session is not live, no write', async () => {
    queueTeacherAuthOk();
    adminQueue.sessions = [
      { data: { id: SESSION_ID, group_id: GROUP_ID, status: 'finished' }, error: null },
    ];
    adminQueue.student_groups = [OWNED_GROUP];

    const res = await patchAttendance(
      makeRequest({ attendee_ids: [STUDENT_ID] }),
      sessionCtx(),
    );

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('session_not_live');
    expect(insertCalls).toEqual([]);
    expect(deleteCalls).toEqual([]);
  });

  it('computes the add/remove diff and applies it', async () => {
    queueTeacherAuthOk();
    adminQueue.sessions = [
      { data: { id: SESSION_ID, group_id: GROUP_ID, status: 'live' }, error: null },
    ];
    adminQueue.student_groups = [OWNED_GROUP];
    // Current scans: CUR1, CUR2.
    adminQueue.attendance_scans = [
      { data: [{ student_id: CUR1_ID }, { student_id: CUR2_ID }], error: null },
    ];
    // NEW_ID is an active enrollment (the only freshly-added id).
    adminQueue.enrollments = [{ data: [{ student_id: NEW_ID }], error: null }];

    // Desired list: keep CUR1, add NEW_ID, drop CUR2.
    const res = await patchAttendance(
      makeRequest({ attendee_ids: [CUR1_ID, NEW_ID] }),
      sessionCtx(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      added: number;
      removed: number;
      total: number;
      created_guests: unknown[];
    };
    expect(body).toEqual({ added: 1, removed: 1, total: 2, created_guests: [] });
    // One insert (NEW_ID) and one delete (CUR2_ID) against attendance_scans.
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].table).toBe('attendance_scans');
    expect(deleteCalls).toEqual([{ table: 'attendance_scans' }]);
    expect(filterCalls).toContainEqual({
      table: 'attendance_scans',
      method: 'delete_in',
      column: 'student_id',
      value: [CUR2_ID],
    });
  });
});

describe('POST /sessions/[sessionId]/finish', () => {
  it('403 when the session group belongs to another teacher, billing fn never called', async () => {
    queueTeacherAuthOk();
    adminQueue.sessions = [
      { data: { id: SESSION_ID, group_id: GROUP_ID, status: 'live' }, error: null },
    ];
    adminQueue.student_groups = [FOREIGN_GROUP];

    const res = await postFinish(makeRequest({ payment_method: 'cash' }), sessionCtx());

    expect(res.status).toBe(403);
    expect(rpcCalls.filter((c) => c.fn === 'finish_class_and_bill')).toEqual([]);
  });

  it('409 session_not_live when the session is not live, billing fn never called', async () => {
    queueTeacherAuthOk();
    adminQueue.sessions = [
      { data: { id: SESSION_ID, group_id: GROUP_ID, status: 'scheduled' }, error: null },
    ];
    adminQueue.student_groups = [OWNED_GROUP];

    const res = await postFinish(makeRequest({ payment_method: 'cash' }), sessionCtx());

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('session_not_live');
    expect(rpcCalls.filter((c) => c.fn === 'finish_class_and_bill')).toEqual([]);
  });
});

describe('over-cap lock (Item 7)', () => {
  // The gate runs after the route's own ownership/conflict reads, so its
  // student_groups read is the SECOND queued entry (the first is the ownership
  // lookup). enrollments[0] feeds the distinct-student count.
  function queueOverCapStandard(count: number) {
    adminQueue.teacher_subscriptions = [{ data: { plan_key: 'teacher_299' }, error: null }];
    adminQueue.enrollments = [
      { data: Array.from({ length: count }, (_, i) => ({ student_id: `s-${i}` })), error: null },
    ];
  }

  it('session start: Standard at 75 -> 403 OVER_CAP_LOCKED, no session created', async () => {
    queueTeacherAuthOk();
    adminQueue.student_groups = [OWNED_GROUP, { data: [{ id: GROUP_ID }], error: null }];
    adminQueue.schedule_exceptions = [{ data: null, error: null }];
    adminQueue.sessions = [{ data: [], error: null }]; // no existing session
    queueOverCapStandard(75);

    const res = await postStart(makeRequest(startBody()));

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('OVER_CAP_LOCKED');
    expect(insertCalls).toEqual([]);
    expect(rpcCalls.filter((c) => c.fn === 'apply_session_transition')).toEqual([]);
  });

  it('session start: Standard back down to 60 -> allowed (creates + goes live)', async () => {
    queueTeacherAuthOk();
    adminQueue.student_groups = [OWNED_GROUP, { data: [{ id: GROUP_ID }], error: null }];
    adminQueue.schedule_exceptions = [{ data: null, error: null }];
    adminQueue.sessions = [{ data: [], error: null }];
    queueOverCapStandard(60); // exactly at the line -> not locked
    adminQueue.insert = [{ data: { id: SESSION_ID }, error: null }];
    rpcQueues.apply_session_transition = [{ data: null, error: null }];

    const res = await postStart(makeRequest(startBody()));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; already_started: boolean };
    expect(body.status).toBe('live');
    expect(body.already_started).toBe(false);
    expect(rpcCalls.filter((c) => c.fn === 'apply_session_transition')).toHaveLength(1);
  });

  it('session start: Pro at 75 -> unaffected (gate short-circuits, no count)', async () => {
    queueTeacherAuthOk();
    adminQueue.student_groups = [OWNED_GROUP]; // gate short-circuits on Pro, no 2nd read
    adminQueue.schedule_exceptions = [{ data: null, error: null }];
    adminQueue.sessions = [{ data: [], error: null }];
    adminQueue.teacher_subscriptions = [{ data: { plan_key: 'teacher_699' }, error: null }];
    adminQueue.insert = [{ data: { id: SESSION_ID }, error: null }];
    rpcQueues.apply_session_transition = [{ data: null, error: null }];

    const res = await postStart(makeRequest(startBody()));

    expect(res.status).toBe(200);
  });

  it('attendance sync: Standard at 75 -> 403 OVER_CAP_LOCKED, no scan write', async () => {
    queueTeacherAuthOk();
    adminQueue.sessions = [
      { data: { id: SESSION_ID, group_id: GROUP_ID, status: 'live' }, error: null },
    ];
    adminQueue.student_groups = [OWNED_GROUP, { data: [{ id: GROUP_ID }], error: null }];
    queueOverCapStandard(75);

    const res = await patchAttendance(makeRequest({ attendee_ids: [STUDENT_ID] }), sessionCtx());

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('OVER_CAP_LOCKED');
    expect(insertCalls).toEqual([]);
    expect(deleteCalls).toEqual([]);
  });
});
