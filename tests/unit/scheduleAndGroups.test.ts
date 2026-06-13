import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

import { formatTimeRange } from '@/lib/timeFormat';

// ---- Shared mock state ----
type Result = { data: unknown; error: { message: string; code?: string } | null };

const adminQueue: Record<string, Result[]> = {
  student_groups: [],
  schedule_exceptions: [],
  sessions: [],
  enrollments: [],
  teacher_subscriptions: [],
  insert: [],
};
const rpcQueues: Record<string, Result[]> = { finish_class_and_bill: [] };
const insertCalls: { table: string; payload: unknown }[] = [];
const eqCalls: { table: string; col: string; val: unknown }[] = [];

function shift(table: string): Result {
  return adminQueue[table]?.shift() ?? { data: null, error: null };
}

const admin = {
  rpc: async (fn: string) => rpcQueues[fn]?.shift() ?? { data: null, error: null },
  from: (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        eqCalls.push({ table, col, val });
        return builder;
      },
      in: () => builder,
      is: () => builder,
      gte: () => builder,
      lt: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => shift(table),
      single: async () => shift(table),
      then: (f: (v: Result) => unknown, r?: (e: unknown) => unknown) =>
        Promise.resolve(shift(table)).then(f, r),
      insert: (payload: unknown) => {
        insertCalls.push({ table, payload });
        const result = () => adminQueue.insert.shift() ?? { data: null, error: null };
        const selectObj = {
          single: async () => result(),
          then: (f: (v: Result) => unknown, r?: (e: unknown) => unknown) =>
            Promise.resolve(result()).then(f, r),
        };
        return {
          select: () => selectObj,
          then: (f: (v: Result) => unknown, r?: (e: unknown) => unknown) =>
            Promise.resolve(result()).then(f, r),
        };
      },
    };
    return builder;
  },
};

const mockRequireAuth = vi.fn();
const mockRequirePrivate = vi.fn();
const mockRequireOwned = vi.fn();

vi.mock('@/lib/centerAuth', () => ({
  requireTeacherAuth: (req: NextRequest) => mockRequireAuth(req),
  requireTeacherPrivateAccess: (req: NextRequest) => mockRequirePrivate(req),
}));

vi.mock('@/lib/teacherPrivate', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    requireOwnedPrivateGroup: (
      ...args: unknown[]
    ) => mockRequireOwned(...args),
  };
});

vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: { setTag: () => void }) => void) => fn({ setTag: () => undefined }),
  captureException: () => undefined,
  captureMessage: () => undefined,
}));

import { POST as postScheduleSession } from '@/app/api/teacher/private/schedule/sessions/route';
import { GET as getClasses } from '@/app/api/teacher/private/groups/[groupId]/classes/route';
import { POST as postRosterAdd } from '@/app/api/teacher/private/groups/[groupId]/roster/route';

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const SCHEDULE_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const GUEST_ID = '55555555-5555-4555-8555-555555555555';

const OWNED_GROUP: Result = {
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

function makeRequest(body?: unknown): NextRequest {
  return {
    headers: { get: () => 'Bearer fake-token' },
    nextUrl: { searchParams: new URLSearchParams() },
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  } as unknown as NextRequest;
}

beforeEach(() => {
  for (const k of Object.keys(adminQueue)) adminQueue[k] = [];
  for (const k of Object.keys(rpcQueues)) rpcQueues[k] = [];
  insertCalls.length = 0;
  eqCalls.length = 0;
  mockRequireAuth.mockReset();
  mockRequirePrivate.mockReset();
  mockRequireOwned.mockReset();
  mockRequireAuth.mockResolvedValue({ ok: true, userId: 'user-1', supabaseAdmin: admin });
  mockRequirePrivate.mockResolvedValue({ ok: true, userId: 'user-1', supabaseAdmin: admin });
  mockRequireOwned.mockResolvedValue({ ok: true, group: OWNED_GROUP.data });
});

describe('formatTimeRange', () => {
  it('renders an afternoon hour as a PM range', () => {
    expect(formatTimeRange('16:00', 60)).toBe('4:00 PM - 5:00 PM');
  });

  it('renders a morning half-hour with a 90-minute duration', () => {
    expect(formatTimeRange('09:30', 90)).toBe('9:30 AM - 11:00 AM');
  });

  it('wraps the end time across midnight', () => {
    expect(formatTimeRange('23:00', 90)).toBe('11:00 PM - 12:30 AM');
  });
});

describe('POST /api/teacher/private/schedule/sessions (guests)', () => {
  function queueGuestRecordFlow() {
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.teacher_subscriptions = [{ data: { plan_key: 'teacher_699' }, error: null }]; // Pro
    adminQueue.schedule_exceptions = [{ data: null, error: null }]; // not cancelled
    adminQueue.sessions = [{ data: null, error: null }]; // no existing session
    adminQueue.insert = [
      { data: { id: SESSION_ID }, error: null }, // session insert
      { data: [{ id: GUEST_ID }], error: null }, // guest student insert
      { data: null, error: null }, // attendance_scans insert
    ];
    rpcQueues.finish_class_and_bill = [
      { data: [{ session_id: SESSION_ID, billed_now: true, charges_created: 1 }], error: null },
    ];
  }

  const body = {
    group_id: GROUP_ID,
    schedule_id: SCHEDULE_ID,
    session_date: '2026-06-10',
    attendee_ids: [],
    guests: [{ name: 'Walk In', phone: '01012345678' }],
  };

  it('inserts a guest student with is_guest=true and all notifications off', async () => {
    queueGuestRecordFlow();

    const res = await postScheduleSession(makeRequest(body));
    expect(res.status).toBe(200);

    const guestInsert = insertCalls.find((c) => c.table === 'students');
    expect(guestInsert).toBeDefined();
    const row = (guestInsert!.payload as Record<string, unknown>[])[0];
    expect(row.is_guest).toBe(true);
    expect(row.center_id).toBeNull();
    expect(row.notify_on_scan).toBe(false);
    expect(row.notify_on_absence).toBe(false);
    expect(row.notify_on_balance).toBe(false);
    expect(row.phone_verified).toBe(false);
  });

  it('creates the session and bills (guest-only attendance is accepted)', async () => {
    queueGuestRecordFlow();

    const res = await postScheduleSession(makeRequest(body));
    expect(res.status).toBe(200);
    // session row + guest student row + attendance scans all inserted
    expect(insertCalls.map((c) => c.table)).toEqual(
      expect.arrayContaining(['sessions', 'students', 'attendance_scans']),
    );
  });

  it('400 when there are no attendees and no guests', async () => {
    const res = await postScheduleSession(
      makeRequest({ ...body, attendee_ids: [], guests: [] }),
    );
    expect(res.status).toBe(400);
    expect(insertCalls).toEqual([]);
  });

  it('403 GUESTS_PRO_ONLY when a Standard teacher sends guests', async () => {
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.teacher_subscriptions = [{ data: { plan_key: 'teacher_299' }, error: null }];

    const res = await postScheduleSession(makeRequest(body));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('GUESTS_PRO_ONLY');
    expect(insertCalls).toEqual([]);
  });

  it('400 GUEST_LIMIT_EXCEEDED when a Pro teacher sends more than 10 guests', async () => {
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.teacher_subscriptions = [{ data: { plan_key: 'teacher_699' }, error: null }];
    const elevenGuests = Array.from({ length: 11 }, (_, i) => ({
      name: `G${i}`,
      phone: '01012345678',
    }));

    const res = await postScheduleSession(makeRequest({ ...body, guests: elevenGuests }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; limit: number; current: number };
    expect(json.error).toBe('GUEST_LIMIT_EXCEEDED');
    expect(json.limit).toBe(10);
    expect(json.current).toBe(11);
    expect(insertCalls).toEqual([]);
  });
});

describe('GET /api/teacher/private/groups/[groupId]/classes', () => {
  it('401 when unauthenticated', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'unauth' }, { status: 401 }),
    });

    const res = await getClasses(makeRequest(), {
      params: Promise.resolve({ groupId: GROUP_ID }),
    });
    expect(res.status).toBe(401);
  });

  it('403 when the group belongs to a different teacher', async () => {
    adminQueue.student_groups = [
      { data: { teacher_id: 'someone-else', kind: 'private' }, error: null },
    ];

    const res = await getClasses(makeRequest(), {
      params: Promise.resolve({ groupId: GROUP_ID }),
    });
    expect(res.status).toBe(403);
  });
});

describe('Standard student cap excludes guests', () => {
  it('counts only non-guest active enrollments and 429s at the cap', async () => {
    adminQueue.teacher_subscriptions = [{ data: { plan_key: 'teacher_299' }, error: null }];
    adminQueue.student_groups = [{ data: [{ id: GROUP_ID }], error: null }];
    adminQueue.enrollments = [
      { data: Array.from({ length: 60 }, (_, i) => ({ student_id: `s${i}` })), error: null },
    ];

    const res = await postRosterAdd(makeRequest({ name: 'X', phone: '01012345678', payer: 'student' }), {
      params: Promise.resolve({ groupId: GROUP_ID }),
    });

    expect(res.status).toBe(429);
    // The cap count query filters guests out at the DB layer.
    expect(eqCalls).toContainEqual({
      table: 'enrollments',
      col: 'students.is_guest',
      val: false,
    });
  });
});
