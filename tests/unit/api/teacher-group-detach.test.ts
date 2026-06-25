import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.SUPER_ADMIN_PHONES = '';
delete process.env.CSRF_SECRET;
// CSRF now fails closed when CSRF_SECRET is unset (see csrfFailClosed.test.ts).
// These specs exercise route logic, not CSRF, so mock it to pass.
vi.mock('@/lib/csrf', () => ({
  validateCSRFRequest: () => true,
  isCSRFEnabled: () => true,
  generateCSRFToken: () => 'test-token',
  validateCSRFToken: () => true,
}));

const mockGetUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mockGetUser } })),
}));

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };

const queues: Record<string, QueryResult[]> = {};
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
const rpcQueue: QueryResult[] = [];

function pop(key: string): QueryResult {
  return queues[key]?.shift() ?? { data: null, error: null };
}
function queueKey(table: string): string {
  return table === 'users' ? 'users_core' : table;
}

const mockRpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
  rpcCalls.push({ fn, args });
  return rpcQueue.shift() ?? { data: null, error: null };
});

const mockAdmin = {
  rpc: mockRpc,
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
  }),
};

vi.mock('@/lib/supabase-admin', () => ({ getSupabaseAdmin: () => mockAdmin }));
vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn((cb: (scope: { setTag: () => void }) => void) => cb({ setTag: vi.fn() } as never)),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { POST } from '@/app/api/teacher/group-detach/route';

const TEACHER_ID = 'teacher-1';
const GROUP_ID = 'group-7';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/teacher/group-detach', {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function seedTeacherAuth() {
  mockGetUser.mockResolvedValue({
    data: { user: { id: TEACHER_ID, email: '201000000000@centerhq.local' } },
    error: null,
  });
  queues.users_core = [{ data: { id: TEACHER_ID, role: 'teacher' }, error: null }];
  queues.teacher_center = [{ data: [], error: null }];
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockRpc.mockClear();
  for (const k of Object.keys(queues)) delete queues[k];
  rpcCalls.length = 0;
  rpcQueue.length = 0;
});

describe('POST /api/teacher/group-detach', () => {
  it('happy path: private access granted, RPC flips the group back to private', async () => {
    seedTeacherAuth();
    // requireTeacherPrivateAccess gate, then the detach RPC.
    rpcQueue.push({ data: true, error: null });
    rpcQueue.push({ data: [{ group_id: GROUP_ID, group_kind: 'private' }], error: null });

    const res = await POST(makeRequest({ group_id: GROUP_ID }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ status: 'private', group_id: GROUP_ID });
    expect(rpcCalls[0].fn).toBe('teacher_private_access');
    expect(rpcCalls[1].fn).toBe('detach_center_from_group');
    expect(rpcCalls[1].args).toMatchObject({ p_group_id: GROUP_ID, p_actor_user_id: TEACHER_ID });
  });

  it('without private access -> 403, detach RPC never runs', async () => {
    seedTeacherAuth();
    rpcQueue.push({ data: false, error: null });

    const res = await POST(makeRequest({ group_id: GROUP_ID }));

    expect(res.status).toBe(403);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('teacher_private_access');
  });

  it("a foreign/unknown group is a 404 (RPC raises P0002, no existence oracle)", async () => {
    seedTeacherAuth();
    rpcQueue.push({ data: true, error: null });
    rpcQueue.push({ data: null, error: { message: 'group x not found', code: 'P0002' } });

    const res = await POST(makeRequest({ group_id: GROUP_ID }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.code).toBe('NOT_FOUND');
  });

  it('a group that is not center-attached -> 409 NOT_ATTACHED', async () => {
    seedTeacherAuth();
    rpcQueue.push({ data: true, error: null });
    rpcQueue.push({ data: null, error: { message: 'group x is not center-attached', code: '23514' } });

    const res = await POST(makeRequest({ group_id: GROUP_ID }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('NOT_ATTACHED');
  });
});
