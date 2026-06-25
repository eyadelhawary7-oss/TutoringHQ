import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-role-key';
process.env.CRON_SECRET = 'cron-secret-value';

// Minimal chainable supabase: any select/in resolves to empty; updates succeed.
function chain(): unknown {
  const p: Promise<{ data: unknown[]; error: null }> = Promise.resolve({ data: [], error: null });
  const api: Record<string, unknown> = {
    select: () => api,
    in: () => api,
    update: () => api,
    eq: () => api,
    lt: () => api,
    then: (r: (v: unknown) => unknown) => p.then(r),
  };
  return api;
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => chain() }),
}));

import { POST } from '@/app/api/referrals/calculate-rewards/route';

function req(headers: Record<string, string>) {
  return new Request('https://centerhq.app/api/referrals/calculate-rewards', {
    method: 'POST',
    headers,
    body: '{}',
  }) as never;
}

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret-value';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-role-key';
});

describe('calculate-rewards auth', () => {
  it('denies a request with no Authorization header', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(401);
  });

  it('denies a wrong bearer token', async () => {
    const res = await POST(req({ Authorization: 'Bearer not-the-secret' }));
    expect(res.status).toBe(401);
  });

  it('accepts the dedicated CRON_SECRET (correct caller)', async () => {
    const res = await POST(req({ Authorization: 'Bearer cron-secret-value' }));
    expect(res.status).toBe(200);
  });

  it('still accepts the legacy service-role key (transitional, timing-safe)', async () => {
    const res = await POST(req({ Authorization: 'Bearer svc-role-key' }));
    expect(res.status).toBe(200);
  });
});
