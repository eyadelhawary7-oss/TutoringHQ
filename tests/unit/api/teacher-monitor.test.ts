import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const mockGetUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mockGetUser } })),
}));

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };

const queues: Record<string, QueryResult[]> = {};
const filterCalls: { table: string; method: string; column: string; value: unknown }[] = [];

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
        then: (onF: (v: QueryResult) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve(pop(key)).then(onF, onR),
      };
      return builder;
    },
  }),
};

vi.mock('@/lib/supabase-admin', () => ({ getSupabaseAdmin: () => mockAdmin }));
vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn((cb: (s: { setTag: () => void }) => void) => cb({ setTag: vi.fn() } as never)),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { GET } from '@/app/api/center/teacher-monitor/route';

const OWNER_ID = 'owner-1';
const CENTER_ID = 'center-1';
const T1 = 'teacher-1';

function seedOwner(role = 'owner') {
  mockGetUser.mockResolvedValue({ data: { user: { id: OWNER_ID } }, error: null });
  queues.users_core = [{ data: { id: OWNER_ID, role, center_id: CENTER_ID }, error: null }];
}

function makeReq() {
  return new Request('http://localhost/api/center/teacher-monitor', {
    headers: { Authorization: 'Bearer tok' },
  });
}

beforeEach(() => {
  mockGetUser.mockReset();
  for (const k of Object.keys(queues)) delete queues[k];
  filterCalls.length = 0;
});

describe('GET /api/center/teacher-monitor', () => {
  it('returns per-teacher groups + money scoped to THIS center, no subscription fields', async () => {
    seedOwner();
    queues.teacher_center = [{ data: [{ teacher_id: T1 }], error: null }];
    queues.teacher_profiles = [
      { data: [{ user_id: T1, display_name: 'Mr. Ahmed', subject: 'Math' }], error: null },
    ];
    queues.users_display = [{ data: [{ id: T1, name: 'ahmed' }], error: null }];
    queues.student_groups = [
      {
        data: [
          { id: 'g1', name: 'Math A', subject: 'Math', fee_per_class: 80, center_cut_egp: 20, teacher_id: T1 },
        ],
        error: null,
      },
    ];
    queues.student_group_members = [
      { data: [{ group_id: 'g1' }, { group_id: 'g1' }, { group_id: 'g1' }], error: null },
    ];
    queues.transactions = [
      {
        data: [
          { teacher_id: T1, kind: 'lesson', status: 'paid', amount_billed: 80 },
          { teacher_id: T1, kind: 'lesson', status: 'paid', amount_billed: 80 },
          { teacher_id: T1, kind: 'center_fee', status: 'paid', amount_billed: 20 },
          { teacher_id: T1, kind: 'lesson', status: 'pending', amount_billed: 80 },
        ],
        error: null,
      },
    ];

    const res = await GET(makeReq());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.teachers).toHaveLength(1);
    const tc = json.teachers[0];
    expect(tc.name).toBe('Mr. Ahmed');
    expect(tc.groups).toEqual([
      { id: 'g1', name: 'Math A', subject: 'Math', studentCount: 3, feePerClass: 80, centerCutEgp: 20 },
    ]);
    // feesCollected = 160 (paid lessons), centerCut = 20, teacherEarnings = 140, outstanding = 80.
    expect(tc.money).toEqual({
      feesCollected: 160,
      centerCutEarned: 20,
      teacherEarnings: 140,
      feesOutstanding: 80,
    });

    // No subscription / cross-center leakage in the payload shape.
    const blob = JSON.stringify(json).toLowerCase();
    expect(blob).not.toContain('subscription');
    expect(blob).not.toContain('plan_key');
    expect(Object.keys(tc).sort()).toEqual(['groups', 'id', 'money', 'name', 'subject']);

    // Center scoping on every money/membership/group query.
    expect(filterCalls.find((f) => f.table === 'teacher_center' && f.column === 'center_id')?.value).toBe(CENTER_ID);
    expect(filterCalls.find((f) => f.table === 'student_groups' && f.column === 'center_id')?.value).toBe(CENTER_ID);
    expect(filterCalls.find((f) => f.table === 'transactions' && f.column === 'center_id')?.value).toBe(CENTER_ID);
    // Test rows excluded from the finance view.
    expect(filterCalls.find((f) => f.table === 'transactions' && f.column === 'is_test')?.value).toBe(false);
  });

  it('refuses a non-owner/admin caller (401)', async () => {
    seedOwner('assistant');
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('returns an empty list when no teachers are linked', async () => {
    seedOwner();
    queues.teacher_center = [{ data: [], error: null }];
    const res = await GET(makeReq());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.teachers).toEqual([]);
  });
});
