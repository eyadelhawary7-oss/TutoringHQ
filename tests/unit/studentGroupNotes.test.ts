import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
delete process.env.CSRF_SECRET;

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const STUDENT_ID = '22222222-2222-4222-8222-222222222222';
const TEACHER_ID = 'teacher-1';

type QueryResult = { data?: unknown; error?: { message: string; code?: string } | null };

// One result queue per table; each guard step shifts the next queued result.
const adminQueue: Record<string, QueryResult[]> = {
  student_groups: [],
  teacher_subscriptions: [],
  students: [],
  enrollments: [],
  student_group_notes: [],
};

const upsertCalls: { table: string; payload: unknown }[] = [];

function resolveQuery(table: string): QueryResult {
  return adminQueue[table]?.shift() ?? { data: null, error: null };
}

// Chainable thenable builder: every filter returns `this`; awaiting (or
// maybeSingle/single) resolves the queued result for the table.
function makeChain(table: string) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    limit: () => chain,
    order: () => chain,
    maybeSingle: async () => resolveQuery(table),
    single: async () => resolveQuery(table),
    then: (ok: (v: QueryResult) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(resolveQuery(table)).then(ok, err),
  };
  return chain;
}

const mockAdmin = {
  from: (table: string) => ({
    select: () => makeChain(table),
    upsert: (payload: unknown) => {
      upsertCalls.push({ table, payload });
      return { select: () => ({ single: async () => resolveQuery(table) }) };
    },
  }),
};

const AUTH_OK = {
  ok: true as const,
  userId: TEACHER_ID,
  centerIds: [] as string[],
  supabaseAdmin: mockAdmin,
};

vi.mock('@/lib/centerAuth', () => ({
  requireTeacherPrivateAccess: vi.fn(async () => AUTH_OK),
}));

vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: { setTag: (k: string, v: string) => void }) => void) =>
    fn({ setTag: () => undefined }),
  captureException: () => undefined,
  captureMessage: () => undefined,
}));

import { GET, PUT } from '@/app/api/teacher/private/groups/[groupId]/students/[studentId]/note/route';

function makeRequest(body?: unknown): NextRequest {
  return {
    headers: { get: () => null },
    json: async () => (body === undefined ? {} : body),
  } as unknown as NextRequest;
}

const params = { params: Promise.resolve({ groupId: GROUP_ID, studentId: STUDENT_ID }) };

// Queue a fully-passing guard (owned private group, Pro plan, non-guest,
// live-enrolled student). Tail results (e.g. the note row) are queued per-test.
function seedPassingGuard() {
  adminQueue.student_groups = [
    { data: { id: GROUP_ID, teacher_id: TEACHER_ID, kind: 'private' }, error: null },
  ];
  adminQueue.teacher_subscriptions = [{ data: { plan_key: 'teacher_pro' }, error: null }];
  adminQueue.students = [{ data: { id: STUDENT_ID, is_guest: false }, error: null }];
  adminQueue.enrollments = [{ data: { id: 'enr-1' }, error: null }];
}

beforeEach(() => {
  for (const k of Object.keys(adminQueue)) adminQueue[k] = [];
  upsertCalls.length = 0;
});

describe('student-group notes route', () => {
  it('1. Pro PUT then GET roundtrip persists the note', async () => {
    seedPassingGuard();
    adminQueue.student_group_notes = [
      { data: { note: 'متابع كويس', updated_at: '2026-06-14T10:00:00Z' }, error: null },
    ];

    const putRes = await PUT(makeRequest({ note: 'متابع كويس' }), params);
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as { note: string; updated_at: string };
    expect(putBody.note).toBe('متابع كويس');
    expect(putBody.updated_at).toBe('2026-06-14T10:00:00Z');
    // teacher_id is stamped from the verified group owner, not the client.
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].table).toBe('student_group_notes');
    expect(upsertCalls[0].payload).toMatchObject({
      student_id: STUDENT_ID,
      group_id: GROUP_ID,
      teacher_id: TEACHER_ID,
      note: 'متابع كويس',
    });

    seedPassingGuard();
    adminQueue.student_group_notes = [
      { data: { note: 'متابع كويس', updated_at: '2026-06-14T10:00:00Z' }, error: null },
    ];
    const getRes = await GET(makeRequest(), params);
    expect(getRes.status).toBe(200);
    expect(((await getRes.json()) as { note: string }).note).toBe('متابع كويس');
  });

  it('2. GET with no note row returns the empty string', async () => {
    seedPassingGuard();
    adminQueue.student_group_notes = [{ data: null, error: null }];

    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { note: string }).note).toBe('');
  });

  it('3. Standard teacher -> 403 NOTES_PRO_ONLY', async () => {
    adminQueue.student_groups = [
      { data: { id: GROUP_ID, teacher_id: TEACHER_ID, kind: 'private' }, error: null },
    ];
    adminQueue.teacher_subscriptions = [{ data: { plan_key: 'teacher_standard' }, error: null }];

    const res = await PUT(makeRequest({ note: 'x' }), params);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('NOTES_PRO_ONLY');
    expect(upsertCalls).toEqual([]);
  });

  it('4. Wrong teacher -> 403 NOT_GROUP_OWNER', async () => {
    adminQueue.student_groups = [
      { data: { id: GROUP_ID, teacher_id: 'someone-else', kind: 'private' }, error: null },
    ];

    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_GROUP_OWNER');
  });

  it('5. Non-enrolled student -> 404 not_enrolled', async () => {
    adminQueue.student_groups = [
      { data: { id: GROUP_ID, teacher_id: TEACHER_ID, kind: 'private' }, error: null },
    ];
    adminQueue.teacher_subscriptions = [{ data: { plan_key: 'teacher_pro' }, error: null }];
    adminQueue.students = [{ data: { id: STUDENT_ID, is_guest: false }, error: null }];
    adminQueue.enrollments = [{ data: null, error: null }];

    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('not_enrolled');
  });

  it('6. Guest student -> 400 GUEST_NO_NOTES', async () => {
    adminQueue.student_groups = [
      { data: { id: GROUP_ID, teacher_id: TEACHER_ID, kind: 'private' }, error: null },
    ];
    adminQueue.teacher_subscriptions = [{ data: { plan_key: 'teacher_pro' }, error: null }];
    adminQueue.students = [{ data: { id: STUDENT_ID, is_guest: true }, error: null }];

    const res = await PUT(makeRequest({ note: 'x' }), params);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('GUEST_NO_NOTES');
    expect(upsertCalls).toEqual([]);
  });

  it('7. Note longer than 2000 chars -> 400 NOTE_TOO_LONG', async () => {
    seedPassingGuard();

    const res = await PUT(makeRequest({ note: 'ا'.repeat(2001) }), params);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('NOTE_TOO_LONG');
    expect(upsertCalls).toEqual([]);
  });
});
