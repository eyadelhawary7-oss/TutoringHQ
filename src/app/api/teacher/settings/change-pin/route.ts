import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';
import { isWeakPin } from '@/lib/weakPins';
import { rateLimit, getClientIp, rateLimitedResponse } from '@/lib/ratelimit';
import { parseBodyWithLimit } from '@/lib/validate';

const SIX_DIGITS = /^\d{6}$/;

/** Same cap as /api/auth/change-pin: 5 attempts per 15 min. */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECS = 900;

/**
 * POST /api/teacher/settings/change-pin
 * Teacher counterpart of /api/auth/change-pin (which requires a center
 * session a teacher does not have). Verifies the current PIN by
 * re-authenticating with the auth email server-side, enforces the shared
 * weak-PIN reject list, then updates the Supabase Auth password via the
 * service-role admin client and syncs users.pin_code.
 */
export async function POST(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  const ip = getClientIp(request);
  const { success: userOk, reset: userReset } = await rateLimit(
    `teacher-change-pin:user:${auth.userId}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_SECS,
  );
  const { success: ipOk, reset: ipReset } = await rateLimit(
    `teacher-change-pin:ip:${ip}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_SECS,
  );
  if (!userOk || !ipOk) {
    const resetSec = !userOk ? userReset : ipReset;
    const retryAfter = Math.max(1, Math.ceil(resetSec - Date.now() / 1000));
    return rateLimitedResponse(retryAfter);
  }

  let body: unknown;
  try {
    body = await parseBodyWithLimit(request, 65536);
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const currentPin =
    typeof (body as { currentPin?: unknown })?.currentPin === 'string'
      ? (body as { currentPin: string }).currentPin.trim()
      : '';
  const newPin =
    typeof (body as { newPin?: unknown })?.newPin === 'string'
      ? (body as { newPin: string }).newPin.trim()
      : '';

  if (!SIX_DIGITS.test(currentPin) || !SIX_DIGITS.test(newPin)) {
    return NextResponse.json({ error: 'invalid_format' }, { status: 400 });
  }

  if (isWeakPin(newPin)) {
    return NextResponse.json({ error: 'weak_pin' }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }

  const admin = auth.supabaseAdmin;

  // The auth email ({digits}@centerhq.local) is the credential the PIN pairs
  // with; fetch it server-side, never from the request.
  const { data: authUserData, error: authUserErr } = await admin.auth.admin.getUserById(
    auth.userId,
  );
  if (authUserErr || !authUserData.user?.email) {
    console.error('[teacher-change-pin] getUserById failed', authUserErr);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
  const email = authUserData.user.email;

  // Verify the current PIN by re-authenticating (server-side, no session persisted)
  const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await supabaseAnon.auth.signInWithPassword({
    email,
    password: currentPin,
  });
  if (signInError) {
    return NextResponse.json({ error: 'invalid_current_pin' }, { status: 401 });
  }

  const { error: updateErr } = await admin.auth.admin.updateUserById(auth.userId, {
    password: newPin,
  });
  if (updateErr) {
    console.error('[teacher-change-pin] updateUserById failed', updateErr);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }

  // Sync pin_code in public.users (bcrypt, consistent with /api/auth/change-pin)
  const newPinHash = await bcrypt.hash(newPin, 10);
  const { error: dbErr } = await admin
    .from('users')
    .update({ pin_code: newPinHash })
    .eq('id', auth.userId);
  if (dbErr) {
    console.error('[teacher-change-pin] pin_code sync failed', dbErr);
    // Non-fatal: Auth password was already updated; log and continue
  }

  const nowIso = new Date().toISOString();
  await admin.from('audit_log').insert({
    action: 'change_pin_self',
    user_id: auth.userId,
    center_id: null,
    details: { changed_at: nowIso, role: 'teacher' },
    created_at: nowIso,
  });

  return NextResponse.json({ success: true });
}
