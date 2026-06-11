import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

type QResult = { data: unknown; error: unknown };
type Queue = Record<string, QResult[]>;

/**
 * Minimal service-role admin double. Each terminal (maybeSingle/single/order/
 * await) shifts the next queued result for `${table}:${op}`. The routes call
 * each table/op in a deterministic order, so per-key FIFO queues are enough.
 */
function makeAdmin(queue: Queue) {
  const take = (key: string): QResult => {
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

const mockRequireTeacherAuth = vi.fn();
vi.mock('@/lib/centerAuth', () => ({
  requireTeacherAuth: (req: NextRequest) => mockRequireTeacherAuth(req),
}));

vi.mock('@/lib/csrf', () => ({
  validateCSRFRequest: () => true,
}));

vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: { setTag: () => void }) => void) => fn({ setTag: () => undefined }),
  captureException: () => undefined,
  captureMessage: () => undefined,
}));

import { POST } from '@/app/api/teacher/center-requests/route';
import { DELETE } from '@/app/api/teacher/center-requests/[requestId]/route';

const TEACHER_ID = 'teacher-1';

function makeReq(body?: unknown): NextRequest {
  return {
    headers: { get: () => 'Bearer fake' },
    json: async () => body ?? {},
    nextUrl: { searchParams: new URLSearchParams() },
  } as unknown as NextRequest;
}

function authOk(queue: Queue) {
  mockRequireTeacherAuth.mockResolvedValueOnce({
    ok: true,
    userId: TEACHER_ID,
    centerIds: [],
    supabaseAdmin: makeAdmin(queue),
  });
}

beforeEach(() => {
  mockRequireTeacherAuth.mockReset();
});

describe('POST /api/teacher/center-requests', () => {
  it('happy path -> 201 with centerName', async () => {
    authOk({
      'centers:select': [{ data: { id: 'center-1', name: 'Alpha Center' }, error: null }],
      'teacher_center:select': [{ data: null, error: null }],
      'teacher_center_requests:insert': [{ data: { id: 'req-1' }, error: null }],
    });
    const res = await POST(makeReq({ centerCode: 'CHQ-001', message: 'I teach physics' }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { requestId: string; centerName: string };
    expect(body.requestId).toBe('req-1');
    expect(body.centerName).toBe('Alpha Center');
  });

  it('center not found -> 404 CENTER_NOT_FOUND', async () => {
    authOk({ 'centers:select': [{ data: null, error: null }] });
    const res = await POST(makeReq({ centerCode: 'NOPE' }));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('CENTER_NOT_FOUND');
  });

  it('already a member -> 409 ALREADY_A_MEMBER', async () => {
    authOk({
      'centers:select': [{ data: { id: 'center-1', name: 'Alpha' }, error: null }],
      'teacher_center:select': [{ data: { teacher_id: TEACHER_ID }, error: null }],
    });
    const res = await POST(makeReq({ centerCode: 'CHQ-001' }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('ALREADY_A_MEMBER');
  });

  it('duplicate pending (23505) -> 409 REQUEST_ALREADY_PENDING', async () => {
    authOk({
      'centers:select': [{ data: { id: 'center-1', name: 'Alpha' }, error: null }],
      'teacher_center:select': [{ data: null, error: null }],
      'teacher_center_requests:insert': [{ data: null, error: { code: '23505' } }],
    });
    const res = await POST(makeReq({ centerCode: 'CHQ-001' }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('REQUEST_ALREADY_PENDING');
  });
});

describe('DELETE /api/teacher/center-requests/[requestId]', () => {
  const params = (id: string) => ({ params: Promise.resolve({ requestId: id }) });

  it('withdraw happy -> 200', async () => {
    authOk({
      'teacher_center_requests:select': [
        { data: { id: 'req-1', teacher_id: TEACHER_ID, status: 'pending' }, error: null },
      ],
      'teacher_center_requests:update': [{ data: null, error: null }],
    });
    const res = await DELETE(makeReq(), params('req-1'));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  it('wrong owner -> 404', async () => {
    authOk({
      'teacher_center_requests:select': [
        { data: { id: 'req-1', teacher_id: 'someone-else', status: 'pending' }, error: null },
      ],
    });
    const res = await DELETE(makeReq(), params('req-1'));
    expect(res.status).toBe(404);
  });

  it('not pending -> 409 CANNOT_WITHDRAW', async () => {
    authOk({
      'teacher_center_requests:select': [
        { data: { id: 'req-1', teacher_id: TEACHER_ID, status: 'accepted' }, error: null },
      ],
    });
    const res = await DELETE(makeReq(), params('req-1'));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('CANNOT_WITHDRAW');
  });
});
