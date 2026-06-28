import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

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
  group_schedule: [],
  schedule_exceptions: [],
  sessions: [],
  enrollments: [],
  students: [],
  attendance_scans: [],
  transactions: [],
  insert: [],
};

const rpcQueues: Record<string, AdminQueryResult[]> = {
  finish_class_and_bill: [],
  teacher_private_access: [],
};
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

const tableHits: string[] = [];
const insertCalls: { table: string; payload: unknown }[] = [];

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
          select: () => ({ single: async () => result() }),
          then: (
            onFulfilled: (v: AdminQueryResult) => unknown,
            onRejected?: (e: unknown) => unknown,
          ) => Promise.resolve(result()).then(onFulfilled, onRejected),
        };
      },
      delete: () => {
        const del = {
          eq: () => del,
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

import { GET as getSchedule } from '@/app/api/teacher/private/schedule/route';
import { POST as postScheduleSession } from '@/app/api/teacher/private/schedule/sessions/route';
import { POST as postException } from '@/app/api/teacher/private/schedule/exceptions/route';
import { queueClassCancelledNotification } from '@/lib/teacherScheduleNotifications';

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const SCHEDULE_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '44444444-4444-4444-8444-444444444444';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const VALID_USER = { id: 'user-1' };

function makeRequest(body?: unknown, { auth = true }: { auth?: boolean } = {}): NextRequest {
  const headers = new Map<string, string>(
    auth ? [['Authorization', 'Bearer fake-token']] : [],
  );
  return {
    headers: { get: (k: string) => headers.get(k) ?? null },
    nextUrl: { searchParams: new URLSearchParams() },
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  } as unknown as NextRequest;
}

function queueTeacherAuthOk() {
  mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
  adminQueue.users_teacher = [{ data: { id: 'user-1', role: 'teacher' }, error: null }];
  adminQueue.teacher_center = [{ data: [], error: null }];
  // Private-engine routes are gated by requireTeacherPrivateAccess (teacher_private_access RPC).
  rpcQueues.teacher_private_access.push({ data: true, error: null });
}

const OWNED_GROUP = {
  data: {
    id: GROUP_ID,
    name: 'Physics',
    teacher_id: 'user-1',
    center_id: null,
    kind: 'private',
    status: 'active',
  },
  error: null,
};

const FOREIGN_GROUP = {
  data: { ...(OWNED_GROUP.data as Record<string, unknown>), teacher_id: 'someone-else' },
  error: null,
};

function sessionBody(overrides: Record<string, unknown> = {}) {
  return {
    group_id: GROUP_ID,
    schedule_id: SCHEDULE_ID,
    session_date: '2026-06-10',
    attendee_ids: [STUDENT_ID],
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
});

describe('GET /api/teacher/private/schedule', () => {
  it('returns 401 when no Authorization header, no data query', async () => {
    const res = await getSchedule(makeRequest(undefined, { auth: false }));

    expect(res.status).toBe(401);
    expect(tableHits).toEqual([]);
  });
});

describe('POST /api/teacher/private/schedule/sessions', () => {
  it('403 when group.teacher_id does not match the authenticated user', async () => {
    queueTeacherAuthOk();
    adminQueue.student_groups = [FOREIGN_GROUP];

    const res = await postScheduleSession(makeRequest(sessionBody()));

    expect(res.status).toBe(403);
    expect(insertCalls).toEqual([]);
    expect(rpcCalls.filter((c) => c.fn === 'finish_class_and_bill')).toEqual([]);
  });

  it('422 when session_date is in the future (Cairo)', async () => {
    queueTeacherAuthOk();

    const res = await postScheduleSession(
      makeRequest(sessionBody({ session_date: '2999-01-01' })),
    );

    expect(res.status).toBe(422);
    expect(insertCalls).toEqual([]);
  });

  it('409 CLASS_CANCELLED when a cancelled exception exists for the slot day', async () => {
    queueTeacherAuthOk();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.schedule_exceptions = [{ data: { id: 'exc-1' }, error: null }];

    const res = await postScheduleSession(makeRequest(sessionBody()));

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('CLASS_CANCELLED');
    expect(insertCalls).toEqual([]);
  });

  it('200 already_exists=true when a session exists for group + date, no new insert', async () => {
    queueTeacherAuthOk();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.schedule_exceptions = [{ data: null, error: null }];
    adminQueue.sessions = [{ data: { id: SESSION_ID }, error: null }];

    const res = await postScheduleSession(makeRequest(sessionBody()));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session_id: string;
      charges_created: number;
      already_exists: boolean;
    };
    expect(body).toEqual({
      session_id: SESSION_ID,
      charges_created: 0,
      already_exists: true,
    });
    expect(insertCalls).toEqual([]);
    expect(rpcCalls.filter((c) => c.fn === 'finish_class_and_bill')).toEqual([]);
  });

  it('400 when attendee_ids is empty', async () => {
    queueTeacherAuthOk();

    const res = await postScheduleSession(makeRequest(sessionBody({ attendee_ids: [] })));

    expect(res.status).toBe(400);
    expect(insertCalls).toEqual([]);
  });
});

describe('POST /api/teacher/private/schedule/exceptions', () => {
  it('400 when kind=rescheduled and new_date is missing', async () => {
    queueTeacherAuthOk();

    const res = await postException(
      makeRequest({
        group_id: GROUP_ID,
        schedule_id: SCHEDULE_ID,
        exception_date: '2026-06-15',
        kind: 'rescheduled',
      }),
    );

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('new_date_required');
    expect(insertCalls).toEqual([]);
  });
});

describe('teacherScheduleNotifications stubs', () => {
  const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

  afterEach(() => {
    infoSpy.mockClear();
  });

  it('queueClassCancelledNotification resolves without throwing and logs to console.info', async () => {
    const fakeAdmin = {} as SupabaseClient;

    await expect(
      queueClassCancelledNotification(GROUP_ID, '2026-06-15', 'user-1', fakeAdmin),
    ).resolves.toBeUndefined();

    expect(infoSpy).toHaveBeenCalledWith(
      '[stub] queueClassCancelledNotification',
      { groupId: GROUP_ID, exceptionDate: '2026-06-15', teacherUserId: 'user-1' },
    );
  });
});
