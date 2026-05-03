/**
 * Upstash sliding-window rate limiting (`rateLimit` / `rateLimitExceededResponse`).
 * On Windows, `src/lib/rateLimit.ts` conflicts with `ratelimit.ts` in TypeScript — import from `@/lib/ratelimit` (re-exports this module).
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
 * Sliding-window rate limit (sorted set). Fails open when Upstash env is missing.
 */
export async function rateLimit(
  identifier: string,
  maxRequests: number = 5,
  windowSeconds: number = 900,
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const r = getUpstashRedis();
  if (!r) {
    const now = Math.floor(Date.now() / 1000);
    return { success: true, remaining: maxRequests, reset: now + windowSeconds };
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

export const scanRatelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(120, '1 m'),
      prefix: 'rl:scan',
      analytics: false,
    })
  : null;

export const resetPinPhoneRatelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, '15 m'),
      prefix: 'rl:reset-pin:phone',
      analytics: false,
    })
  : null;

export const verifyPinResetPhoneRatelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, '15 m'),
      prefix: 'rl:verify-pin-reset:phone',
      analytics: false,
    })
  : null;

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
