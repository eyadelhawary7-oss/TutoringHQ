/**
 * Upstash sliding-window rate limiting (`rateLimit` / `rateLimitExceededResponse`).
 * On Windows, `src/lib/rateLimit.ts` conflicts with `ratelimit.ts` in TypeScript - import from `@/lib/ratelimit` (re-exports this module).
 */
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';

let redisSingleton: Redis | null | undefined;

export function getUpstashRedis(): Redis | null {
  if (redisSingleton !== undefined) return redisSingleton;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    redisSingleton = null;
    return null;
  }
  redisSingleton = new Redis({ url, token });
  return redisSingleton;
}

const redis = getUpstashRedis();

/**
 * Sliding-window rate limit (sorted set).
 *
 * Fails CLOSED when Upstash env is missing: a request we cannot rate-limit is
 * rejected (`success: false`) rather than waved through, in every environment.
 * Several callers here gate abuse-prone auth/scanner paths, so a deploy with
 * Upstash unconfigured must not silently disable the limiter. `UPSTASH_REDIS_REST_URL`
 * and `UPSTASH_REDIS_REST_TOKEN` are required in every environment (see .env.example).
 */
export async function rateLimit(
  identifier: string,
  maxRequests: number = 5,
  windowSeconds: number = 900,
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const r = getUpstashRedis();
  if (!r) {
    const now = Math.floor(Date.now() / 1000);
    return { success: false, remaining: 0, reset: now + windowSeconds };
  }

  const key = `rate_limit:${identifier}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSeconds;

  const pipe = r.pipeline();
  pipe.zremrangebyscore(key, 0, windowStart);
  pipe.zadd(key, { score: now, member: `${now}-${Math.random()}` });
  pipe.zcard(key);
  pipe.expire(key, windowSeconds);
  const results = await pipe.exec();

  const count = results[2] as number;
  const success = count <= maxRequests;
  const remaining = Math.max(0, maxRequests - count);
  const reset = now + windowSeconds;

  return { success, remaining, reset };
}

export function rateLimitExceededResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests. Please try again later.' },
    {
      status: 429,
      headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) },
    },
  );
}

/**
 * Minimal sliding-window limiter surface the named limiters expose. The real
 * `@upstash/ratelimit` `Ratelimit` is structurally assignable to this.
 */
export type SlidingLimiter = {
  limit(identifier: string): Promise<{
    success: boolean;
    reset: number;
    limit?: number;
    remaining?: number;
  }>;
};

/**
 * Fail-CLOSED stand-in used when Upstash is not configured. `.limit()` always
 * reports "limited" so the guarded path is denied (429) rather than running
 * unprotected. Previously these limiters were `null`, which made every caller's
 * `if (limiter) { ... }` skip the check entirely — a silent fail-open.
 */
function failClosedLimiter(windowMs: number): SlidingLimiter {
  return {
    async limit() {
      return { success: false, reset: Date.now() + windowMs, limit: 0, remaining: 0 };
    },
  };
}

export const scanRatelimit: SlidingLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(120, '1 m'),
      prefix: 'rl:scan',
      analytics: false,
    })
  : failClosedLimiter(60_000);

export const resetPinPhoneRatelimit: SlidingLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, '15 m'),
      prefix: 'rl:reset-pin:phone',
      analytics: false,
    })
  : failClosedLimiter(15 * 60_000);

export const verifyPinResetPhoneRatelimit: SlidingLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, '15 m'),
      prefix: 'rl:verify-pin-reset:phone',
      analytics: false,
    })
  : failClosedLimiter(15 * 60_000);

export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    '127.0.0.1'
  );
}

export function rateLimitedResponse(retryAfter: number): NextResponse {
  return NextResponse.json(
    { error: 'too_many_requests', retry_after: retryAfter },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': '0',
        'X-RateLimit-Remaining': '0',
      },
    },
  );
}
