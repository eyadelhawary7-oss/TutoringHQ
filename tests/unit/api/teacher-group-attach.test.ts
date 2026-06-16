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
const deleteCalls: { table: string }[] = [];

function pop(key: string): QueryResult {
  return queues[key]?.shift() ?? { data: null, error: null };
}
function queueKey(table: string): string {
  return table === 'users' ? 'users_core' : table;
}

const mockAdmin = {
  from: (table: string) => ({
    select: () => {
      const key = queueKey(table);
      const builder = {
        eq: () => builder,
        in: () => builder,
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
    delete: () => {
      deleteCalls.push({ table });
      const del = {
        eq: () => del,
        then: (onF: (v: QueryResult) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(onF, onR),
      };
      return del;
    },
  }),
};

vi.mock('@/lib/supabase-admin', () => ({ getSupabaseAdmin: () => mockAdmin }));
vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn((cb: (scope: { setTag: () => void }) => void) => cb({ setTag: vi.fn() } as never)),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { POST } from '@/app/api/teacher/group-attach/route';

const TEACHER_ID = 'teacher-1';
const CENTER_ID = 'center-1';
const GROUP_ID = 'group-7';
const PROPOSAL_ID = 'prop-1';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/teacher/group-attach', {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function seedTeacherAuth(memberCenterIds: string[] = [CENTER_ID]) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: TEACHER_ID, email: '201000000000@centerhq.local' } },
    error: null,
  });
  queues.users_core = [{ data: { id: TEACHER_ID, role: 'teacher' }, error: null }];
  queues.teacher_center = [{ data: memberCenterIds.map((id) => ({ center_id: id })), error: null }];
}

function seedSoloGroup() {
  queues.student_groups = [
    {
      data: {
        id: GROUP_ID,
        teacher_id: TEACHER_ID,
        kind: 'private',
        center_id: null,
        subject: 'Physics',
        fee_per_class: 100,
      },
      error: null,
    },
  ];
}

const VALID_BODY = { group_id: GROUP_ID, center_id: CENTER_ID, opening_cut_egp: 20 };

beforeEach(() => {
  mockGetUser.mockReset();
  for (const k of Object.keys(queues)) delete queues[k];
  insertCalls.length = 0;
  deleteCalls.length = 0;
});

describe('POST /api/teacher/group-attach', () => {
  it('happy path: inserts a teacher-initiated proposal targeting the OWN private group + opening offer', async () => {
    seedTeacherAuth();
    seedSoloGroup();
    queues.group_proposals_insert = [{ data: { id: PROPOSAL_ID }, error: null }];
    queues.group_proposal_offers_insert = [{ data: null, error: null }];

    const res = await POST(makeRequest(VALID_BODY));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual({ proposal_id: PROPOSAL_ID, status: 'open' });
    const propInsert = insertCalls.find((i) => i.table === 'group_proposals');
    expect(propInsert?.payload).toMatchObject({
      teacher_id: TEACHER_ID,
      center_id: CENTER_ID,
      subject: 'Physics',
      fee_per_class: 100,
      target_group_id: GROUP_ID,
      status: 'open',
    });
    const offerInsert = insertCalls.find((i) => i.table === 'group_proposal_offers');
    expect(offerInsert?.payload).toMatchObject({ proposal_id: PROPOSAL_ID, made_by: 'teacher', cut_egp: 20 });
  });

  it("a foreign teacher's group is a 404 (no existence oracle, no insert)", async () => {
    seedTeacherAuth();
    queues.student_groups = [
      {
        data: { id: GROUP_ID, teacher_id: 'someone-else', kind: 'private', center_id: null, subject: 'x', fee_per_class: 100 },
        error: null,
      },
    ];

    const res = await POST(makeRequest(VALID_BODY));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.code).toBe('NOT_FOUND');
    expect(insertCalls).toHaveLength(0);
  });

  it('rejects a group that is not solo (already center-attached -> 409 GROUP_NOT_SOLO)', async () => {
    seedTeacherAuth();
    queues.student_groups = [
      {
        data: { id: GROUP_ID, teacher_id: TEACHER_ID, kind: 'center', center_id: CENTER_ID, subject: 'x', fee_per_class: 100 },
        error: null,
      },
    ];

    const res = await POST(makeRequest(VALID_BODY));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('GROUP_NOT_SOLO');
    expect(insertCalls).toHaveLength(0);
  });

  it('rejects a center the teacher is not a member of (403 NOT_A_MEMBER, before any group lookup)', async () => {
    seedTeacherAuth(['other-center']);

    const res = await POST(makeRequest(VALID_BODY));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe('NOT_A_MEMBER');
    expect(insertCalls).toHaveLength(0);
  });

  it('never bypasses the cut bound: opening cut >= the group fee -> 400 CUT_NOT_LESS_THAN_FEE', async () => {
    seedTeacherAuth();
    seedSoloGroup();

    const res = await POST(makeRequest({ ...VALID_BODY, opening_cut_egp: 100 }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('CUT_NOT_LESS_THAN_FEE');
    expect(insertCalls).toHaveLength(0);
  });

  it('rejects a duplicate open attach (unique index 23505 -> 409 PROPOSAL_ALREADY_OPEN)', async () => {
    seedTeacherAuth();
    seedSoloGroup();
    queues.group_proposals_insert = [{ data: null, error: { message: 'duplicate key', code: '23505' } }];

    const res = await POST(makeRequest(VALID_BODY));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('PROPOSAL_ALREADY_OPEN');
  });
});
