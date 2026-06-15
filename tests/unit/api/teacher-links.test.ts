import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
delete process.env.CSRF_SECRET; // CSRF validation skipped in dev/test

const mockGetUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mockGetUser } })),
}));

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };

const queues: Record<string, QueryResult[]> = {};
const insertCalls: { table: string; payload: Record<string, unknown> }[] = [];
const updateCalls: { table: string; payload: Record<string, unknown> }[] = [];

function queueKey(table: string, cols: string): string {
  if (table === 'users') return cols.includes('role') ? 'users_core' : 'users_display';
  return table;
}
function pop(key: string): QueryResult {
  return queues[key]?.shift() ?? { data: null, error: null };
}

const mockAdmin = {
  from: (table: string) => ({
    select: (cols: string) => {
      const key = queueKey(table, cols);
      const builder = {
        eq: () => builder,
        in: () => builder,
        is: () => builder,
        order: () => builder,
        maybeSingle: async () => pop(key),
        then: (onF: (v: QueryResult) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve(pop(key)).then(onF, onR),
      };
      return builder;
    },
    insert: (payload: Record<string, unknown>) => {
      insertCalls.push({ table, payload });
      const result = () => pop(`${table}_insert`);
      return {
        select: () => ({ single: async () => result() }),
        then: (onF: (v: QueryResult) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve(result()).then(onF, onR),
      };
    },
    update: (payload: Record<string, unknown>) => {
      updateCalls.push({ table, payload });
      const upd = {
        eq: () => upd,
        then: (onF: (v: QueryResult) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve(pop(`${table}_update`)).then(onF, onR),
      };
      return upd;
    },
  }),
};

vi.mock('@/lib/supabase-admin', () => ({ getSupabaseAdmin: () => mockAdmin }));
vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn((cb: (s: { setTag: () => void }) => void) => cb({ setTag: vi.fn() } as never)),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { POST as ADD_BY_CODE } from '@/app/api/center/teacher-links/route';
import { POST as TEACHER_RESPOND } from '@/app/api/teacher/center-requests/[requestId]/route';

const OWNER_ID = 'owner-1';
const CENTER_ID = 'center-1';
const T1 = 'teacher-1';
const REQ_ID = 'req-1';

function seedOwner(role = 'owner') {
  mockGetUser.mockResolvedValue({ data: { user: { id: OWNER_ID } }, error: null });
  queues.users_core = [{ data: { id: OWNER_ID, role, center_id: CENTER_ID }, error: null }];
}
function seedTeacher() {
  mockGetUser.mockResolvedValue({ data: { user: { id: T1 } }, error: null });
  queues.users_core = [{ data: { id: T1, role: 'teacher' }, error: null }];
  // requireTeacherAuth membership list (not used by accept beyond auth).
  queues.teacher_center = [{ data: [], error: null }];
}

function addReq(body: Record<string, unknown>) {
  return new Request('http://localhost/api/center/teacher-links', {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function respondReq(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/teacher/center-requests/${REQ_ID}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const respondParams = { params: Promise.resolve({ requestId: REQ_ID }) };

beforeEach(() => {
  mockGetUser.mockReset();
  for (const k of Object.keys(queues)) delete queues[k];
  insertCalls.length = 0;
  updateCalls.length = 0;
});

describe('POST /api/center/teacher-links (owner adds by teacher code)', () => {
  it('resolves the code and opens a center-initiated pending request (two-sided link)', async () => {
    seedOwner();
    queues.teacher_profiles = [
      { data: { user_id: T1 }, error: null }, // resolveTeacherReferralCode
      { data: { display_name: 'Mr. Ahmed' }, error: null }, // confirmation name
    ];
    queues.teacher_center = [{ data: null, error: null }]; // not yet a member
    queues.teacher_center_requests_insert = [{ data: { id: REQ_ID }, error: null }];

    const res = await ADD_BY_CODE(addReq({ code: 'ahmed7x' }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toMatchObject({ requestId: REQ_ID, teacherName: 'Mr. Ahmed' });
    const insert = insertCalls.find((i) => i.table === 'teacher_center_requests');
    expect(insert?.payload).toMatchObject({
      teacher_id: T1,
      center_id: CENTER_ID,
      status: 'pending',
      initiated_by: 'center',
    });
    // No membership is created yet - the teacher must confirm.
    expect(insertCalls.find((i) => i.table === 'teacher_center')).toBeUndefined();
  });

  it('unknown code -> 404 TEACHER_CODE_NOT_FOUND, nothing written', async () => {
    seedOwner();
    queues.teacher_profiles = [{ data: null, error: null }];

    const res = await ADD_BY_CODE(addReq({ code: 'nope' }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.code).toBe('TEACHER_CODE_NOT_FOUND');
    expect(insertCalls).toHaveLength(0);
  });

  it('already-linked teacher -> 409 ALREADY_A_MEMBER', async () => {
    seedOwner();
    queues.teacher_profiles = [{ data: { user_id: T1 }, error: null }];
    queues.teacher_center = [{ data: { teacher_id: T1 }, error: null }];

    const res = await ADD_BY_CODE(addReq({ code: 'ahmed7x' }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('ALREADY_A_MEMBER');
    expect(insertCalls).toHaveLength(0);
  });

  it('a non-owner caller is rejected (401)', async () => {
    seedOwner('assistant');
    const res = await ADD_BY_CODE(addReq({ code: 'ahmed7x' }));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/teacher/center-requests/[requestId] (teacher confirms)', () => {
  it('accept of a center-initiated request creates the active membership (links the teacher)', async () => {
    seedTeacher();
    queues.teacher_center_requests = [
      { data: { id: REQ_ID, teacher_id: T1, center_id: CENTER_ID, status: 'pending', initiated_by: 'center' }, error: null },
    ];
    queues.teacher_center_requests_update = [{ data: null, error: null }];
    queues.teacher_center_insert = [{ data: null, error: null }];

    const res = await TEACHER_RESPOND(respondReq({ action: 'accept' }), respondParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.action).toBe('accept');
    const membership = insertCalls.find((i) => i.table === 'teacher_center');
    expect(membership?.payload).toMatchObject({ teacher_id: T1, center_id: CENTER_ID, status: 'active' });
  });

  it('cannot accept a teacher-initiated request (404 - not the teacher to confirm)', async () => {
    seedTeacher();
    queues.teacher_center_requests = [
      { data: { id: REQ_ID, teacher_id: T1, center_id: CENTER_ID, status: 'pending', initiated_by: 'teacher' }, error: null },
    ];

    const res = await TEACHER_RESPOND(respondReq({ action: 'accept' }), respondParams);
    expect(res.status).toBe(404);
    expect(insertCalls.find((i) => i.table === 'teacher_center')).toBeUndefined();
  });
});
