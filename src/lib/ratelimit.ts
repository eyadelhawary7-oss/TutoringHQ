import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';

// Fail open when env vars are missing (local dev without Upstash configured)
// Returns null — callers must handle null as "allow request"
function createRedis(): Redis | null {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

const redis = createRedis();

// ── Rate limiter instances ────────────────────────────────────────────────
// All use sliding window algorithm for smooth rate limiting

// Login: 5 attempts per 1 minute per IP
// Protects against PIN brute-force attacks
export const loginRatelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, '1 m'),
      prefix: 'rl:login',
      analytics: false,
    })
  : null;

// Signup: 5 attempts per hour per IP
// Prevents spam center registration
export const signupRatelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, '1 h'),
      prefix: 'rl:signup',
      analytics: false,
    })
  : null;

// Scan: 120 requests per minute per center ID
// High limit — legitimate centers scan many students per session
// Keyed by center_id not IP (authenticated endpoint)
export const scanRatelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(120, '1 m'),
      prefix: 'rl:scan',
      analytics: false,
    })
  : null;

// PIN reset: 3 OTP sends per phone per 15 minutes (WhatsApp + DB OTP)
export const resetPinPhoneRatelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, '15 m'),
      prefix: 'rl:reset-pin:phone',
      analytics: false,
    })
  : null;

// PIN reset verify: 5 attempts per phone per 15 minutes
export const verifyPinResetPhoneRatelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, '15 m'),
      prefix: 'rl:verify-pin-reset:phone',
      analytics: false,
    })
  : null;

// ── Helper: extract client IP from request headers ────────────────────────
// Next.js App Router behind Vercel CDN — use x-forwarded-for first
export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    '127.0.0.1'
  );
}

// ── Helper: standard 429 response ────────────────────────────────────────
// retryAfter: seconds until the window resets
// Math.max(1, ...) guarantees retryAfter is always >= 1 (Retry-After must be positive)
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
    }
  );
}
