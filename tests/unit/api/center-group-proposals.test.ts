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
const filterCalls: { table: string; method: string; column: string; value: unknown }[] = [];
const insertCalls: { table: string; payload: Record<string, unknown> }[] = [];
const updateCalls: { table: string; payload: Record<string, unknown> }[] = [];
const deleteCalls: { table: string }[] = [];
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
        eq: (column: string, value: unknown) => {
          filterCalls.push({ table, method: 'eq', column, value });
          return builder;
        },
        in: (column: string, value: unknown) => {
          filterCalls.push({ table, method: 'in', column, value });
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => pop(key),
        then: (
          onFulfilled: (v: QueryResult) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) => Promise.resolve(pop(key)).then(onFulfilled, onRejected),
      };
      return builder;
    },
    insert: (payload: Record<string, unknown>) => {
      insertCalls.push({ table, payload });
      const result = () => pop(`${table}_insert`);
      return {
        select: () => ({ single: async () => result() }),
        then: (
          onFulfilled: (v: QueryResult) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) => Promise.resolve(result()).then(onFulfilled, onRejected),
      };
    },
    update: (payload: Record<string, unknown>) => {
      updateCalls.push({ table, payload });
      const upd = {
        eq: () => upd,
        then: (
          onFulfilled: (v: QueryResult) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) => Promise.resolve(pop(`${table}_update`)).then(onFulfilled, onRejected),
      };
      return upd;
    },
    delete: () => {
      deleteCalls.push({ table });
      const del = {
        eq: () => del,
        then: (
          onFulfilled: (v: QueryResult) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) => Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected),
      };
      return del;
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

import { GET, POST as CREATE } from '@/app/api/center/group-proposals/route';
import { POST as RESPOND } from '@/app/api/center/group-proposals/[proposalId]/respond/route';
import { GET as TEACHERS } from '@/app/api/center/teachers/route';

const OWNER_ID = 'owner-1';
const CENTER_ID = 'center-1';
const TEACHER_ID = 'teacher-1';
const PROPOSAL_ID = 'prop-1';

function seedCenterAuth(role = 'owner') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: OWNER_ID, email: '201000000000@centerhq.local' } },
    error: null,
  });
  queues.users_core = [
    { data: { id: OWNER_ID, center_id: CENTER_ID, role, phone: null }, error: null },
  ];
  queues.admin_users = [{ data: null, error: null }];
  queues.centers = [{ data: { status: 'active', is_blacklisted: false }, error: null }];
  queues.users_perms = [{ data: {}, error: null }];
}

// requireCenterAuth reads request.nextUrl.searchParams (super-admin center
// pivot); a plain Request lacks nextUrl, so attach one.
function withNextUrl(req: Request): NextRequest {
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(req.url);
  return req as unknown as NextRequest;
}

function makeGet(): NextRequest {
  return withNextUrl(
    new Request('http://localhost/api/center/group-proposals', {
      headers: { Authorization: 'Bearer tok' },
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
const params = { params: Promise.resolve({ proposalId: PROPOSAL_ID }) };

function makeCreate(body: Record<string, unknown>): NextRequest {
  return withNextUrl(
    new Request('http://localhost/api/center/group-proposals', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

function makeTeachers(): NextRequest {
  return withNextUrl(
    new Request('http://localhost/api/center/teachers', {
      headers: { Authorization: 'Bearer tok' },
    }),
  );
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockRpc.mockClear();
  for (const k of Object.keys(queues)) delete queues[k];
  filterCalls.length = 0;
  insertCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  rpcCalls.length = 0;
  rpcQueue.length = 0;
});

describe('GET /api/center/group-proposals', () => {
  it("lists ONLY the caller's center proposals (filter center_id = auth center)", async () => {
    seedCenterAuth();
    queues.group_proposals = [
      {
        data: [
          {
            id: PROPOSAL_ID,
            teacher_id: TEACHER_ID,
            center_id: CENTER_ID,
            subject: 'Math',
            grade_level: 'Grade 9',
            fee_per_class: 80,
            status: 'open',
            accepted_offer_id: null,
            opening_message: 'hi',
            expires_at: '2026-06-18T00:00:00Z',
            created_at: '2026-06-11T00:00:00Z',
          },
        ],
        error: null,
      },
    ];
    queues.group_proposal_offers = [
      {
        data: [
          { id: 'o1', proposal_id: PROPOSAL_ID, made_by: 'teacher', cut_egp: 15, note: null, created_at: '2026-06-11T00:00:00Z' },
        ],
        error: null,
      },
    ];
    queues.teacher_profiles = [
      { data: [{ user_id: TEACHER_ID, display_name: 'Mr. Ahmed' }], error: null },
    ];
    queues.users_display = [
      { data: [{ id: TEACHER_ID, name: 'ahmed', phone: '+201111111111' }], error: null },
    ];

    const res = await GET(makeGet());
    const json = await res.json();

    expect(res.status).toBe(200);
    // Tenant scoping: the proposals query is filtered by the centerAuth center
    // id, never a caller-supplied value.
    const scope = filterCalls.find(
      (f) => f.table === 'group_proposals' && f.column === 'center_id',
    );
    expect(scope?.value).toBe(CENTER_ID);
    expect(json.proposals).toHaveLength(1);
    const p = json.proposals[0];
    expect(p.teacherName).toBe('Mr. Ahmed');
    expect(p.teacherPhone).toBe('+201111111111');
    // Latest (only) offer is the teacher's -> the center's turn.
    expect(p.whoseTurn).toBe('center');
  });
});

describe('POST /api/center/group-proposals/[proposalId]/respond', () => {
  it('accept -> RPC side=center, returns accepted + group_id of the created student_groups row', async () => {
    seedCenterAuth();
    queues.group_proposals = [
      { data: { id: PROPOSAL_ID, center_id: CENTER_ID, fee_per_class: 80, status: 'open' }, error: null },
    ];
    rpcQueue.push({ data: [{ proposal_status: 'accepted', group_id: 'group-9' }], error: null });

    const res = await RESPOND(makeRespond({ action: 'accept' }), params);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ status: 'accepted', group_id: 'group-9' });
    expect(rpcCalls[0].fn).toBe('respond_group_proposal');
    expect(rpcCalls[0].args).toMatchObject({
      p_proposal_id: PROPOSAL_ID,
      p_actor_user_id: OWNER_ID,
      p_side: 'center',
      p_action: 'accept',
    });
  });

  it('counter -> RPC side=center with cut, returns open + offer_id', async () => {
    seedCenterAuth();
    queues.group_proposals = [
      { data: { id: PROPOSAL_ID, center_id: CENTER_ID, fee_per_class: 80, status: 'open' }, error: null },
    ];
    rpcQueue.push({ data: [{ proposal_status: 'open', group_id: null }], error: null });
    queues.group_proposal_offers = [{ data: { id: 'offer-7' }, error: null }];

    const res = await RESPOND(makeRespond({ action: 'counter', cut_egp: 25, note: 'deal?' }), params);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ status: 'open', offer_id: 'offer-7' });
    expect(rpcCalls[0].args).toMatchObject({
      p_side: 'center',
      p_action: 'counter',
      p_cut_egp: 25,
      p_note: 'deal?',
    });
  });

  it("a foreign center's proposal is a 404", async () => {
    seedCenterAuth();
    queues.group_proposals = [
      { data: { id: PROPOSAL_ID, center_id: 'other-center', fee_per_class: 80, status: 'open' }, error: null },
    ];

    const res = await RESPOND(makeRespond({ action: 'accept' }), params);

    expect(res.status).toBe(404);
    expect(rpcCalls).toHaveLength(0);
  });

  it('assistant without can_manage_students -> 403 PERMISSION_REQUIRED (fail closed)', async () => {
    seedCenterAuth('assistant');
    // Route-level permission lookup (after centerAuth's own perms select).
    queues.users_perms = [
      { data: {}, error: null },
      { data: { can_manage_students: false }, error: null },
    ];

    const res = await RESPOND(makeRespond({ action: 'accept' }), params);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe('PERMISSION_REQUIRED');
    expect(rpcCalls).toHaveLength(0);
  });

  it('withdraw -> RPC side=center (the center pulls its own standing offer)', async () => {
    seedCenterAuth();
    queues.group_proposals = [
      { data: { id: PROPOSAL_ID, center_id: CENTER_ID, fee_per_class: 80, status: 'open' }, error: null },
    ];
    rpcQueue.push({ data: [{ proposal_status: 'withdrawn', group_id: null }], error: null });

    const res = await RESPOND(makeRespond({ action: 'withdraw' }), params);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('withdrawn');
    expect(rpcCalls[0].args).toMatchObject({ p_side: 'center', p_action: 'withdraw' });
  });

  // Ref 2 & 3: a teacher reached this center by its code, so the proposal carries
  // a pending membership (carries_link=true, initiated_by='teacher'). accept must
  // go through the atomic center-acceptor RPC (commit link + attach together).
  it('teacher-by-code accept -> atomic center-acceptor RPC with p_center_id', async () => {
    seedCenterAuth();
    queues.group_proposals = [
      {
        data: {
          id: PROPOSAL_ID,
          center_id: CENTER_ID,
          teacher_id: TEACHER_ID,
          fee_per_class: 80,
          status: 'open',
          carries_link: true,
          initiated_by: 'teacher',
        },
        error: null,
      },
    ];
    rpcQueue.push({ data: [{ proposal_status: 'accepted', group_id: 'group-9' }], error: null });

    const res = await RESPOND(makeRespond({ action: 'accept' }), params);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ status: 'accepted', group_id: 'group-9' });
    expect(rpcCalls[0].fn).toBe('respond_teacher_code_group_proposal');
    expect(rpcCalls[0].args).toMatchObject({
      p_proposal_id: PROPOSAL_ID,
      p_center_id: CENTER_ID,
      p_actor_user_id: OWNER_ID,
      p_action: 'accept',
    });
  });

  it('teacher-by-code decline -> atomic center-acceptor RPC (tears the pending join down)', async () => {
    seedCenterAuth();
    queues.group_proposals = [
      {
        data: {
          id: PROPOSAL_ID,
          center_id: CENTER_ID,
          teacher_id: TEACHER_ID,
          fee_per_class: 80,
          status: 'open',
          carries_link: true,
          initiated_by: 'teacher',
        },
        error: null,
      },
    ];
    rpcQueue.push({ data: [{ proposal_status: 'declined', group_id: null }], error: null });

    const res = await RESPOND(makeRespond({ action: 'decline' }), params);

    expect(res.status).toBe(200);
    expect(rpcCalls[0].fn).toBe('respond_teacher_code_group_proposal');
    expect(rpcCalls[0].args).toMatchObject({ p_center_id: CENTER_ID, p_action: 'decline' });
  });

  it('center-initiated carries_link proposal still uses the canonical RPC (not the by-code one)', async () => {
    seedCenterAuth();
    queues.group_proposals = [
      {
        data: {
          id: PROPOSAL_ID,
          center_id: CENTER_ID,
          teacher_id: TEACHER_ID,
          fee_per_class: 80,
          status: 'open',
          carries_link: true,
          initiated_by: 'center',
        },
        error: null,
      },
    ];
    rpcQueue.push({ data: [{ proposal_status: 'withdrawn', group_id: null }], error: null });

    const res = await RESPOND(makeRespond({ action: 'withdraw' }), params);

    expect(res.status).toBe(200);
    expect(rpcCalls[0].fn).toBe('respond_group_proposal');
  });
});

describe('POST /api/center/group-proposals (owner-initiated)', () => {
  const VALID_CREATE = {
    teacher_id: TEACHER_ID,
    subject: 'Chemistry',
    grade_level: 'Grade 10',
    fee_per_class: 90,
    opening_cut_egp: 20,
    opening_message: 'join us',
  };

  it('already-active teacher: plain proposal (initiated_by=center, carries_link=false), no link write', async () => {
    seedCenterAuth();
    queues.teacher_center = [{ data: { id: 'tc-1', status: 'active' }, error: null }];
    queues.group_proposals_insert = [{ data: { id: PROPOSAL_ID }, error: null }];
    queues.group_proposal_offers_insert = [{ data: null, error: null }];

    const res = await CREATE(makeCreate(VALID_CREATE));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual({ proposal_id: PROPOSAL_ID, status: 'open' });
    // No link writes: the teacher is already a member.
    expect(updateCalls.filter((u) => u.table === 'teacher_center')).toHaveLength(0);
    expect(insertCalls.filter((i) => i.table === 'teacher_center')).toHaveLength(0);
    expect(insertCalls[0].table).toBe('group_proposals');
    expect(insertCalls[0].payload).toMatchObject({
      teacher_id: TEACHER_ID,
      center_id: CENTER_ID,
      subject: 'Chemistry',
      fee_per_class: 90,
      initiated_by: 'center',
      carries_link: false,
      status: 'open',
    });
    expect(insertCalls[1].table).toBe('group_proposal_offers');
    expect(insertCalls[1].payload).toMatchObject({
      proposal_id: PROPOSAL_ID,
      made_by: 'center',
      cut_egp: 20,
    });
  });

  it('COMBINED: not-yet-linked teacher_id creates a PENDING link + carries_link proposal (201)', async () => {
    seedCenterAuth();
    queues.teacher_center = [{ data: null, error: null }]; // no membership yet
    queues.teacher_center_insert = [{ data: null, error: null }];
    queues.group_proposals_insert = [{ data: { id: PROPOSAL_ID }, error: null }];
    queues.group_proposal_offers_insert = [{ data: null, error: null }];

    const res = await CREATE(makeCreate(VALID_CREATE));
    const json = await res.json();

    expect(res.status).toBe(201);
    // The link half: a pending teacher_center row was created (no UPDATE - there
    // was no prior row to reactivate).
    const linkInsert = insertCalls.find((i) => i.table === 'teacher_center');
    expect(linkInsert?.payload).toMatchObject({
      teacher_id: TEACHER_ID,
      center_id: CENTER_ID,
      status: 'pending',
      invited_by: OWNER_ID,
    });
    // The proposal half carries the link flag.
    const propInsert = insertCalls.find((i) => i.table === 'group_proposals');
    expect(propInsert?.payload).toMatchObject({ initiated_by: 'center', carries_link: true });
  });

  it('COMBINED: an inactive prior membership is reactivated to PENDING (update, not insert)', async () => {
    seedCenterAuth();
    queues.teacher_center = [{ data: { id: 'tc-9', status: 'inactive' }, error: null }];
    queues.teacher_center_update = [{ data: null, error: null }];
    queues.group_proposals_insert = [{ data: { id: PROPOSAL_ID }, error: null }];
    queues.group_proposal_offers_insert = [{ data: null, error: null }];

    const res = await CREATE(makeCreate(VALID_CREATE));

    expect(res.status).toBe(201);
    const linkUpdate = updateCalls.find((u) => u.table === 'teacher_center');
    expect(linkUpdate?.payload).toMatchObject({ status: 'pending', invited_by: OWNER_ID });
    expect(insertCalls.find((i) => i.table === 'teacher_center')).toBeUndefined();
  });

  it('COMBINED: teacher_code resolves an unlinked teacher -> pending link + carries_link proposal', async () => {
    seedCenterAuth();
    // resolveTeacherReferralCode: teacher_profiles.user_id by referral_code.
    queues.teacher_profiles = [{ data: { user_id: TEACHER_ID }, error: null }];
    queues.teacher_center = [{ data: null, error: null }];
    queues.teacher_center_insert = [{ data: null, error: null }];
    queues.group_proposals_insert = [{ data: { id: PROPOSAL_ID }, error: null }];
    queues.group_proposal_offers_insert = [{ data: null, error: null }];

    const { teacher_id: _omit, ...rest } = VALID_CREATE;
    void _omit;
    const res = await CREATE(makeCreate({ ...rest, teacher_code: 'AHMED7X' }));

    expect(res.status).toBe(201);
    expect(insertCalls.find((i) => i.table === 'teacher_center')?.payload).toMatchObject({
      status: 'pending',
    });
    expect(insertCalls.find((i) => i.table === 'group_proposals')?.payload).toMatchObject({
      teacher_id: TEACHER_ID,
      carries_link: true,
    });
  });

  it('an unknown teacher_code is a 404 TEACHER_CODE_NOT_FOUND with no writes', async () => {
    seedCenterAuth();
    queues.teacher_profiles = [{ data: null, error: null }]; // code resolves to nothing

    const { teacher_id: _omit, ...rest } = VALID_CREATE;
    void _omit;
    const res = await CREATE(makeCreate({ ...rest, teacher_code: 'NOPE' }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.code).toBe('TEACHER_CODE_NOT_FOUND');
    expect(insertCalls).toHaveLength(0);
  });

  it('rejects opening cut >= fee_per_class (400) before any DB write', async () => {
    seedCenterAuth();

    const res = await CREATE(makeCreate({ ...VALID_CREATE, opening_cut_egp: 90 }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('CUT_NOT_LESS_THAN_FEE');
    expect(insertCalls).toHaveLength(0);
  });

  it('a duplicate open proposal (unique 23505) -> 409 PROPOSAL_ALREADY_OPEN', async () => {
    seedCenterAuth();
    queues.teacher_center = [{ data: { id: 'tc-1', status: 'active' }, error: null }];
    queues.group_proposals_insert = [
      { data: null, error: { message: 'duplicate key', code: '23505' } },
    ];

    const res = await CREATE(makeCreate(VALID_CREATE));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('PROPOSAL_ALREADY_OPEN');
  });

  it('an assistant without can_manage_students cannot start a proposal (403, fail closed)', async () => {
    seedCenterAuth('assistant');
    queues.users_perms = [
      { data: {}, error: null },
      { data: { can_manage_students: false }, error: null },
    ];

    const res = await CREATE(makeCreate(VALID_CREATE));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe('PERMISSION_REQUIRED');
    expect(insertCalls).toHaveLength(0);
  });
});

describe('GET /api/center/teachers', () => {
  it('lists active linked teachers for the picker, scoped to the caller center', async () => {
    seedCenterAuth();
    queues.teacher_center = [{ data: [{ teacher_id: TEACHER_ID }], error: null }];
    queues.teacher_profiles = [
      { data: [{ user_id: TEACHER_ID, display_name: 'Mr. Ahmed', subject: 'Math' }], error: null },
    ];
    queues.users_display = [{ data: [{ id: TEACHER_ID, name: 'ahmed' }], error: null }];

    const res = await TEACHERS(makeTeachers());
    const json = await res.json();

    expect(res.status).toBe(200);
    const scope = filterCalls.find(
      (f) => f.table === 'teacher_center' && f.column === 'center_id',
    );
    expect(scope?.value).toBe(CENTER_ID);
    expect(json.teachers).toEqual([{ id: TEACHER_ID, name: 'Mr. Ahmed', subject: 'Math' }]);
  });

  it('returns an empty list when the center has no linked teachers', async () => {
    seedCenterAuth();
    queues.teacher_center = [{ data: [], error: null }];

    const res = await TEACHERS(makeTeachers());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.teachers).toEqual([]);
  });
});
