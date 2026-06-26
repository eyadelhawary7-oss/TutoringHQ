import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// Phase 6 / Fix D: the two PUBLIC, unauthenticated endpoints — POST /api/demo-request
// and POST /api/signup/persist — were missing any rate limit (they cannot require
// auth). They now rate-limit per phone/IP, mirroring /api/signup. These specs prove
// the throttle returns 429 when the limiter says "exceeded", and that a request is
// let through when it does not.

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const rateLimit = vi.fn();
vi.mock('@/lib/ratelimit', () => ({
  getClientIp: () => '203.0.113.7',
  rateLimit: (...args: unknown[]) => rateLimit(...args),
  rateLimitExceededResponse: (retryAfter: number) =>
    NextResponse.json({ error: 'Too many requests. Please try again later.' }, {
      status: 429,
      headers: { 'Retry-After': String(retryAfter) },
    }),
}));

// demo-request builds its own client via createClient
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({ insert: async () => ({ error: null }) }),
  }),
}));

// signup/persist uses the shared admin client
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: () => ({
      upsert: () => ({ select: () => ({ single: async () => ({ data: { id: 'p1' }, error: null }) }) }),
    }),
  },
}));

import { POST as demoPOST } from '@/app/api/demo-request/route';
import { POST as persistPOST } from '@/app/api/signup/persist/route';

function req(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const DEMO_BODY = { name: 'Mona Said', phone: '01012345678', email: 'mona@example.com', centerName: 'Al Noor' };
const PERSIST_BODY = { phone: '01012345678', center_name: 'Al Noor', owner_name: 'Mona Said' };

beforeEach(() => rateLimit.mockReset());

describe('Fix D — POST /api/demo-request rate limit', () => {
  it('returns 429 when the limiter is exceeded', async () => {
    rateLimit.mockResolvedValue({ success: false, remaining: 0, reset: 0 });
    const res = await demoPOST(req('http://localhost/api/demo-request', DEMO_BODY));
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledTimes(1);
  });

  it('proceeds (not 429) when under the limit', async () => {
    rateLimit.mockResolvedValue({ success: true, remaining: 4, reset: 0 });
    const res = await demoPOST(req('http://localhost/api/demo-request', DEMO_BODY));
    expect(res.status).not.toBe(429);
    expect(((await res.json()) as { success?: boolean }).success).toBe(true);
  });
});

describe('Fix D — POST /api/signup/persist rate limit', () => {
  it('returns 429 when the limiter is exceeded', async () => {
    rateLimit.mockResolvedValue({ success: false, remaining: 0, reset: 0 });
    const res = await persistPOST(req('http://localhost/api/signup/persist', PERSIST_BODY));
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledTimes(1);
  });

  it('proceeds (not 429) when under the limit', async () => {
    rateLimit.mockResolvedValue({ success: true, remaining: 29, reset: 0 });
    const res = await persistPOST(req('http://localhost/api/signup/persist', PERSIST_BODY));
    expect(res.status).not.toBe(429);
    expect(((await res.json()) as { id?: string }).id).toBe('p1');
  });
});
