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
const filterCalls: { table: string; method: string; column: string; value: unknown }[] = [];

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
        order: () => builder,
        maybeSingle: async () => pop(key),
        then: (
          onFulfilled: (v: QueryResult) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) => Promise.resolve(pop(key)).then(onFulfilled, onRejected),
      };
      return builder;
    },
  }),
};

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => mockAdmin,
}));

vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn((cb: (scope: { setTag: () => void }) => void) =>
    cb({ setTag: vi.fn() } as never),
  ),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { GET } from '@/app/api/teacher/joinable-groups/route';

const TEACHER_ID = 'teacher-1';
const CENTER_ID = 'center-1';

function makeRequest(centerId?: string): NextRequest {
  const url =
    centerId !== undefined
      ? `http://localhost/api/teacher/joinable-groups?center_id=${encodeURIComponent(centerId)}`
      : 'http://localhost/api/teacher/joinable-groups';
  return new Request(url, { headers: { Authorization: 'Bearer tok' } }) as unknown as NextRequest;
}

function seedTeacherAuth(memberCenterIds: string[] = [CENTER_ID]) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: TEACHER_ID, email: '201000000000@centerhq.local' } },
    error: null,
  });
  queues.users_core = [{ data: { id: TEACHER_ID, role: 'teacher' }, error: null }];
  queues.teacher_center = [
    { data: memberCenterIds.map((id) => ({ center_id: id })), error: null },
  ];
}

beforeEach(() => {
  mockGetUser.mockReset();
  for (const k of Object.keys(queues)) delete queues[k];
  filterCalls.length = 0;
});

describe('GET /api/teacher/joinable-groups', () => {
  it('requires a center_id (400)', async () => {
    seedTeacherAuth();
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
  });

  it('rejects a center the teacher is not an active member of (403 NOT_A_MEMBER)', async () => {
    seedTeacherAuth(['other-center']);
    const res = await GET(makeRequest(CENTER_ID));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.code).toBe('NOT_A_MEMBER');
  });

  it('lists teacher-less groups with cut + student count, excluding ones already under an open attach proposal', async () => {
    seedTeacherAuth();
    queues.student_groups = [
      {
        data: [
          { id: 'g1', name: 'Group A', subject: 'Math', fee_per_class: 100, center_cut_egp: 30 },
          { id: 'g2', name: 'Group B', subject: 'Physics', fee_per_class: 120, center_cut_egp: 0 },
        ],
        error: null,
      },
    ];
    // g2 already has an open attach proposal -> excluded from the picker.
    queues.group_proposals = [{ data: [{ target_group_id: 'g2' }], error: null }];
    queues.student_group_members = [
      { data: [{ group_id: 'g1' }, { group_id: 'g1' }], error: null },
    ];

    const res = await GET(makeRequest(CENTER_ID));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.groups).toHaveLength(1);
    expect(json.groups[0]).toEqual({
      id: 'g1',
      name: 'Group A',
      subject: 'Math',
      feePerClass: 100,
      centerCutEgp: 30,
      studentCount: 2,
    });
    // The groups query is scoped to teacher-less center groups.
    expect(filterCalls.some((f) => f.table === 'student_groups' && f.method === 'is' && f.column === 'teacher_id')).toBe(true);
  });

  it('returns an empty list when the center has no teacher-less groups', async () => {
    seedTeacherAuth();
    queues.student_groups = [{ data: [], error: null }];
    const res = await GET(makeRequest(CENTER_ID));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.groups).toEqual([]);
  });
});
