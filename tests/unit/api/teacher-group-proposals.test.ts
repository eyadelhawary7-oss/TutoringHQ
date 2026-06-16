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
const insertCalls: { table: string; payload: Record<string, unknown> }[] = [];
const deleteCalls: { table: string }[] = [];
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
const rpcQueue: QueryResult[] = [];

function pop(key: string): QueryResult {
  return queues[key]?.shift() ?? { data: null, error: null };
}

function queueKey(table: string, cols: string): string {
  if (table === 'users') return 'users_core';
  return table;
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

import { POST, GET } from '@/app/api/teacher/group-proposals/route';
import { POST as RESPOND } from '@/app/api/teacher/group-proposals/[proposalId]/respond/route';

const TEACHER_ID = 'teacher-1';
const CENTER_ID = 'center-1';
const PROPOSAL_ID = 'prop-1';

function makeRequest(body?: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/teacher/group-proposals', {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer tok', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }) as unknown as NextRequest;
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
  mockRpc.mockClear();
  for (const k of Object.keys(queues)) delete queues[k];
  filterCalls.length = 0;
  insertCalls.length = 0;
  deleteCalls.length = 0;
  rpcCalls.length = 0;
  rpcQueue.length = 0;
});

const VALID_BODY = {
  center_id: CENTER_ID,
  subject: 'Physics',
  grade_level: 'Grade 11',
  fee_per_class: 100,
  opening_cut_egp: 20,
  opening_message: 'hello',
};

describe('POST /api/teacher/group-proposals', () => {
  it('rejects a teacher who is not an active member of the center (403 NOT_A_MEMBER)', async () => {
    seedTeacherAuth(['other-center']);

    const res = await POST(makeRequest(VALID_BODY));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe('NOT_A_MEMBER');
    expect(insertCalls).toHaveLength(0);
  });

  it('rejects a duplicate open proposal (unique index 23505 -> 409 PROPOSAL_ALREADY_OPEN)', async () => {
    seedTeacherAuth();
    queues.group_proposals_insert = [
      { data: null, error: { message: 'duplicate key', code: '23505' } },
    ];

    const res = await POST(makeRequest(VALID_BODY));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('PROPOSAL_ALREADY_OPEN');
  });

  it('rejects opening cut >= fee_per_class (400 CUT_NOT_LESS_THAN_FEE)', async () => {
    seedTeacherAuth();

    const res = await POST(makeRequest({ ...VALID_BODY, opening_cut_egp: 100 }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('CUT_NOT_LESS_THAN_FEE');
    expect(insertCalls).toHaveLength(0);
  });

  it('happy path: inserts proposal + opening teacher offer, returns 201 open', async () => {
    seedTeacherAuth();
    queues.group_proposals_insert = [{ data: { id: PROPOSAL_ID }, error: null }];
    queues.group_proposal_offers_insert = [{ data: null, error: null }];

    const res = await POST(makeRequest(VALID_BODY));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual({ proposal_id: PROPOSAL_ID, status: 'open' });
    expect(insertCalls[0].table).toBe('group_proposals');
    expect(insertCalls[0].payload).toMatchObject({
      teacher_id: TEACHER_ID,
      center_id: CENTER_ID,
      subject: 'Physics',
      fee_per_class: 100,
      status: 'open',
    });
    expect(insertCalls[1].table).toBe('group_proposal_offers');
    expect(insertCalls[1].payload).toMatchObject({
      proposal_id: PROPOSAL_ID,
      made_by: 'teacher',
      cut_egp: 20,
    });
  });
});

describe('POST /api/teacher/group-proposals (request an existing group)', () => {
  const GROUP_ID = 'group-7';
  const ATTACH_BODY = {
    target_group_id: GROUP_ID,
    opening_cut_egp: 20,
    opening_message: 'I would like to run this group',
  };

  it('happy path: reads subject + fee FROM the group, inserts proposal with target_group_id and a teacher opening offer', async () => {
    seedTeacherAuth();
    queues.student_groups = [
      {
        data: {
          id: GROUP_ID,
          center_id: CENTER_ID,
          kind: 'center',
          teacher_id: null,
          subject: 'Chemistry',
          fee_per_class: 120,
        },
        error: null,
      },
    ];
    queues.group_proposals_insert = [{ data: { id: PROPOSAL_ID }, error: null }];
    queues.group_proposal_offers_insert = [{ data: null, error: null }];

    const res = await POST(makeRequest(ATTACH_BODY));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual({ proposal_id: PROPOSAL_ID, status: 'open' });
    const propInsert = insertCalls.find((i) => i.table === 'group_proposals');
    expect(propInsert?.payload).toMatchObject({
      teacher_id: TEACHER_ID,
      center_id: CENTER_ID,
      subject: 'Chemistry',
      fee_per_class: 120,
      target_group_id: GROUP_ID,
      status: 'open',
    });
    // initiated_by is left to the DB default ('teacher'); no link is ever carried.
    expect(propInsert?.payload).not.toHaveProperty('carries_link', true);
    const offerInsert = insertCalls.find((i) => i.table === 'group_proposal_offers');
    expect(offerInsert?.payload).toMatchObject({ proposal_id: PROPOSAL_ID, made_by: 'teacher', cut_egp: 20 });
  });

  it('rejects a group that already has a teacher (409 GROUP_HAS_TEACHER)', async () => {
    seedTeacherAuth();
    queues.student_groups = [
      {
        data: {
          id: GROUP_ID,
          center_id: CENTER_ID,
          kind: 'center',
          teacher_id: 'other-teacher',
          subject: 'Chemistry',
          fee_per_class: 120,
        },
        error: null,
      },
    ];

    const res = await POST(makeRequest(ATTACH_BODY));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('GROUP_HAS_TEACHER');
    expect(insertCalls).toHaveLength(0);
  });

  it('rejects a group at a center the teacher is not a member of (403 NOT_A_MEMBER, no existence oracle)', async () => {
    seedTeacherAuth(['other-center']);
    queues.student_groups = [
      {
        data: {
          id: GROUP_ID,
          center_id: CENTER_ID,
          kind: 'center',
          teacher_id: null,
          subject: 'Chemistry',
          fee_per_class: 120,
        },
        error: null,
      },
    ];

    const res = await POST(makeRequest(ATTACH_BODY));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe('NOT_A_MEMBER');
    expect(insertCalls).toHaveLength(0);
  });

  it('never bypasses the cut bound: opening cut >= the group fee -> 400 CUT_NOT_LESS_THAN_FEE', async () => {
    seedTeacherAuth();
    queues.student_groups = [
      {
        data: {
          id: GROUP_ID,
          center_id: CENTER_ID,
          kind: 'center',
          teacher_id: null,
          subject: 'Chemistry',
          fee_per_class: 120,
        },
        error: null,
      },
    ];

    const res = await POST(makeRequest({ ...ATTACH_BODY, opening_cut_egp: 120 }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('CUT_NOT_LESS_THAN_FEE');
    expect(insertCalls).toHaveLength(0);
  });

  it('rejects a duplicate open attach (unique index 23505 -> 409 PROPOSAL_ALREADY_OPEN)', async () => {
    seedTeacherAuth();
    queues.student_groups = [
      {
        data: {
          id: GROUP_ID,
          center_id: CENTER_ID,
          kind: 'center',
          teacher_id: null,
          subject: 'Chemistry',
          fee_per_class: 120,
        },
        error: null,
      },
    ];
    queues.group_proposals_insert = [
      { data: null, error: { message: 'duplicate key', code: '23505' } },
    ];

    const res = await POST(makeRequest(ATTACH_BODY));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('PROPOSAL_ALREADY_OPEN');
  });
});

describe('GET /api/teacher/group-proposals', () => {
  it('returns proposals with latest offer, count and whose_turn', async () => {
    seedTeacherAuth();
    queues.group_proposals = [
      {
        data: [
          {
            id: PROPOSAL_ID,
            teacher_id: TEACHER_ID,
            center_id: CENTER_ID,
            subject: 'Physics',
            grade_level: null,
            fee_per_class: 100,
            status: 'open',
            accepted_offer_id: null,
            opening_message: null,
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
          { id: 'o1', proposal_id: PROPOSAL_ID, made_by: 'teacher', cut_egp: 20, note: null, created_at: '2026-06-11T00:00:00Z' },
          { id: 'o2', proposal_id: PROPOSAL_ID, made_by: 'center', cut_egp: 30, note: null, created_at: '2026-06-11T01:00:00Z' },
        ],
        error: null,
      },
    ];
    queues.centers = [{ data: [{ id: CENTER_ID, name: 'Alpha Center' }], error: null }];

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.proposals).toHaveLength(1);
    const p = json.proposals[0];
    expect(p.centerName).toBe('Alpha Center');
    expect(p.offerCount).toBe(2);
    expect(p.latestOffer.madeBy).toBe('center');
    expect(p.latestOffer.cutEgp).toBe(30);
    // Latest offer is the center's -> it is the teacher's turn.
    expect(p.whoseTurn).toBe('teacher');
    expect(p.offers.map((o: { id: string }) => o.id)).toEqual(['o1', 'o2']);
  });
});

describe('POST /api/teacher/group-proposals/[proposalId]/respond', () => {
  function respondRequest(body: Record<string, unknown>): NextRequest {
    return new Request(
      `http://localhost/api/teacher/group-proposals/${PROPOSAL_ID}/respond`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer tok', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    ) as unknown as NextRequest;
  }
  const params = { params: Promise.resolve({ proposalId: PROPOSAL_ID }) };

  it('accept when it is NOT the teacher turn -> 409 NOT_YOUR_TURN (RPC enforces turn order)', async () => {
    seedTeacherAuth();
    queues.group_proposals = [
      { data: { id: PROPOSAL_ID, teacher_id: TEACHER_ID, fee_per_class: 100, status: 'open' }, error: null },
    ];
    rpcQueue.push({
      data: null,
      error: { message: 'not your turn: latest offer was made by teacher', code: '23514' },
    });

    const res = await RESPOND(respondRequest({ action: 'accept' }), params);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('NOT_YOUR_TURN');
    expect(rpcCalls[0].fn).toBe('respond_group_proposal');
    expect(rpcCalls[0].args).toMatchObject({ p_side: 'teacher', p_action: 'accept' });
  });

  it("a foreign teacher's proposal is a 404 (no existence oracle)", async () => {
    seedTeacherAuth();
    queues.group_proposals = [
      { data: { id: PROPOSAL_ID, teacher_id: 'someone-else', fee_per_class: 100, status: 'open' }, error: null },
    ];

    const res = await RESPOND(respondRequest({ action: 'withdraw' }), params);

    expect(res.status).toBe(404);
    expect(rpcCalls).toHaveLength(0);
  });

  it('withdraw while open -> 200 withdrawn', async () => {
    seedTeacherAuth();
    queues.group_proposals = [
      { data: { id: PROPOSAL_ID, teacher_id: TEACHER_ID, fee_per_class: 100, status: 'open' }, error: null },
    ];
    rpcQueue.push({ data: [{ proposal_status: 'withdrawn', group_id: null }], error: null });

    const res = await RESPOND(respondRequest({ action: 'withdraw' }), params);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('withdrawn');
    expect(rpcCalls[0].args).toMatchObject({
      p_proposal_id: PROPOSAL_ID,
      p_actor_user_id: TEACHER_ID,
      p_side: 'teacher',
      p_action: 'withdraw',
    });
  });

  it('counter with cut >= fee_per_class -> 400 CUT_NOT_LESS_THAN_FEE before the RPC', async () => {
    seedTeacherAuth();
    queues.group_proposals = [
      { data: { id: PROPOSAL_ID, teacher_id: TEACHER_ID, fee_per_class: 100, status: 'open' }, error: null },
    ];

    const res = await RESPOND(respondRequest({ action: 'counter', cut_egp: 150 }), params);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('CUT_NOT_LESS_THAN_FEE');
    expect(rpcCalls).toHaveLength(0);
  });

  // --- Combined center-initiated requests (carries_link) -------------------
  // A carries_link proposal bundles the teacher<->center link with the group
  // proposal. The teacher's accept/counter/decline must resolve BOTH atomically,
  // so the route delegates to the single respond_center_group_proposal RPC -
  // never a separate teacher_center write here (that is what makes a half-state
  // impossible: link + proposal commit or roll back together inside the RPC).
  function seedCombinedProposal() {
    queues.group_proposals = [
      {
        data: {
          id: PROPOSAL_ID,
          teacher_id: TEACHER_ID,
          fee_per_class: 100,
          status: 'open',
          carries_link: true,
        },
        error: null,
      },
    ];
  }

  it('ACCEPT on a carries_link proposal routes to the atomic combined RPC, returns accepted + group_id', async () => {
    seedTeacherAuth();
    seedCombinedProposal();
    rpcQueue.push({ data: [{ proposal_status: 'accepted', group_id: 'group-42' }], error: null });

    const res = await RESPOND(respondRequest({ action: 'accept' }), params);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ status: 'accepted', group_id: 'group-42' });
    // Exactly one transactional RPC; no side-channel link writes in the route.
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('respond_center_group_proposal');
    expect(rpcCalls[0].args).toMatchObject({
      p_proposal_id: PROPOSAL_ID,
      p_actor_user_id: TEACHER_ID,
      p_action: 'accept',
    });
    expect(insertCalls.filter((i) => i.table === 'teacher_center')).toHaveLength(0);
    expect(deleteCalls.filter((d) => d.table === 'teacher_center')).toHaveLength(0);
  });

  it('COUNTER on a carries_link proposal routes to the combined RPC (link commits, cut keeps moving)', async () => {
    seedTeacherAuth();
    seedCombinedProposal();
    rpcQueue.push({ data: [{ proposal_status: 'open', group_id: null }], error: null });
    queues.group_proposal_offers = [{ data: { id: 'offer-3' }, error: null }];

    const res = await RESPOND(respondRequest({ action: 'counter', cut_egp: 25 }), params);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ status: 'open', offer_id: 'offer-3' });
    expect(rpcCalls[0].fn).toBe('respond_center_group_proposal');
    expect(rpcCalls[0].args).toMatchObject({ p_action: 'counter', p_cut_egp: 25 });
  });

  it('DECLINE on a carries_link proposal routes to the combined RPC (no link, no group)', async () => {
    seedTeacherAuth();
    seedCombinedProposal();
    rpcQueue.push({ data: [{ proposal_status: 'declined', group_id: null }], error: null });

    const res = await RESPOND(respondRequest({ action: 'decline' }), params);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('declined');
    expect(rpcCalls[0].fn).toBe('respond_center_group_proposal');
    expect(rpcCalls[0].args).toMatchObject({ p_action: 'decline' });
  });

  it('WITHDRAW on a carries_link proposal stays on the plain RPC (no link to commit yet)', async () => {
    seedTeacherAuth();
    seedCombinedProposal();
    rpcQueue.push({ data: [{ proposal_status: 'withdrawn', group_id: null }], error: null });

    const res = await RESPOND(respondRequest({ action: 'withdraw' }), params);

    expect(res.status).toBe(200);
    expect(rpcCalls[0].fn).toBe('respond_group_proposal');
    expect(rpcCalls[0].args).toMatchObject({ p_side: 'teacher', p_action: 'withdraw' });
  });

  it('a non-party cannot act on a carries_link proposal (404, no RPC)', async () => {
    seedTeacherAuth();
    queues.group_proposals = [
      {
        data: {
          id: PROPOSAL_ID,
          teacher_id: 'someone-else',
          fee_per_class: 100,
          status: 'open',
          carries_link: true,
        },
        error: null,
      },
    ];

    const res = await RESPOND(respondRequest({ action: 'accept' }), params);

    expect(res.status).toBe(404);
    expect(rpcCalls).toHaveLength(0);
  });
});
