import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const mockGetUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mockGetUser } })),
}));

type QueryResult = { data: unknown; error: { message: string } | null };

const queues: Record<string, QueryResult[]> = {};
const filterCalls: { table: string; column: string; value: unknown }[] = [];

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
          filterCalls.push({ table, column, value });
          return builder;
        },
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

import { GET } from '@/app/api/teacher/profile/route';

const TEACHER_ID = 'teacher-1';

function seedTeacher(role = 'teacher') {
  mockGetUser.mockResolvedValue({ data: { user: { id: TEACHER_ID } }, error: null });
  queues.users_core = [{ data: { id: TEACHER_ID, role }, error: null }];
  queues.teacher_center = [{ data: [], error: null }];
}

function makeReq(token = 'tok'): NextRequest {
  const req = new Request('http://localhost/api/teacher/profile', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(req.url);
  return req as unknown as NextRequest;
}

beforeEach(() => {
  mockGetUser.mockReset();
  for (const k of Object.keys(queues)) delete queues[k];
  filterCalls.length = 0;
});

describe('GET /api/teacher/profile', () => {
  it("returns the teacher's own referralCode, scoped to user_id = auth.userId", async () => {
    seedTeacher();
    queues.teacher_profiles = [
      { data: { display_name: 'Mr. Ahmed', subject: 'Math', referral_code: 'AHMED7X' }, error: null },
    ];

    const res = await GET(makeReq());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.referralCode).toBe('AHMED7X');

    // The profile row is fetched by the AUTHED user's id only - never a value
    // from the request - so a teacher can never read another teacher's code.
    const scope = filterCalls.find((f) => f.table === 'teacher_profiles' && f.column === 'user_id');
    expect(scope?.value).toBe(TEACHER_ID);
  });

  it('returns null referralCode when the teacher has no profile row yet', async () => {
    seedTeacher();
    queues.teacher_profiles = [{ data: null, error: null }];

    const res = await GET(makeReq());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.referralCode).toBeNull();
  });

  it('rejects a non-teacher caller (403), never reaching the profile read', async () => {
    seedTeacher('owner');
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
    expect(filterCalls.find((f) => f.table === 'teacher_profiles')).toBeUndefined();
  });

  it('rejects an unauthenticated caller (401)', async () => {
    const res = await GET(makeReq(''));
    expect(res.status).toBe(401);
  });
});
