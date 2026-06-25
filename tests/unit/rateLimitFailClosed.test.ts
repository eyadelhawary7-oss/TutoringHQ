import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

/**
 * The rate limiter must FAIL CLOSED when Upstash is not configured: a request we
 * cannot rate-limit is denied, not silently allowed through.
 */
afterEach(() => {
  vi.resetModules();
});

describe('rate limiter fail-closed when Upstash env missing', () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.resetModules();
  });

  it('rateLimit() returns success:false (was previously success:true)', async () => {
    const { rateLimit } = await import('@/lib/rateLimitCore');
    const res = await rateLimit('ip-1', 5, 900);
    expect(res.success).toBe(false);
    expect(res.remaining).toBe(0);
  });

  it('the named limiters are fail-closed stubs, not null skips', async () => {
    const { resetPinPhoneRatelimit, verifyPinResetPhoneRatelimit, scanRatelimit } = await import(
      '@/lib/rateLimitCore'
    );
    // Previously these were `null`, so `if (limiter)` skipped the check (fail open).
    expect(resetPinPhoneRatelimit).not.toBeNull();
    expect(scanRatelimit).not.toBeNull();
    for (const limiter of [resetPinPhoneRatelimit, verifyPinResetPhoneRatelimit, scanRatelimit]) {
      const { success } = await limiter.limit('phone-1');
      expect(success).toBe(false);
    }
  });
});
