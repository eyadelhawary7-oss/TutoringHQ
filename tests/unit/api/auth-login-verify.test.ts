import { describe, it, expect, vi, beforeEach } from 'vitest';

// Env vars consumed by the route before it touches the supabase client.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

vi.mock('@/lib/validate', () => ({
  parseBodyWithLimit: vi.fn(),
}));

vi.mock('@/lib/ratelimit', () => ({
  rateLimit: vi.fn(),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  getUpstashRedis: vi.fn(),
  rateLimitedResponse: vi.fn().mockReturnValue(
    new Response(JSON.stringify({ error: 'too_many_requests' }), { status: 429 }) as never,
  ),
}));

const mockSignInWithPassword = vi.fn();
const capturedSetAllCalls: Array<Array<{ name: string; value: string; options?: unknown }>> = [];
let lastSetAllCallback:
  | ((cookies: Array<{ name: string; value: string; options?: unknown }>) => void)
  | null = null;

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(
    (
      _url: string,
      _key: string,
      opts: {
        cookies: {
          getAll: () => Array<{ name: string; value: string }>;
          setAll: (
            cookies: Array<{ name: string; value: string; options?: unknown }>,
          ) => void;
        };
      },
    ) => {
      lastSetAllCallback = opts.cookies.setAll;
      return {
        auth: {
          signInWithPassword: mockSignInWithPassword,
        },
      };
    },
  ),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
  }),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { POST } from '@/app/api/auth/login-verify/route';
import { rateLimit, getUpstashRedis } from '@/lib/ratelimit';
import { parseBodyWithLimit } from '@/lib/validate';
import * as Sentry from '@sentry/nextjs';

function makeRequest(body: Record<string, unknown>, ip = '1.2.3.4') {
  return new Request('http://localhost/api/auth/login-verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

const VALID_PHONE = '+201012345678';
const VALID_PIN = '482917';
const WRONG_PIN_ERROR = { status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' };

beforeEach(() => {
  vi.clearAllMocks();
  capturedSetAllCalls.length = 0;
  lastSetAllCallback = null;
  // Default: rate limit passes (well under the cap).
  vi.mocked(rateLimit).mockResolvedValue({ success: true, remaining: 4, reset: 0 });
  // Default: body parser passes through JSON.
  vi.mocked(parseBodyWithLimit).mockImplementation(async (req) =>
    JSON.parse(await (req as Request).text()),
  );
  // Default: Upstash IS configured (route fails CLOSED at this call site when
  // Redis is missing; tests that want to assert that behavior override per-case).
  const fakeRedis = { del: vi.fn().mockResolvedValue(1) };
  vi.mocked(getUpstashRedis).mockReturnValue(
    fakeRedis as unknown as ReturnType<typeof getUpstashRedis>,
  );
  // Default: signInWithPassword fails with wrong-PIN shape unless overridden.
  mockSignInWithPassword.mockResolvedValue({ data: null, error: WRONG_PIN_ERROR });
});

describe('POST /api/auth/login-verify — per-phone lockout', () => {
  it('returns 401 invalid_credentials on wrong PIN and increments the per-phone counter', async () => {
    const res = await POST(makeRequest({ phone: VALID_PHONE, pin: VALID_PIN }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_credentials');

    // Per-phone rate-limit was consulted with the phone (not the IP) as the key.
    const phoneRateLimitCall = vi
      .mocked(rateLimit)
      .mock.calls.find(([key]) => typeof key === 'string' && key.startsWith('login-verify:phone:'));
    expect(phoneRateLimitCall).toBeDefined();
    expect(phoneRateLimitCall?.[1]).toBe(5);
    expect(phoneRateLimitCall?.[2]).toBe(900);
  });

  it('locks the account after N failed attempts regardless of source IP', async () => {
    // First 5 attempts: counter under cap, signIn returns wrong-PIN.
    for (let i = 0; i < 5; i++) {
      const res = await POST(makeRequest({ phone: VALID_PHONE, pin: VALID_PIN }, `10.0.0.${i}`));
      expect(res.status).toBe(401);
    }

    // 6th attempt from yet another IP: counter is over cap → ACCOUNT_LOCKED.
    vi.mocked(rateLimit).mockImplementationOnce(async (key: string) => {
      if (typeof key === 'string' && key.startsWith('login-verify:phone:')) {
        return { success: false, remaining: 0, reset: Math.floor(Date.now() / 1000) + 900 };
      }
      return { success: true, remaining: 4, reset: 0 };
    });

    const res = await POST(makeRequest({ phone: VALID_PHONE, pin: VALID_PIN }, '99.99.99.99'));
    expect(res.status).toBe(423);
    const body = (await res.json()) as { error: string; retry_after: number };
    expect(body.error).toBe('ACCOUNT_LOCKED');
    expect(body.retry_after).toBeGreaterThan(0);
    expect(res.headers.get('Retry-After')).not.toBeNull();

    // The lockout path MUST NOT call Supabase at all.
    // Final attempt's mock setup should not have invoked signInWithPassword for that 6th call;
    // verify by counting total calls — only the first 5 attempts hit Supabase.
    expect(mockSignInWithPassword).toHaveBeenCalledTimes(5);
  });

  it('a correct PIN before lockout succeeds and clears the per-phone counter', async () => {
    // Simulate 3 prior failures (counter sits at 3). The rate-limit helper still
    // returns success=true because we are at/under cap.
    mockSignInWithPassword.mockResolvedValueOnce({
      data: {
        user: { id: 'user-abc' },
        session: { access_token: 'a', refresh_token: 'r' },
      },
      error: null,
    });

    // Spy on redis.del to confirm reset path runs.
    const delMock = vi.fn().mockResolvedValue(1);
    vi.mocked(getUpstashRedis).mockReturnValue({ del: delMock } as unknown as ReturnType<
      typeof getUpstashRedis
    >);

    // Also need the @supabase/ssr setAll callback to be invoked so the test
    // proves we are wiring session cookies through. Simulate Supabase calling it.
    const res = await POST(makeRequest({ phone: VALID_PHONE, pin: VALID_PIN }));
    // Drive the captured setAll callback the way @supabase/ssr would after a
    // successful signInWithPassword — this is what mints the session cookies on
    // the response.
    expect(lastSetAllCallback).not.toBeNull();
    lastSetAllCallback?.([
      { name: 'sb-test-auth-token', value: 'tok', options: { httpOnly: false, path: '/' } },
    ]);

    expect(res.status).toBe(200);
    expect(delMock).toHaveBeenCalledWith(
      `rate_limit:login-verify:phone:${VALID_PHONE}`,
    );

    // The cookie the setAll callback wrote MUST be on the response we return.
    const setCookieHeader = res.headers.get('set-cookie') ?? '';
    expect(setCookieHeader).toContain('sb-test-auth-token');
  });

  it('a correct PIN DURING lockout is still refused until the window expires', async () => {
    // Counter is over the cap → rate-limit returns success=false even though
    // the next attempt would have been the correct PIN.
    vi.mocked(rateLimit).mockImplementation(async (key: string) => {
      if (typeof key === 'string' && key.startsWith('login-verify:phone:')) {
        return {
          success: false,
          remaining: 0,
          reset: Math.floor(Date.now() / 1000) + 900,
        };
      }
      return { success: true, remaining: 30, reset: 0 };
    });

    // Even if Supabase WOULD have accepted the PIN, we must never reach it.
    mockSignInWithPassword.mockResolvedValue({
      data: { user: { id: 'user-abc' }, session: { access_token: 'a' } },
      error: null,
    });

    const res = await POST(makeRequest({ phone: VALID_PHONE, pin: VALID_PIN }));
    expect(res.status).toBe(423);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('ACCOUNT_LOCKED');
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it('sends auth-system errors to Sentry but does NOT Sentry wrong-PIN responses', async () => {
    // First call: wrong PIN (status 400). Must NOT Sentry.
    mockSignInWithPassword.mockResolvedValueOnce({ data: null, error: WRONG_PIN_ERROR });
    await POST(makeRequest({ phone: VALID_PHONE, pin: VALID_PIN }));
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();

    // Second call: auth provider 500 (system error). MUST Sentry and return 502.
    mockSignInWithPassword.mockResolvedValueOnce({
      data: null,
      error: { status: 503, message: 'service unavailable' },
    });
    const res = await POST(makeRequest({ phone: VALID_PHONE, pin: VALID_PIN }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('auth_system_error');
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalled();
  });

  it('FAILS CLOSED with 503 + Sentry when Upstash is not configured (cannot evaluate lockout)', async () => {
    vi.mocked(getUpstashRedis).mockReturnValue(null);

    const res = await POST(makeRequest({ phone: VALID_PHONE, pin: VALID_PIN }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('auth_system_error');
    expect(res.headers.get('Retry-After')).not.toBeNull();

    // Critical: the route MUST NOT attempt Supabase signin when lockout cannot
    // be evaluated. Otherwise we would silently allow unlimited attempts.
    expect(mockSignInWithPassword).not.toHaveBeenCalled();

    // Loud Sentry alert (not a silent pass).
    expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalledWith(
      expect.stringContaining('login-verify: Upstash not configured'),
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('FAILS CLOSED with 503 + Sentry when the rate-limit store throws (transient Redis error)', async () => {
    vi.mocked(rateLimit).mockRejectedValueOnce(new Error('Upstash REST timeout'));

    const res = await POST(makeRequest({ phone: VALID_PHONE, pin: VALID_PIN }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('auth_system_error');
    expect(res.headers.get('Retry-After')).not.toBeNull();

    expect(mockSignInWithPassword).not.toHaveBeenCalled();
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalled();
  });

  it('rejects malformed inputs (bad PIN format / non-Egyptian phone) without consuming the counter', async () => {
    // Track rate-limit calls before/after.
    const callsBefore = vi.mocked(rateLimit).mock.calls.length;

    const r1 = await POST(makeRequest({ phone: VALID_PHONE, pin: 'abc' }));
    expect(r1.status).toBe(401);

    const r2 = await POST(makeRequest({ phone: '+449999999999', pin: VALID_PIN }));
    expect(r2.status).toBe(401);

    // Neither call should have called the rate-limit helper for the phone.
    const phoneCalls = vi
      .mocked(rateLimit)
      .mock.calls.slice(callsBefore)
      .filter(([k]) => typeof k === 'string' && k.startsWith('login-verify:phone:'));
    expect(phoneCalls).toHaveLength(0);
    // And Supabase must never have been touched.
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });
});
