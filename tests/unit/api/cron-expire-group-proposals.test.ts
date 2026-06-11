import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.CRON_SECRET = 'cron-secret-123';

const updateCalls: { table: string; payload: Record<string, unknown> }[] = [];
const filterCalls: { method: string; column: string; value: unknown }[] = [];
let updateResult: { data: unknown; error: { message: string } | null } = {
  data: [],
  error: null,
};

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => {
        updateCalls.push({ table, payload });
        const builder = {
          eq: (column: string, value: unknown) => {
            filterCalls.push({ method: 'eq', column, value });
            return builder;
          },
          lt: (column: string, value: unknown) => {
            filterCalls.push({ method: 'lt', column, value });
            return builder;
          },
          select: async () => updateResult,
        };
        return builder;
      },
    }),
  }),
}));

vi.mock('@sentry/nextjs', () => ({
  withScope: vi.fn((cb: (scope: { setTag: () => void }) => void) =>
    cb({ setTag: vi.fn() } as never),
  ),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { GET } from '@/app/api/cron/expire-group-proposals/route';

function makeRequest(auth?: string): Request {
  return new Request('http://localhost/api/cron/expire-group-proposals', {
    headers: auth ? { Authorization: auth } : {},
  });
}

beforeEach(() => {
  updateCalls.length = 0;
  filterCalls.length = 0;
  updateResult = { data: [], error: null };
});

describe('GET /api/cron/expire-group-proposals', () => {
  it('rejects a missing or wrong CRON_SECRET with 401', async () => {
    const noAuth = await GET(makeRequest());
    expect(noAuth.status).toBe(401);

    const wrong = await GET(makeRequest('Bearer wrong-secret-12'));
    expect(wrong.status).toBe(401);
    expect(updateCalls).toHaveLength(0);
  });

  it('expires only open proposals past expires_at and returns expired_count', async () => {
    updateResult = { data: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], error: null };

    const res = await GET(makeRequest(`Bearer ${process.env.CRON_SECRET}`));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ expired_count: 3 });
    expect(updateCalls[0]).toEqual({
      table: 'group_proposals',
      payload: { status: 'expired' },
    });
    expect(filterCalls).toEqual([
      { method: 'eq', column: 'status', value: 'open' },
      { method: 'lt', column: 'expires_at', value: expect.any(String) },
    ]);
  });
});
