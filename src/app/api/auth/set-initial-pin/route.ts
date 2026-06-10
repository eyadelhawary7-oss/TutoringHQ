import * as Sentry from '@sentry/nextjs';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  getClientIp,
  getUpstashRedis,
  rateLimit,
} from '@/lib/ratelimit';
import { isWeakPin } from '@/lib/weakPins';
import { parseBodyWithLimit } from '@/lib/validate';
import {
  SIGNUP_SESSION_COOKIE,
  verifySignupSession,
} from '@/lib/signupSessionCookie';
import {
  claimToken,
  findLiveTokenByPlaintext,
  findLiveTokenForUser,
  invalidateSiblingTokens,
} from '@/lib/pinSetupTokens';

const SIX_DIGITS = /^\d{6}$/;
const SET_PIN_RATE_LIMIT_MAX = 5;
const SET_PIN_RATE_LIMIT_WINDOW_SECS = 900;

/**
 * Center states that constitute "payment confirmed by HMAC-verified webhook":
 *  - status='active'  + approved_at NOT NULL  → auto-approve happy path
 *  - status='paid_pending_activation'         → paid, admin must flip manually
 * Anything else (pending_payment, suspended, blacklisted, etc.) is NOT proof
 * of payment and MUST refuse a PIN-set, even with a valid cookie.
 */
function isCenterPaidAndActivated(c: {
  status?: string | null;
  billing_status?: string | null;
  approved_at?: string | null;
}): boolean {
  if (c.status === 'paid_pending_activation') return true;
  if (c.status === 'active' && c.approved_at) return true;
  return false;
}

function unauthorizedResponse() {
  // Generic, non-leaky: do not distinguish missing-cookie / expired-cookie /
  // wrong-center to avoid oracle behavior.
  return NextResponse.json(
    { error: 'token_invalid_or_used' },
    { status: 401 },
  );
}

/**
 * POST /api/auth/set-initial-pin
 *
 * TRUST ANCHOR (route.ts:enforcement points):
 *  (1) Cookie path: signed chq_signup_session cookie binds the request to a
 *      specific centerId issued during /api/signup. Cookie alone is NEVER
 *      sufficient (see (2)). Plus: a live pin_setup_tokens row issued by the
 *      HMAC-verified Paymob webhook must exist for the owner user.
 *  (2) AND-ed with (1): the center's DB state must be "paid+activated" - a
 *      state ONLY the HMAC-verified /api/paymob/webhook writes. Browser
 *      redirect URL never sets this state.
 *  (3) Fallback path: a plaintext token from the WhatsApp Set-PIN link MUST
 *      hash to a live pin_setup_tokens row (source='fallback_link'). That row
 *      is bound to a user_id; the center is re-verified as paid+activated
 *      before proceeding.
 *
 * In both paths the user_id ultimately consumed is the row's user_id (the
 * payment record's owner), NOT a value derived from the cookie body. If the
 * cookie-claimed centerId and the row's user.center_id disagreed, trust the
 * payment record - but the lookup chain (cookie→center→owner-user→row) makes
 * disagreement structurally impossible since we look up the row BY the user
 * we derived from the center.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await parseBodyWithLimit(request, 65536);
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const pin =
    typeof (body as { pin?: unknown })?.pin === 'string'
      ? (body as { pin: string }).pin.trim()
      : '';
  const pinConfirm =
    typeof (body as { pinConfirm?: unknown })?.pinConfirm === 'string'
      ? (body as { pinConfirm: string }).pinConfirm.trim()
      : '';
  const submittedToken =
    typeof (body as { token?: unknown })?.token === 'string'
      ? (body as { token: string }).token.trim()
      : '';

  if (!SIX_DIGITS.test(pin) || !SIX_DIGITS.test(pinConfirm)) {
    return NextResponse.json({ error: 'invalid_format' }, { status: 400 });
  }
  if (pin !== pinConfirm) {
    return NextResponse.json({ error: 'mismatch' }, { status: 400 });
  }

  // Rate-limit - fails closed via the explicit getUpstashRedis check (auth
  // mutation; same posture as /api/auth/login-verify).
  if (getUpstashRedis() === null) {
    Sentry.captureMessage(
      'set-initial-pin: Upstash not configured - refusing, cannot rate-limit auth mutation',
      {
        level: 'error',
        tags: { route: 'set-initial-pin', reason: 'redis_not_configured' },
      },
    );
    return NextResponse.json(
      { error: 'auth_system_error', retry_after: 10 },
      { status: 503, headers: { 'Retry-After': '10' } },
    );
  }
  const ip = getClientIp(request);
  try {
    const { success } = await rateLimit(
      `set-initial-pin:ip:${ip}`,
      SET_PIN_RATE_LIMIT_MAX,
      SET_PIN_RATE_LIMIT_WINDOW_SECS,
    );
    if (!success) {
      return NextResponse.json(
        { error: 'too_many_requests', retry_after: SET_PIN_RATE_LIMIT_WINDOW_SECS },
        { status: 429 },
      );
    }
  } catch (e) {
    Sentry.captureException(e, {
      tags: { route: 'set-initial-pin', step: 'rate_limit' },
    });
    return NextResponse.json(
      { error: 'auth_system_error', retry_after: 10 },
      { status: 503, headers: { 'Retry-After': '10' } },
    );
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'set-initial-pin', step: 'admin_init' } });
    return NextResponse.json({ error: 'auth_system_error' }, { status: 500 });
  }

  // -------- Resolve which path (cookie vs. fallback URL token). --------
  const cookieStoreEarly = await cookies();
  const sessionCookieValue = cookieStoreEarly.get(SIGNUP_SESSION_COOKIE)?.value;
  const session = verifySignupSession(sessionCookieValue ?? null);

  let rowId: string | null = null;
  let userId: string | null = null;

  if (submittedToken) {
    // Fallback path (chq_pin_setup_link).
    let row;
    try {
      row = await findLiveTokenByPlaintext(admin, submittedToken);
    } catch (e) {
      Sentry.captureException(e, {
        tags: { route: 'set-initial-pin', step: 'token_lookup' },
      });
      return NextResponse.json({ error: 'auth_system_error' }, { status: 500 });
    }
    if (!row || row.source !== 'fallback_link') {
      return unauthorizedResponse();
    }
    rowId = row.id;
    userId = row.user_id;
  } else if (session) {
    // Cookie path (happy path). Re-verify paid+activated state via DB.
    const { data: center, error: centerErr } = await admin
      .from('centers')
      .select('id, status, billing_status, approved_at')
      .eq('id', session.centerId)
      .maybeSingle();
    if (centerErr) {
      Sentry.captureException(centerErr, {
        tags: { route: 'set-initial-pin', step: 'center_lookup' },
      });
      return NextResponse.json({ error: 'auth_system_error' }, { status: 500 });
    }
    if (
      !center ||
      !isCenterPaidAndActivated(center as { status?: string | null; billing_status?: string | null; approved_at?: string | null })
    ) {
      // Center exists but webhook hasn't finalized payment, OR center is in
      // some other state. Refuse - never trust the cookie alone.
      return NextResponse.json(
        { error: 'not_finalized' },
        { status: 409 },
      );
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
        tags: { route: 'set-initial-pin', step: 'owner_lookup' },
      });
      return NextResponse.json({ error: 'auth_system_error' }, { status: 500 });
    }
    if (!owner) {
      // Owner row not created yet (race with webhook). Tell the client to retry.
      return NextResponse.json({ error: 'not_finalized' }, { status: 409 });
    }
    if ((owner as { pin_code?: string | null }).pin_code) {
      return NextResponse.json({ error: 'pin_already_set' }, { status: 409 });
    }

    let live;
    try {
      live = await findLiveTokenForUser(admin, (owner as { id: string }).id);
    } catch (e) {
      Sentry.captureException(e, {
        tags: { route: 'set-initial-pin', step: 'token_lookup' },
      });
      return NextResponse.json({ error: 'auth_system_error' }, { status: 500 });
    }
    if (!live) {
      // Webhook has not yet minted the token. Client should poll readiness.
      return NextResponse.json({ error: 'not_finalized' }, { status: 409 });
    }
    rowId = live.id;
    userId = live.user_id;
  } else {
    // No cookie, no token → no authority.
    return unauthorizedResponse();
  }

  if (!rowId || !userId) return unauthorizedResponse();

  // -------- Pre-claim: verify user has NO existing PIN. --------
  const { data: userRow, error: userErr } = await admin
    .from('users')
    .select('id, pin_code, center_id')
    .eq('id', userId)
    .maybeSingle();
  if (userErr) {
    Sentry.captureException(userErr, {
      tags: { route: 'set-initial-pin', step: 'user_lookup' },
    });
    return NextResponse.json({ error: 'auth_system_error' }, { status: 500 });
  }
  if (!userRow) return unauthorizedResponse();
  if ((userRow as { pin_code?: string | null }).pin_code) {
    return NextResponse.json({ error: 'pin_already_set' }, { status: 409 });
  }

  // For the fallback path: re-verify the user's center is paid+activated.
  // The cookie path already did this above; do it for both paths for
  // defense-in-depth.
  if (submittedToken) {
    const centerId = (userRow as { center_id?: string | null }).center_id;
    if (!centerId) return unauthorizedResponse();
    const { data: center, error: cErr } = await admin
      .from('centers')
      .select('id, status, billing_status, approved_at')
      .eq('id', centerId)
      .maybeSingle();
    if (cErr) {
      Sentry.captureException(cErr, {
        tags: { route: 'set-initial-pin', step: 'center_recheck' },
      });
      return NextResponse.json({ error: 'auth_system_error' }, { status: 500 });
    }
    if (
      !center ||
      !isCenterPaidAndActivated(center as { status?: string | null; billing_status?: string | null; approved_at?: string | null })
    ) {
      return NextResponse.json({ error: 'not_finalized' }, { status: 409 });
    }
  }

  // -------- Server-authoritative weak-PIN check (Rule 139). --------
  if (isWeakPin(pin)) {
    return NextResponse.json(
      { error: 'weak_pin', message: 'PIN is too common. Please choose a less obvious 6-digit code.' },
      { status: 400 },
    );
  }

  // -------- Atomic single-use token claim. --------
  let claim;
  try {
    claim = await claimToken(admin, { rowId, ip });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { route: 'set-initial-pin', step: 'token_claim' },
    });
    return NextResponse.json({ error: 'auth_system_error' }, { status: 500 });
  }
  if (!claim) {
    return unauthorizedResponse();
  }
  if (claim.userId !== userId) {
    // Should never happen given the lookup chain; defense in depth.
    Sentry.captureMessage('set-initial-pin: claimed userId disagrees with lookup userId', {
      level: 'error',
      tags: { route: 'set-initial-pin', step: 'claim_mismatch' },
    });
    return NextResponse.json({ error: 'auth_system_error' }, { status: 500 });
  }

  // -------- Set the Supabase Auth password (server-authoritative). --------
  const { error: updateAuthErr } = await admin.auth.admin.updateUserById(userId, {
    password: pin,
  });
  if (updateAuthErr) {
    Sentry.captureException(updateAuthErr, {
      tags: { route: 'set-initial-pin', step: 'updateUserById' },
    });
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  // Mirror pin_code (non-authoritative; see change-pin route's note).
  try {
    const pinHash = await bcrypt.hash(pin, 10);
    const { error: pinSyncErr } = await admin
      .from('users')
      .update({ pin_code: pinHash })
      .eq('id', userId);
    if (pinSyncErr) {
      Sentry.captureException(pinSyncErr, {
        tags: { route: 'set-initial-pin', step: 'pin_code_sync' },
      });
    }
  } catch (e) {
    Sentry.captureException(e, {
      tags: { route: 'set-initial-pin', step: 'pin_code_sync' },
    });
  }

  // Invalidate any sibling live tokens (e.g. a leaked fallback link from before).
  try {
    await invalidateSiblingTokens(admin, userId);
  } catch (e) {
    Sentry.captureException(e, {
      tags: { route: 'set-initial-pin', step: 'invalidate_siblings' },
    });
  }

  // Audit log.
  try {
    await admin.from('audit_log').insert({
      action: 'set_initial_pin',
      user_id: userId,
      center_id: (userRow as { center_id?: string | null }).center_id ?? null,
      details: {
        set_at: new Date().toISOString(),
        source: submittedToken ? 'fallback_link' : 'webhook_paymob',
      },
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { route: 'set-initial-pin', step: 'audit_log' },
    });
  }

  // -------- Establish SSR session (auto-login). --------
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    // PIN is set, but we can't auto-login. The owner can log in via /login.
    Sentry.captureMessage('set-initial-pin: missing supabase env for auto-login', {
      level: 'error',
      tags: { route: 'set-initial-pin', reason: 'missing_supabase_env' },
    });
    return NextResponse.json({ ok: true, autoLogin: false });
  }

  // Resolve the user's auth email for the password-grant call.
  const { data: authUser, error: authUserErr } = await admin.auth.admin.getUserById(userId);
  if (authUserErr || !authUser?.user?.email) {
    Sentry.captureException(authUserErr ?? new Error('no email'), {
      tags: { route: 'set-initial-pin', step: 'getUserById' },
    });
    return NextResponse.json({ ok: true, autoLogin: false });
  }

  const cookieStore = await cookies();
  const response = NextResponse.json({ ok: true, autoLogin: true });
  // Drop the signup-session cookie now that it has served its purpose.
  response.cookies.set({
    name: SIGNUP_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 0,
  });

  const ssrSupabase = createServerClient(supabaseUrl, supabaseAnonKey, {
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

  try {
    const { error: signInErr } = await ssrSupabase.auth.signInWithPassword({
      email: authUser.user.email,
      password: pin,
    });
    if (signInErr) {
      Sentry.captureException(signInErr, {
        tags: { route: 'set-initial-pin', step: 'auto_login' },
      });
      return NextResponse.json({ ok: true, autoLogin: false });
    }
  } catch (e) {
    Sentry.captureException(e, {
      tags: { route: 'set-initial-pin', step: 'auto_login' },
    });
    return NextResponse.json({ ok: true, autoLogin: false });
  }

  return response;
}
