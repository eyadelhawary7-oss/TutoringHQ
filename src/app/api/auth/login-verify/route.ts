import * as Sentry from '@sentry/nextjs';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getClientIp, getUpstashRedis, rateLimit, rateLimitedResponse } from '@/lib/ratelimit';
import { normalizePhone, isValidEgyptianMobileE164 } from '@/lib/utils/phone';
import { parseBodyWithLimit } from '@/lib/validate';

/**
 * Per-PHONE login lockout. Brute-force a 6-digit PIN against a derivable
 * `{digits}@centerhq.local` identity is unsafe without an account-bound budget.
 * Attempts are counted per normalized phone (NOT per IP - attackers rotate IPs).
 */
const LOGIN_LOCKOUT_MAX = 5;
const LOGIN_LOCKOUT_WINDOW_SECS = 900; // 15 minutes
const SIX_DIGITS = /^\d{6}$/;

function lockoutKey(phoneE164: string): string {
  return `login-verify:phone:${phoneE164}`;
}

function rateLimitRedisKey(phoneE164: string): string {
  // Matches the format used by rateLimitCore.rateLimit (`rate_limit:${identifier}`).
  return `rate_limit:${lockoutKey(phoneE164)}`;
}

/**
 * Clear the per-phone failure counter on successful sign-in so a legitimate
 * owner who fat-fingered a few times before getting it right is not punished.
 */
async function clearLockoutCounter(phoneE164: string): Promise<void> {
  const redis = getUpstashRedis();
  if (!redis) return;
  try {
    await redis.del(rateLimitRedisKey(phoneE164));
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'login-verify', step: 'reset_counter' } });
  }
}

/**
 * Treat the Supabase auth error as a system error (worth Sentry) vs an expected
 * wrong-PIN (not). Wrong-PIN comes back as status 400 with code 'invalid_credentials'.
 */
function isSystemAuthError(err: { status?: number; code?: string } | null): boolean {
  if (!err) return false;
  const status = typeof err.status === 'number' ? err.status : 0;
  if (status >= 500) return true;
  if (status === 0) return true; // network / unknown
  return false;
}

/**
 * POST /api/auth/login-verify
 * Public. Performs phone+PIN authentication SERVER-side and writes the
 * @supabase/ssr cookie session onto the response so middleware and subsequent
 * fetches see the same session the old browser-side flow produced.
 *
 * Lockout fails CLOSED at this call site (config missing or Redis error → 503,
 * Sentry alert). The global rateLimit helper fails OPEN by design (acceptable
 * for scanner / promo limits where availability matters more than the cap).
 * For an auth credential lockout the inverse is correct: a brief 503 window
 * during an Upstash outage is a tolerable customer-facing degradation; a
 * silently disabled brute-force protection is not.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await parseBodyWithLimit(request, 65536);
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const rawPhone =
    typeof (body as { phone?: unknown })?.phone === 'string'
      ? (body as { phone: string }).phone.trim()
      : '';
  const pin =
    typeof (body as { pin?: unknown })?.pin === 'string'
      ? (body as { pin: string }).pin.trim()
      : '';

  if (!rawPhone || !SIX_DIGITS.test(pin)) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const normalizedPhone = normalizePhone(rawPhone);
  if (!isValidEgyptianMobileE164(normalizedPhone)) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  // Per-PHONE lockout - counted regardless of source IP. The global rateLimit()
  // helper fails OPEN when Upstash is unavailable (acceptable for scanner /
  // promo limits). For an auth-credential lockout it is the wrong default:
  // silently disabling brute-force protection during an Upstash outage gives an
  // attacker a window to exhaust the 1,000,000-PIN keyspace. We override the
  // default HERE (only at this call site) to fail CLOSED with a loud Sentry
  // alert. The tradeoff is documented in the route header comment above.
  if (getUpstashRedis() === null) {
    Sentry.captureMessage(
      'login-verify: Upstash not configured - refusing login, brute-force protection unavailable',
      {
        level: 'error',
        tags: { route: 'login-verify', reason: 'redis_not_configured' },
      },
    );
    return NextResponse.json(
      { error: 'auth_system_error', retry_after: 10 },
      { status: 503, headers: { 'Retry-After': '10' } },
    );
  }

  let phoneOk: boolean;
  let phoneReset: number;
  try {
    const result = await rateLimit(
      lockoutKey(normalizedPhone),
      LOGIN_LOCKOUT_MAX,
      LOGIN_LOCKOUT_WINDOW_SECS,
    );
    phoneOk = result.success;
    phoneReset = result.reset;
  } catch (e) {
    Sentry.captureException(e, {
      tags: { route: 'login-verify', step: 'lockout_evaluate', reason: 'redis_error' },
    });
    return NextResponse.json(
      { error: 'auth_system_error', retry_after: 10 },
      { status: 503, headers: { 'Retry-After': '10' } },
    );
  }

  if (!phoneOk) {
    const retryAfter = Math.max(1, Math.ceil(phoneReset - Date.now() / 1000));
    return NextResponse.json(
      { error: 'ACCOUNT_LOCKED', retry_after: retryAfter },
      {
        status: 423,
        headers: {
          'Retry-After': String(retryAfter),
        },
      },
    );
  }

  // Secondary per-IP cap on this route (cheap; protects shared infra from
  // a single noisy IP cycling random phones).
  const ip = getClientIp(request);
  const { success: ipOk, reset: ipReset } = await rateLimit(
    `login-verify:ip:${ip}`,
    30,
    LOGIN_LOCKOUT_WINDOW_SECS,
  );
  if (!ipOk) {
    const retryAfter = Math.max(1, Math.ceil(ipReset - Date.now() / 1000));
    return rateLimitedResponse(retryAfter);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    Sentry.captureMessage('login-verify missing supabase env', {
      level: 'error',
      tags: { route: 'login-verify' },
    });
    return NextResponse.json({ error: 'auth_system_error' }, { status: 500 });
  }

  const phoneDigits = normalizedPhone.replace(/\D/g, '');
  const email = `${phoneDigits}@centerhq.local`;

  const cookieStore = await cookies();
  const response = NextResponse.json({ ok: true });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value ?? '', options);
        });
      },
    },
  });

  let signInData: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>;
  try {
    signInData = await supabase.auth.signInWithPassword({ email, password: pin });
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'login-verify', step: 'signInWithPassword' } });
    return NextResponse.json({ error: 'auth_system_error' }, { status: 502 });
  }

  if (signInData.error) {
    if (isSystemAuthError(signInData.error)) {
      Sentry.captureException(signInData.error, {
        tags: { route: 'login-verify', step: 'signInWithPassword' },
      });
      return NextResponse.json({ error: 'auth_system_error' }, { status: 502 });
    }
    // Wrong PIN - the lockout counter has already been incremented above.
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  // Success - drop the per-phone counter so legitimate retries do not pile up.
  await clearLockoutCounter(normalizedPhone);

  return response;
}
