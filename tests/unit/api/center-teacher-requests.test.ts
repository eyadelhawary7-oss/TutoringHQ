import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

type QResult = { data: unknown; error: unknown };
type Queue = Record<string, QResult[]>;

/**
 * Admin double that also records which `${table}:${op}` terminals ran, so tests
 * can assert e.g. that accept performs a teacher_center insert and decline does
 * not.
 */
function makeAdmin(queue: Queue, calls: string[]) {
  const take = (key: string): QResult => {
    calls.push(key);
    const q = queue[key];
    return q && q.length ? (q.shift() as QResult) : { data: null, error: null };
  };
  function builder(table: string, op: string) {
    const b = {
      eq: () => b,
      in: () => b,
      order: () => Promise.resolve(take(`${table}:${op}`)),
      maybeSingle: () => Promise.resolve(take(`${table}:${op}`)),
      single: () => Promise.resolve(take(`${table}:${op}`)),
      select: () => b,
      then: (res: (v: QResult) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(take(`${table}:${op}`)).then(res, rej),
    };
    return b;
  }
  return {
    from: (table: string) => ({
      select: () => builder(table, 'select'),
      insert: () => builder(table, 'insert'),
      update: () => builder(table, 'update'),
    }),
  };
}

const mockRequireOwnerAdminCenter = vi.fn();
vi.mock('@/lib/requireOwnerAdminCenter', () => ({
  requireOwnerAdminCenter: (req: NextRequest) => mockRequireOwnerAdminCenter(req),
}));

vi.mock('@/lib/csrf', () => ({
  validateCSRFRequest: () => true,
}));

vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: { setTag: () => void }) => void) => fn({ setTag: () => undefined }),
  captureException: () => undefined,
  captureMessage: () => undefined,
}));

import { GET } from '@/app/api/center/teacher-requests/route';
import { POST } from '@/app/api/center/teacher-requests/[requestId]/respond/route';

const CENTER_ID = 'center-1';
const OWNER_ID = 'owner-1';

function makeReq(body?: unknown): NextRequest {
  return {
    headers: { get: () => 'Bearer fake' },
    json: async () => body ?? {},
    nextUrl: { searchParams: new URLSearchParams() },
  } as unknown as NextRequest;
}

function authOk(queue: Queue, calls: string[]) {
  mockRequireOwnerAdminCenter.mockResolvedValueOnce({
    supabaseAdmin: makeAdmin(queue, calls),
    centerId: CENTER_ID,
    userId: OWNER_ID,
  });
}

beforeEach(() => {
  mockRequireOwnerAdminCenter.mockReset();
});

describe('GET /api/center/teacher-requests', () => {
  it('pending requests -> 200 list with teacher name + subject', async () => {
    authOk(
      {
        'teacher_center_requests:select': [
          {
            data: [
              { id: 'r1', message: 'I teach physics', created_at: '2026-06-11', teacher_id: 't1' },
            ],
            error: null,
          },
        ],
        'teacher_profiles:select': [
          { data: [{ user_id: 't1', display_name: 'Mr Tarek', subject: 'Physics' }], error: null },
        ],
      },
      [],
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      requests: { id: string; teacherName: string; subject: string; message: string }[];
    };
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].teacherName).toBe('Mr Tarek');
    expect(body.requests[0].subject).toBe('Physics');
    expect(body.requests[0].message).toBe('I teach physics');
  });
});

describe('POST /api/center/teacher-requests/[requestId]/respond', () => {
  const params = (id: string) => ({ params: Promise.resolve({ requestId: id }) });

  it('accept -> 200 and teacher_center insert is called', async () => {
    const calls: string[] = [];
    authOk(
      {
        'teacher_center_requests:select': [
          { data: { id: 'r1', teacher_id: 't1', center_id: CENTER_ID, status: 'pending', initiated_by: 'teacher' }, error: null },
        ],
        'centers:select': [{ data: { name: 'Alpha Center' }, error: null }],
        'teacher_profiles:select': [{ data: { display_name: 'Mr Tarek' }, error: null }],
        'teacher_center_requests:update': [{ data: null, error: null }],
        'teacher_center:insert': [{ data: null, error: null }],
      },
      calls,
    );
    const res = await POST(makeReq({ action: 'accept' }), params('r1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { action: string; teacherName: string; centerName: string };
    expect(body.action).toBe('accept');
    expect(body.teacherName).toBe('Mr Tarek');
    expect(body.centerName).toBe('Alpha Center');
    expect(calls).toContain('teacher_center:insert');
  });

  it('decline -> 200 and no teacher_center insert', async () => {
    const calls: string[] = [];
    authOk(
      {
        'teacher_center_requests:select': [
          { data: { id: 'r1', teacher_id: 't1', center_id: CENTER_ID, status: 'pending', initiated_by: 'teacher' }, error: null },
        ],
        'centers:select': [{ data: { name: 'Alpha Center' }, error: null }],
        'teacher_profiles:select': [{ data: { display_name: 'Mr Tarek' }, error: null }],
        'teacher_center_requests:update': [{ data: null, error: null }],
      },
      calls,
    );
    const res = await POST(makeReq({ action: 'decline' }), params('r1'));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { action: string }).action).toBe('decline');
    expect(calls).not.toContain('teacher_center:insert');
  });

  it('wrong center -> 404', async () => {
    authOk(
      {
        'teacher_center_requests:select': [
          { data: { id: 'r1', teacher_id: 't1', center_id: 'other-center', status: 'pending' }, error: null },
        ],
      },
      [],
    );
    const res = await POST(makeReq({ action: 'accept' }), params('r1'));
    expect(res.status).toBe(404);
  });

  it('not pending -> 409', async () => {
    authOk(
      {
        'teacher_center_requests:select': [
          { data: { id: 'r1', teacher_id: 't1', center_id: CENTER_ID, status: 'accepted', initiated_by: 'teacher' }, error: null },
        ],
      },
      [],
    );
    const res = await POST(makeReq({ action: 'accept' }), params('r1'));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_PENDING');
  });
});
