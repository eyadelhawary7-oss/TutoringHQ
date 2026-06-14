import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.CRON_SECRET = 'cron-secret-123';

const filterCalls: { col: string; val: unknown }[] = [];
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
let listResult: { data: { teacher_id: string }[]; error: { message: string } | null } = {
  data: [],
  error: null,
};
let rpcResult: { data: unknown; error: { message: string } | null } = {
  data: { reset: true },
  error: null,
};

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => {
    const builder = {
      eq: (col: string, val: unknown) => {
        filterCalls.push({ col, val });
        return builder;
      },
      order: () => builder,
      range: async () => listResult,
    };
    return {
      from: () => ({ select: () => builder }),
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        return rpcResult;
      },
    };
  },
}));

vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn((cb: (scope: { setTag: () => void }) => void) =>
    cb({ setTag: vi.fn() } as never),
  ),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { GET } from '@/app/api/cron/reset-teacher-blast-credits/route';

function makeRequest(auth?: string): Request {
  return new Request('http://localhost/api/cron/reset-teacher-blast-credits', {
    headers: auth ? { Authorization: auth } : {},
  });
}

beforeEach(() => {
  filterCalls.length = 0;
  rpcCalls.length = 0;
  listResult = { data: [], error: null };
  rpcResult = { data: { reset: true }, error: null };
});

describe('GET /api/cron/reset-teacher-blast-credits', () => {
  it('rejects a missing or wrong CRON_SECRET with 401 and calls no RPC', async () => {
    const noAuth = await GET(makeRequest());
    expect(noAuth.status).toBe(401);

    const wrong = await GET(makeRequest('Bearer wrong-secret-12'));
    expect(wrong.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });

  it('filters to active Pro teachers and calls reset RPC for each', async () => {
    listResult = { data: [{ teacher_id: 't1' }, { teacher_id: 't2' }], error: null };

    const res = await GET(makeRequest(`Bearer ${process.env.CRON_SECRET}`));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ processed: 2, reset: 2, skipped: 0 });
    // Query restricts to plan_key='teacher_699' AND status='active' (never events).
    expect(filterCalls).toEqual([
      { col: 'plan_key', val: 'teacher_699' },
      { col: 'status', val: 'active' },
    ]);
    expect(rpcCalls).toEqual([
      { name: 'reset_subscription_blast_credits', args: { p_user_id: 't1' } },
      { name: 'reset_subscription_blast_credits', args: { p_user_id: 't2' } },
    ]);
  });

  it('counts a no-op RPC result (non-Pro/just-downgraded) as skipped, not reset', async () => {
    listResult = { data: [{ teacher_id: 't1' }], error: null };
    rpcResult = { data: { reset: false, reason: 'not_pro' }, error: null };

    const res = await GET(makeRequest(`Bearer ${process.env.CRON_SECRET}`));
    expect(await res.json()).toEqual({ processed: 1, reset: 0, skipped: 1 });
  });

  it('is idempotent: a re-run issues the same RPC calls (RPC just sets 100)', async () => {
    listResult = { data: [{ teacher_id: 't1' }, { teacher_id: 't2' }], error: null };

    const first = await GET(makeRequest(`Bearer ${process.env.CRON_SECRET}`));
    expect(await first.json()).toEqual({ processed: 2, reset: 2, skipped: 0 });
    const callsAfterFirst = rpcCalls.length;

    const second = await GET(makeRequest(`Bearer ${process.env.CRON_SECRET}`));
    expect(await second.json()).toEqual({ processed: 2, reset: 2, skipped: 0 });
    expect(rpcCalls.length).toBe(callsAfterFirst * 2);
  });

  it('returns zero counts when there are no active Pro teachers (cron is a no-op today)', async () => {
    listResult = { data: [], error: null };
    const res = await GET(makeRequest(`Bearer ${process.env.CRON_SECRET}`));
    expect(await res.json()).toEqual({ processed: 0, reset: 0, skipped: 0 });
    expect(rpcCalls).toHaveLength(0);
  });

  it('returns 500 when listing the Pro cohort errors', async () => {
    listResult = { data: [], error: { message: 'db down' } };
    const res = await GET(makeRequest(`Bearer ${process.env.CRON_SECRET}`));
    expect(res.status).toBe(500);
  });
});
