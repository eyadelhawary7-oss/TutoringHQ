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
  enrollments: [],
  students: [],
  insert: [],
};

// rpc results are queued PER FUNCTION (three rpcs are in play: the gate,
// create_enrollment, and apply_enrollment_transition).
const rpcQueues: Record<string, AdminQueryResult[]> = {
  teacher_private_access: [],
  create_enrollment: [],
  apply_enrollment_transition: [],
};
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

const tableHits: string[] = [];
const filterCalls: { table: string; method: string; column: string; value: unknown }[] = [];
const insertCalls: { table: string; payload: Record<string, unknown> }[] = [];
const updateCalls: { table: string; payload: Record<string, unknown> }[] = [];

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
        return {
          select: () => ({
            single: async () => adminQueue.insert.shift() ?? { data: null, error: null },
          }),
        };
      },
      update: (payload: Record<string, unknown>) => {
        updateCalls.push({ table, payload });
        return { eq: async () => ({ data: null, error: null }) };
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

import { GET as getRoster, POST as postStudent } from '@/app/api/teacher/private/groups/[groupId]/roster/route';
import { POST as postDecision } from '@/app/api/teacher/private/groups/[groupId]/enrollments/route';

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const ENROLLMENT_ID = '22222222-2222-4222-8222-222222222222';
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

function ctx(groupId: string = GROUP_ID) {
  return { params: Promise.resolve({ groupId }) };
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

const VALID_ADD_BODY = { name: 'Ahmed', phone: '01012345678', payer: 'student' };

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
  updateCalls.length = 0;
});

describe('GET /api/teacher/private/groups/[groupId]/roster', () => {
  it('lapsed -> 403 NO_PRIVATE_ACCESS, no data query (spine)', async () => {
    queueGateLapsed();

    const res = await getRoster(makeRequest(), ctx());

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('NO_PRIVATE_ACCESS');
    expect(tableHits.filter((t) => ['student_groups', 'enrollments', 'students'].includes(t))).toEqual([]);
  });

  it('foreign/unknown group id -> 404 group_not_found, roster never read (THE denial)', async () => {
    queueGateGranted();
    adminQueue.student_groups = [{ data: null, error: null }];

    const res = await getRoster(makeRequest(), ctx());

    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('group_not_found');
    expect(tableHits).not.toContain('enrollments');
    expect(tableHits).not.toContain('students');
  });

  it('ownership CORE read error -> 500, never a 404 minted from an error', async () => {
    queueGateGranted();
    adminQueue.student_groups = [{ data: null, error: { message: 'db down' } }];

    const res = await getRoster(makeRequest(), ctx());

    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe('server_error');
    expect(mockSentryCaptureException).toHaveBeenCalled();
  });

  it('happy path -> 200 roster with student info, pending first, scoping asserted', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.enrollments = [
      {
        data: [
          { id: 'e-active', student_id: 's1', status: 'active', payer: 'student', joined_at: '2026-06-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z' },
          { id: 'e-pending', student_id: 's2', status: 'pending', payer: 'parent', joined_at: null, created_at: '2026-06-05T00:00:00Z' },
        ],
        error: null,
      },
    ];
    adminQueue.students = [
      {
        data: [
          { id: 's1', name: 'Ahmed', phone: '+201012345678' },
          { id: 's2', name: 'Mona', phone: '+201112345678' },
        ],
        error: null,
      },
    ];

    const res = await getRoster(makeRequest(), ctx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      group: { id: string; fee_per_class: number };
      roster: { enrollmentId: string; status: string; student: { name: string } }[];
    };
    expect(body.group.id).toBe(GROUP_ID);
    expect(body.group.fee_per_class).toBe(150);
    expect(body.roster.map((r) => r.enrollmentId)).toEqual(['e-pending', 'e-active']);
    expect(body.roster[0].student.name).toBe('Mona');

    const sg = filterCalls.filter((f) => f.table === 'student_groups' && f.method === 'eq');
    expect(sg).toContainEqual({ table: 'student_groups', method: 'eq', column: 'id', value: GROUP_ID });
    expect(sg).toContainEqual({ table: 'student_groups', method: 'eq', column: 'teacher_id', value: 'user-1' });
    expect(sg).toContainEqual({ table: 'student_groups', method: 'eq', column: 'kind', value: 'private' });
    expect(filterCalls).toContainEqual({ table: 'enrollments', method: 'eq', column: 'group_id', value: GROUP_ID });
  });
});

describe('POST /api/teacher/private/groups/[groupId]/roster (add student)', () => {
  it('lapsed -> 403, no student/enrollment call (spine)', async () => {
    queueGateLapsed();

    const res = await postStudent(makeRequest(VALID_ADD_BODY), ctx());

    expect(res.status).toBe(403);
    expect(insertCalls).toEqual([]);
    expect(rpcCalls.filter((c) => c.fn !== 'teacher_private_access')).toEqual([]);
  });

  it('foreign group id -> 404, no student created, no enrollment rpc (THE denial)', async () => {
    queueGateGranted();
    adminQueue.student_groups = [{ data: null, error: null }];

    const res = await postStudent(makeRequest(VALID_ADD_BODY), ctx());

    expect(res.status).toBe(404);
    expect(insertCalls).toEqual([]);
    expect(rpcCalls.filter((c) => c.fn !== 'teacher_private_access')).toEqual([]);
  });

  it('invalid phone -> 400 invalid_phone, nothing called', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];

    const res = await postStudent(
      makeRequest({ name: 'Ahmed', phone: '123', payer: 'student' }),
      ctx(),
    );

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_phone');
    expect(tableHits).not.toContain('students');
    expect(insertCalls).toEqual([]);
    expect(rpcCalls.filter((c) => c.fn !== 'teacher_private_access')).toEqual([]);
  });

  it('parent payer without parent phone -> 400 invalid_parent_phone', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];

    const res = await postStudent(
      makeRequest({ name: 'Ahmed', phone: '01012345678', payer: 'parent' }),
      ctx(),
    );

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_parent_phone');
    expect(insertCalls).toEqual([]);
  });

  it('happy path (new student, parent pays): create + enroll + auto-activate, server-set identity', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.students = [{ data: null, error: null }]; // no existing match
    adminQueue.insert = [{ data: { id: 's-new', name: 'Ahmed' }, error: null }];
    rpcQueues.create_enrollment = [
      { data: [{ enrollment_id: ENROLLMENT_ID, status: 'pending' }], error: null },
    ];
    rpcQueues.apply_enrollment_transition = [
      { data: { id: ENROLLMENT_ID, status: 'active' }, error: null },
    ];

    const res = await postStudent(
      makeRequest({
        name: 'Ahmed',
        phone: '01012345678',
        payer: 'parent',
        parent_phone: '0111 234 5678',
      }),
      ctx(),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      enrollment: { id: string; status: string; student: { phone: string } };
    };
    expect(body.enrollment.id).toBe(ENROLLMENT_ID);
    // Teacher-initiated adds end active (auto pending -> active transition).
    expect(body.enrollment.status).toBe('active');
    expect(body.enrollment.student.phone).toBe('+201012345678');

    // Student row: center-less, normalized phones, origin walk_in.
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].payload).toEqual({
      name: 'Ahmed',
      phone: '+201012345678',
      parent_phone: '+201112345678',
      center_id: null,
      origin: 'walk_in',
    });

    const enrollCall = rpcCalls.find((c) => c.fn === 'create_enrollment');
    expect(enrollCall?.args).toEqual({
      p_group_id: GROUP_ID,
      p_student_id: 's-new',
      p_payer: 'parent',
      p_actor_id: 'user-1',
      p_source: 'walk_in',
    });
    const transCall = rpcCalls.find((c) => c.fn === 'apply_enrollment_transition');
    expect(transCall?.args).toEqual({
      p_enrollment_id: ENROLLMENT_ID,
      p_new_status: 'active',
      p_actor_id: 'user-1',
    });
  });

  it('existing center-less student is linked, not duplicated', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.students = [
      { data: { id: 's-existing', name: 'Ahmed Aly', parent_phone: null }, error: null },
    ];
    rpcQueues.create_enrollment = [
      { data: [{ enrollment_id: ENROLLMENT_ID, status: 'pending' }], error: null },
    ];
    rpcQueues.apply_enrollment_transition = [
      { data: { id: ENROLLMENT_ID, status: 'active' }, error: null },
    ];

    const res = await postStudent(makeRequest(VALID_ADD_BODY), ctx());

    expect(res.status).toBe(201);
    expect(insertCalls).toEqual([]);
    const enrollCall = rpcCalls.find((c) => c.fn === 'create_enrollment');
    expect(enrollCall?.args).toMatchObject({ p_student_id: 's-existing' });
  });

  it('duplicate live enrollment -> 409 duplicate_enrollment', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.students = [
      { data: { id: 's-existing', name: 'Ahmed', parent_phone: null }, error: null },
    ];
    rpcQueues.create_enrollment = [
      {
        data: null,
        error: { message: 'student s already has a live enrollment in group g', code: '23505' },
      },
    ];

    const res = await postStudent(makeRequest(VALID_ADD_BODY), ctx());

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('duplicate_enrollment');
  });

  it('group at capacity -> 409 capacity_full', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.students = [
      { data: { id: 's-existing', name: 'Ahmed', parent_phone: null }, error: null },
    ];
    rpcQueues.create_enrollment = [
      { data: null, error: { message: 'group g is at capacity (8 / 8)', code: '23514' } },
    ];

    const res = await postStudent(makeRequest(VALID_ADD_BODY), ctx());

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('capacity_full');
  });
});

describe('POST /api/teacher/private/groups/[groupId]/enrollments (approve/reject)', () => {
  const APPROVE_BODY = { enrollment_id: ENROLLMENT_ID, action: 'approve' };

  it('lapsed -> 403, no transition call (spine)', async () => {
    queueGateLapsed();

    const res = await postDecision(makeRequest(APPROVE_BODY), ctx());

    expect(res.status).toBe(403);
    expect(rpcCalls.filter((c) => c.fn === 'apply_enrollment_transition')).toEqual([]);
  });

  it('foreign group id -> 404, enrollment never read, no transition (THE denial)', async () => {
    queueGateGranted();
    adminQueue.student_groups = [{ data: null, error: null }];

    const res = await postDecision(makeRequest(APPROVE_BODY), ctx());

    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('group_not_found');
    expect(tableHits).not.toContain('enrollments');
    expect(rpcCalls.filter((c) => c.fn === 'apply_enrollment_transition')).toEqual([]);
  });

  it('enrollment id not in the verified group -> 404 enrollment_not_found, no transition', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.enrollments = [{ data: null, error: null }];

    const res = await postDecision(makeRequest(APPROVE_BODY), ctx());

    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('enrollment_not_found');
    expect(rpcCalls.filter((c) => c.fn === 'apply_enrollment_transition')).toEqual([]);
  });

  it('approve happy -> transition to active with server-set actor', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.enrollments = [{ data: { id: ENROLLMENT_ID, status: 'pending' }, error: null }];
    rpcQueues.apply_enrollment_transition = [
      { data: { id: ENROLLMENT_ID, status: 'active' }, error: null },
    ];

    const res = await postDecision(makeRequest(APPROVE_BODY), ctx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { enrollment: { id: string; status: string } };
    expect(body.enrollment).toEqual({ id: ENROLLMENT_ID, status: 'active' });
    expect(rpcCalls.find((c) => c.fn === 'apply_enrollment_transition')?.args).toEqual({
      p_enrollment_id: ENROLLMENT_ID,
      p_new_status: 'active',
      p_actor_id: 'user-1',
    });
  });

  it('reject happy -> transition to rejected', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.enrollments = [{ data: { id: ENROLLMENT_ID, status: 'pending' }, error: null }];
    rpcQueues.apply_enrollment_transition = [
      { data: { id: ENROLLMENT_ID, status: 'rejected' }, error: null },
    ];

    const res = await postDecision(
      makeRequest({ enrollment_id: ENROLLMENT_ID, action: 'reject' }),
      ctx(),
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as { enrollment: { status: string } }).enrollment.status).toBe('rejected');
  });

  it('illegal transition (already decided) -> 409 invalid_transition', async () => {
    queueGateGranted();
    adminQueue.student_groups = [OWNED_GROUP];
    adminQueue.enrollments = [{ data: { id: ENROLLMENT_ID, status: 'rejected' }, error: null }];
    rpcQueues.apply_enrollment_transition = [
      { data: null, error: { message: 'illegal enrollment transition: rejected -> active', code: '23514' } },
    ];

    const res = await postDecision(makeRequest(APPROVE_BODY), ctx());

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_transition');
  });
});
