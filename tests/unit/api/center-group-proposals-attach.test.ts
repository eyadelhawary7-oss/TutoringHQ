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
const insertCalls: { table: string; payload: Record<string, unknown> }[] = [];
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
const rpcQueue: QueryResult[] = [];

function queueKey(table: string, cols: string): string {
  if (table === 'users') {
    if (cols.startsWith('id, center_id')) return 'users_core';
    if (cols.includes('can_')) return 'users_perms';
    return 'users_display';
  }
  return table;
}
function pop(key: string): QueryResult {
  return queues[key]?.shift() ?? { data: null, error: null };
}

const mockRpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
  rpcCalls.push({ fn, args });
  return rpcQueue.shift() ?? { data: null, error: null };
});

const mockAdmin = {
  rpc: mockRpc,
  from: (table: string) => ({
    select: (cols: string) => {
      const key = queueKey(table, cols);
      const builder = {
        eq: () => builder,
        in: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => builder,
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
    update: () => {
      const upd = {
        eq: () => upd,
        then: (onF: (v: QueryResult) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(onF, onR),
      };
      return upd;
    },
    delete: () => {
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
  withScope: vi.fn((cb: (s: { setTag: () => void }) => void) => cb({ setTag: vi.fn() } as never)),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { POST as CREATE } from '@/app/api/center/group-proposals/route';
import { POST as RESPOND } from '@/app/api/center/group-proposals/[proposalId]/respond/route';

const OWNER_ID = 'owner-1';
const CENTER_ID = 'center-1';
const TEACHER_ID = 'teacher-1';
const GROUP_ID = 'group-1';
const PROPOSAL_ID = 'prop-1';

function seedCenterAuth(role = 'owner') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: OWNER_ID, email: '201000000000@centerhq.local' } },
    error: null,
  });
  queues.users_core = [{ data: { id: OWNER_ID, center_id: CENTER_ID, role, phone: null }, error: null }];
  queues.admin_users = [{ data: null, error: null }];
  queues.centers = [{ data: { status: 'active', is_blacklisted: false }, error: null }];
  queues.users_perms = [{ data: {}, error: null }];
}

function withNextUrl(req: Request): NextRequest {
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(req.url);
  return req as unknown as NextRequest;
}
function makeCreate(body: Record<string, unknown>): NextRequest {
  return withNextUrl(
    new Request('http://localhost/api/center/group-proposals', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}
function makeRespond(body: Record<string, unknown>): NextRequest {
  return withNextUrl(
    new Request(`http://localhost/api/center/group-proposals/${PROPOSAL_ID}/respond`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}
const respondParams = { params: Promise.resolve({ proposalId: PROPOSAL_ID }) };

beforeEach(() => {
  mockGetUser.mockReset();
  mockRpc.mockClear();
  for (const k of Object.keys(queues)) delete queues[k];
  insertCalls.length = 0;
  rpcCalls.length = 0;
  rpcQueue.length = 0;
});

describe('POST /api/center/group-proposals (attach to existing group)', () => {
  it('attaches against a teacher-less center group: subject + fee derived from the group', async () => {
    seedCenterAuth();
    queues.student_groups = [
      {
        data: { id: GROUP_ID, center_id: CENTER_ID, kind: 'center', teacher_id: null, subject: 'Physics', fee_per_class: 100 },
        error: null,
      },
    ];
    queues.teacher_center = [{ data: { id: 'tc-1', status: 'active' }, error: null }];
    queues.group_proposals_insert = [{ data: { id: PROPOSAL_ID }, error: null }];
    queues.group_proposal_offers_insert = [{ data: null, error: null }];

    const res = await CREATE(
      makeCreate({ teacher_id: TEACHER_ID, target_group_id: GROUP_ID, opening_cut_egp: 30 }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual({ proposal_id: PROPOSAL_ID, status: 'open' });
    const proposal = insertCalls.find((i) => i.table === 'group_proposals');
    expect(proposal?.payload).toMatchObject({
      teacher_id: TEACHER_ID,
      center_id: CENTER_ID,
      subject: 'Physics', // from the group, not the body
      fee_per_class: 100, // from the group, not the body
      target_group_id: GROUP_ID,
      initiated_by: 'center',
    });
  });

  it('rejects attaching to a group that already has a teacher (409 GROUP_HAS_TEACHER)', async () => {
    seedCenterAuth();
    queues.student_groups = [
      {
        data: { id: GROUP_ID, center_id: CENTER_ID, kind: 'center', teacher_id: 'someone', subject: 'Physics', fee_per_class: 100 },
        error: null,
      },
    ];

    const res = await CREATE(
      makeCreate({ teacher_id: TEACHER_ID, target_group_id: GROUP_ID, opening_cut_egp: 30 }),
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('GROUP_HAS_TEACHER');
    expect(insertCalls).toHaveLength(0);
  });

  it("rejects a target group from another center (404 GROUP_NOT_FOUND)", async () => {
    seedCenterAuth();
    queues.student_groups = [
      {
        data: { id: GROUP_ID, center_id: 'other-center', kind: 'center', teacher_id: null, subject: 'Physics', fee_per_class: 100 },
        error: null,
      },
    ];

    const res = await CREATE(
      makeCreate({ teacher_id: TEACHER_ID, target_group_id: GROUP_ID, opening_cut_egp: 30 }),
    );
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.code).toBe('GROUP_NOT_FOUND');
    expect(insertCalls).toHaveLength(0);
  });

  it('rejects an opening cut >= the group fee (400) before any write', async () => {
    seedCenterAuth();
    queues.student_groups = [
      {
        data: { id: GROUP_ID, center_id: CENTER_ID, kind: 'center', teacher_id: null, subject: 'Physics', fee_per_class: 100 },
        error: null,
      },
    ];

    const res = await CREATE(
      makeCreate({ teacher_id: TEACHER_ID, target_group_id: GROUP_ID, opening_cut_egp: 100 }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('CUT_NOT_LESS_THAN_FEE');
    expect(insertCalls).toHaveLength(0);
  });
});

describe('POST respond — attach accept error mapping', () => {
  it('maps the RPC "already has a teacher" rejection to 409 GROUP_HAS_TEACHER', async () => {
    seedCenterAuth();
    queues.group_proposals = [
      { data: { id: PROPOSAL_ID, center_id: CENTER_ID, fee_per_class: 100, status: 'open' }, error: null },
    ];
    rpcQueue.push({
      data: null,
      error: { code: '23514', message: 'target group group-1 already has a teacher' },
    });

    const res = await RESPOND(makeRespond({ action: 'accept' }), respondParams);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('GROUP_HAS_TEACHER');
    expect(rpcCalls[0].args).toMatchObject({ p_side: 'center', p_action: 'accept' });
  });
});
