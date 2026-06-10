import * as Sentry from '@sentry/nextjs';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getClientIp, rateLimit } from '@/lib/ratelimit';
import {
  SIGNUP_SESSION_COOKIE,
  verifySignupSession,
} from '@/lib/signupSessionCookie';
import { findLiveTokenForUser } from '@/lib/pinSetupTokens';

/**
 * GET /api/signup/pin-setup-readiness
 *
 * Tiny poll endpoint used by /set-pin to wait out the redirect-vs-webhook race.
 * Returns { ready: boolean }. Authenticated by the same signed cookie used by
 * /api/auth/set-initial-pin. Does NOT issue or expose any token or secret.
 *
 * Rate-limited per IP to bound runaway client polls. Fail-open is fine here:
 * worst case during an Upstash outage, the page polls more aggressively than
 * intended; no security boundary depends on this counter.
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const sessionCookieValue = cookieStore.get(SIGNUP_SESSION_COOKIE)?.value;
  const session = verifySignupSession(sessionCookieValue ?? null);
  if (!session) {
    return NextResponse.json({ ready: false, reason: 'no_session' });
  }

  const ip = getClientIp(request);
  try {
    const { success } = await rateLimit(`pin-setup-readiness:ip:${ip}`, 60, 60);
    if (!success) {
      return NextResponse.json({ ready: false, reason: 'rate_limited' }, { status: 429 });
    }
  } catch (e) {
    // Fail-open: continue without rate-limit; do not block the page.
    Sentry.captureException(e, {
      tags: { route: 'pin-setup-readiness', step: 'rate_limit' },
    });
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (e) {
    Sentry.captureException(e, {
      tags: { route: 'pin-setup-readiness', step: 'admin_init' },
    });
    return NextResponse.json({ ready: false, reason: 'system_error' });
  }

  const { data: center, error: centerErr } = await admin
    .from('centers')
    .select('id, status, approved_at')
    .eq('id', session.centerId)
    .maybeSingle();
  if (centerErr) {
    Sentry.captureException(centerErr, {
      tags: { route: 'pin-setup-readiness', step: 'center_lookup' },
    });
    return NextResponse.json({ ready: false, reason: 'system_error' });
  }
  if (!center) return NextResponse.json({ ready: false, reason: 'not_finalized' });

  const cs = center as { status?: string | null; approved_at?: string | null };
  const paidActivated =
    cs.status === 'paid_pending_activation' ||
    (cs.status === 'active' && !!cs.approved_at);
  if (!paidActivated) {
    return NextResponse.json({ ready: false, reason: 'not_finalized' });
  }

  const { data: owner, error: ownerErr } = await admin
    .from('users')
    .select('id, pin_code')
    .eq('center_id', session.centerId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle();
  if (ownerErr) {
    Sentry.captureException(ownerErr, {
      tags: { route: 'pin-setup-readiness', step: 'owner_lookup' },
    });
    return NextResponse.json({ ready: false, reason: 'system_error' });
  }
  if (!owner) return NextResponse.json({ ready: false, reason: 'not_finalized' });
  if ((owner as { pin_code?: string | null }).pin_code) {
    // Already set - owner should be logging in normally.
    return NextResponse.json({ ready: false, reason: 'pin_already_set' });
  }

  let live;
  try {
    live = await findLiveTokenForUser(admin, (owner as { id: string }).id);
  } catch (e) {
    Sentry.captureException(e, {
      tags: { route: 'pin-setup-readiness', step: 'token_lookup' },
    });
    return NextResponse.json({ ready: false, reason: 'system_error' });
  }
  if (!live) return NextResponse.json({ ready: false, reason: 'not_finalized' });

  return NextResponse.json({ ready: true });
}
