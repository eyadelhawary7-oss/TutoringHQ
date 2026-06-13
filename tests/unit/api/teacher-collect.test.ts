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
  sessions: [],
  student_groups: [],
};

const rpcQueues: Record<string, AdminQueryResult[]> = {
  apply_transaction_transition: [],
};
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

const tableHits: string[] = [];

function resolveQuery(table: string): AdminQueryResult {
  tableHits.push(table);
  if (table === 'users') {
    return adminQueue.users_teacher.shift() ?? { data: null, error: null };
  }
  const queue = adminQueue[table];
  if (table === 'teacher_center') {
    return queue?.shift() ?? { data: [], error: null };
  }
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
      eq: () => builder,
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
vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: { setTag: (k: string, v: string) => void }) => void) => {
    fn({ setTag: () => undefined });
  },
  captureException: (err: unknown) => mockSentryCaptureException(err),
  captureMessage: () => undefined,
}));

import { POST } from '@/app/api/teacher/private/transactions/[transactionId]/collect/route';

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
  adminQueue.users_teacher = [{ data: { id: 'user-1', role: 'teacher' }, error: null }];
  adminQueue.teacher_center = [{ data: [], error: null }];
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockRpc.mockClear();
  mockSentryCaptureException.mockReset();
  for (const k of Object.keys(adminQueue)) adminQueue[k] = [];
  for (const k of Object.keys(rpcQueues)) rpcQueues[k] = [];
  rpcCalls.length = 0;
  tableHits.length = 0;
});

describe('POST /api/teacher/private/transactions/[transactionId]/collect', () => {
  it('transaction belongs to a different teacher -> 403, RPC never called', async () => {
    queueTeacherAuthOk();
    // Foreign owner, no session to resolve through -> ownership fails.
    adminQueue.transactions = [
      { data: { id: TXN_ID, teacher_id: 'other-teacher', status: 'pending', session_id: null }, error: null },
    ];

    const res = await POST(makeRequest({ method: 'cash' }), ctx());

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_your_transaction');
    expect(rpcCalls.filter((c) => c.fn === 'apply_transaction_transition')).toEqual([]);
  });

  it('transaction already paid -> 409, RPC never called', async () => {
    queueTeacherAuthOk();
    adminQueue.transactions = [
      { data: { id: TXN_ID, teacher_id: 'user-1', status: 'paid', session_id: 's1' }, error: null },
    ];

    const res = await POST(makeRequest({ method: 'cash' }), ctx());

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('already_settled');
    expect(rpcCalls.filter((c) => c.fn === 'apply_transaction_transition')).toEqual([]);
  });

  it('cash on an owned pending charge -> 200 with correct transition params', async () => {
    queueTeacherAuthOk();
    adminQueue.transactions = [
      { data: { id: TXN_ID, teacher_id: 'user-1', status: 'pending', session_id: 's1' }, error: null },
    ];
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

  it('invalid method -> 400, transaction never read and RPC never called', async () => {
    queueTeacherAuthOk();

    const res = await POST(makeRequest({ method: 'card' }), ctx());

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_method');
    expect(tableHits).not.toContain('transactions');
    expect(rpcCalls.filter((c) => c.fn === 'apply_transaction_transition')).toEqual([]);
  });
});
