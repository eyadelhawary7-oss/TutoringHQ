import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.SUPER_ADMIN_PHONES = '';

const mockGetUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
}));

type AdminQueryResult = { data: unknown; error: { message: string; code?: string } | null };

const adminQueue: Record<string, AdminQueryResult[]> = {
  users_teacher: [],
  teacher_center: [],
  transactions: [],
  teacher_subscriptions: [],
  student_groups: [],
  enrollments: [],
};

const rpcQueues: Record<string, AdminQueryResult[]> = {
  teacher_private_access: [],
  apply_transaction_transition: [],
};
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

const tableHits: string[] = [];
const filterCalls: { table: string; method: string; column: string; value: unknown }[] = [];

function resolveQuery(table: string): AdminQueryResult {
  tableHits.push(table);
  if (table === 'users') {
    return adminQueue.users_teacher.shift() ?? { data: null, error: null };
  }
  if (table === 'teacher_center') {
    return adminQueue.teacher_center.shift() ?? { data: [], error: null };
  }
  const queue = adminQueue[table];
  return queue?.shift() ?? { data: null, error: null };
}

const mockRpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
  rpcCalls.push({ fn, args });
  return rpcQueues[fn]?.shift() ?? { data: null, error: null };
});

const mockGetSupabaseAdmin = vi.fn(() => ({
  rpc: mockRpc,
  from: (table: string) => {
    const builder = {
      eq: (column: string, value: unknown) => {
        filterCalls.push({ table, method: 'eq', column, value });
        return builder;
      },
      in: () => builder,
      limit: () => builder,
      order: () => builder,
      maybeSingle: async () => resolveQuery(table),
      then: (
        onFulfilled: (v: AdminQueryResult) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => Promise.resolve(resolveQuery(table)).then(onFulfilled, onRejected),
    };
    return { select: () => builder };
  },
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => mockGetSupabaseAdmin(),
}));

const mockSentryCaptureException = vi.fn();
const mockSentryCaptureMessage = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: { setTag: (k: string, v: string) => void }) => void) => {
    fn({ setTag: () => undefined });
  },
  captureException: (err: unknown) => mockSentryCaptureException(err),
  captureMessage: (msg: string, level?: string) => mockSentryCaptureMessage(msg, level),
}));

import { POST } from '@/app/api/teacher/private/transactions/[transactionId]/mark-paid/route';

const TXN_ID = '55555555-5555-4555-8555-555555555555';
const VALID_USER = { id: 'user-1' };

function makeRequest(body?: unknown): NextRequest {
  const headers = new Map<string, string>([['Authorization', 'Bearer fake-token']]);
  return {
    headers: { get: (k: string) => headers.get(k) ?? null },
    nextUrl: { searchParams: new URLSearchParams() },
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  } as unknown as NextRequest;
}

function ctx(transactionId: string = TXN_ID) {
  return { params: Promise.resolve({ transactionId }) };
}

function queueTeacherAuthOk() {
  mockGetUser.mockResolvedValueOnce({ data: { user: VALID_USER }, error: null });
  adminQueue.users_teacher = [
    { data: { id: 'user-1', role: 'teacher' }, error: null },
  ];
  adminQueue.teacher_center = [{ data: [], error: null }];
}

function queueGateGranted() {
  queueTeacherAuthOk();
  rpcQueues.teacher_private_access = [{ data: true, error: null }];
}

const OWNED_PENDING_TXN = {
  data: { id: TXN_ID, teacher_id: 'user-1', kind: 'lesson', status: 'pending', session_id: 's1' },
  error: null,
};

beforeEach(() => {
  mockGetUser.mockReset();
  mockRpc.mockClear();
  mockSentryCaptureException.mockReset();
  mockSentryCaptureMessage.mockReset();
  for (const k of Object.keys(adminQueue)) adminQueue[k] = [];
  for (const k of Object.keys(rpcQueues)) rpcQueues[k] = [];
  rpcCalls.length = 0;
  tableHits.length = 0;
  filterCalls.length = 0;
});

describe('POST /api/teacher/private/transactions/[transactionId]/mark-paid', () => {
  it('lapsed -> 403 NO_PRIVATE_ACCESS, nothing called (spine)', async () => {
    queueTeacherAuthOk();
    rpcQueues.teacher_private_access = [{ data: false, error: null }];

    const res = await POST(makeRequest({ method: 'cash' }), ctx());

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('NO_PRIVATE_ACCESS');
    expect(tableHits).not.toContain('transactions');
    expect(rpcCalls.filter((c) => c.fn === 'apply_transaction_transition')).toEqual([]);
  });

  it('foreign/unknown transaction -> 404, RPC never called (THE denial)', async () => {
    queueGateGranted();
    adminQueue.transactions = [{ data: null, error: null }];

    const res = await POST(makeRequest({ method: 'cash' }), ctx());

    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('transaction_not_found');
    // Ownership read happened, scoped to the caller...
    expect(filterCalls).toContainEqual({ table: 'transactions', method: 'eq', column: 'teacher_id', value: 'user-1' });
    expect(filterCalls).toContainEqual({ table: 'transactions', method: 'eq', column: 'kind', value: 'lesson' });
    // ...but the transition was never attempted.
    expect(rpcCalls.filter((c) => c.fn === 'apply_transaction_transition')).toEqual([]);
  });

  it('happy cash: ownership read then transition (id, paid, auth.userId, cash) -> 200', async () => {
    queueGateGranted();
    adminQueue.transactions = [OWNED_PENDING_TXN];
    rpcQueues.apply_transaction_transition = [
      { data: { id: TXN_ID, status: 'paid', method: 'cash', paid_at: '2026-06-10T15:00:00Z' }, error: null },
    ];

    const res = await POST(makeRequest({ method: 'cash' }), ctx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { transaction: Record<string, unknown> };
    expect(body.transaction).toEqual({
      id: TXN_ID,
      status: 'paid',
      method: 'cash',
      paid_at: '2026-06-10T15:00:00Z',
    });
    expect(rpcCalls.find((c) => c.fn === 'apply_transaction_transition')?.args).toEqual({
      p_transaction_id: TXN_ID,
      p_new_status: 'paid',
      p_actor_id: 'user-1',
      p_method: 'cash',
    });
  });

  it('happy instapay -> 200, method instapay passed through', async () => {
    queueGateGranted();
    adminQueue.transactions = [OWNED_PENDING_TXN];
    rpcQueues.apply_transaction_transition = [
      { data: { id: TXN_ID, status: 'paid', method: 'instapay', paid_at: '2026-06-10T15:00:00Z' }, error: null },
    ];

    const res = await POST(makeRequest({ method: 'instapay' }), ctx());

    expect(res.status).toBe(200);
    expect(rpcCalls.find((c) => c.fn === 'apply_transaction_transition')?.args).toMatchObject({
      p_method: 'instapay',
    });
  });

  it('method=card -> 400 invalid_method, RPC never called (manual path is cash/instapay only)', async () => {
    queueGateGranted();

    const res = await POST(makeRequest({ method: 'card' }), ctx());

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_method');
    expect(tableHits).not.toContain('transactions');
    expect(rpcCalls.filter((c) => c.fn === 'apply_transaction_transition')).toEqual([]);
  });

  it('already-paid charge (same method) -> 200 idempotent (fn no-op returns the row)', async () => {
    queueGateGranted();
    adminQueue.transactions = [
      { data: { id: TXN_ID, teacher_id: 'user-1', kind: 'lesson', status: 'paid', session_id: 's1' }, error: null },
    ];
    // The fn's same-status no-op contract: returns the row, no mutation.
    rpcQueues.apply_transaction_transition = [
      { data: { id: TXN_ID, status: 'paid', method: 'cash', paid_at: '2026-06-09T10:00:00Z' }, error: null },
    ];

    const res = await POST(makeRequest({ method: 'cash' }), ctx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { transaction: { status: string; paid_at: string } };
    expect(body.transaction.status).toBe('paid');
    expect(body.transaction.paid_at).toBe('2026-06-09T10:00:00Z');
  });

  it('retry with a DIFFERENT method on a paid charge -> 409 method_conflict', async () => {
    queueGateGranted();
    adminQueue.transactions = [
      { data: { id: TXN_ID, teacher_id: 'user-1', kind: 'lesson', status: 'paid', session_id: 's1' }, error: null },
    ];
    rpcQueues.apply_transaction_transition = [
      { data: null, error: { message: 'method already set to cash and cannot be changed', code: '23514' } },
    ];

    const res = await POST(makeRequest({ method: 'instapay' }), ctx());

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('method_conflict');
  });

  it('illegal transaction transition (failed/cancelled charge) -> 409 invalid_transition', async () => {
    queueGateGranted();
    adminQueue.transactions = [
      { data: { id: TXN_ID, teacher_id: 'user-1', kind: 'lesson', status: 'cancelled', session_id: 's1' }, error: null },
    ];
    rpcQueues.apply_transaction_transition = [
      { data: null, error: { message: 'illegal transaction transition: cancelled -> paid', code: '23514' } },
    ];

    const res = await POST(makeRequest({ method: 'cash' }), ctx());

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_transition');
  });

  it('ownership CORE read error -> 500, RPC never called (never an error-minted 404)', async () => {
    queueGateGranted();
    adminQueue.transactions = [{ data: null, error: { message: 'db down' } }];

    const res = await POST(makeRequest({ method: 'cash' }), ctx());

    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe('server_error');
    expect(mockSentryCaptureException).toHaveBeenCalled();
    expect(rpcCalls.filter((c) => c.fn === 'apply_transaction_transition')).toEqual([]);
  });

  it('unknown fn error -> 500 + Sentry', async () => {
    queueGateGranted();
    adminQueue.transactions = [OWNED_PENDING_TXN];
    rpcQueues.apply_transaction_transition = [
      { data: null, error: { message: 'connection reset', code: '08006' } },
    ];

    const res = await POST(makeRequest({ method: 'cash' }), ctx());

    expect(res.status).toBe(500);
    expect(mockSentryCaptureException).toHaveBeenCalled();
  });

  it('over-cap Standard teacher (75 students) -> 403 OVER_CAP_LOCKED, RPC never called', async () => {
    queueGateGranted();
    adminQueue.transactions = [OWNED_PENDING_TXN];
    // Over-cap gate (runs after ownership, before the transition): Standard plan
    // with 75 distinct non-guest active students across one active group.
    adminQueue.teacher_subscriptions = [{ data: { plan_key: 'teacher_299' }, error: null }];
    adminQueue.student_groups = [{ data: [{ id: 'g-1' }], error: null }];
    adminQueue.enrollments = [
      { data: Array.from({ length: 75 }, (_, i) => ({ student_id: `s-${i}` })), error: null },
    ];

    const res = await POST(makeRequest({ method: 'cash' }), ctx());

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('OVER_CAP_LOCKED');
    expect(rpcCalls.filter((c) => c.fn === 'apply_transaction_transition')).toEqual([]);
  });

  it('Pro teacher is never cap-locked even at 75 students -> 200', async () => {
    queueGateGranted();
    adminQueue.transactions = [OWNED_PENDING_TXN];
    // Gate short-circuits on Pro before counting students.
    adminQueue.teacher_subscriptions = [{ data: { plan_key: 'teacher_699' }, error: null }];
    rpcQueues.apply_transaction_transition = [
      { data: { id: TXN_ID, status: 'paid', method: 'cash', paid_at: '2026-06-10T15:00:00Z' }, error: null },
    ];

    const res = await POST(makeRequest({ method: 'cash' }), ctx());

    expect(res.status).toBe(200);
    expect(tableHits).not.toContain('student_groups');
  });
});
