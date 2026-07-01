import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireCenterAuth } from '@/lib/centerAuth';
import { isWeakPin } from '@/lib/weakPins';
import { rateLimit, getClientIp, rateLimitedResponse } from '@/lib/ratelimit';
import { parseBodyWithLimit } from '@/lib/validate';

const SIX_DIGITS = /^\d{6}$/;

/** Same cap as verify-pin-reset: 5 attempts per 15 min. */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECS = 900;

/**
 * POST /api/auth/change-pin
 * Authenticated. Requires Bearer access token from an active center session.
 * Verifies currentPin before setting newPin server-side, enforcing the weak-PIN
 * reject list that open-ended supabase.auth.updateUser() calls bypassed.
 */
export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  // Rate-limit per user ID + IP (same cap as verify-pin-reset)
  const ip = getClientIp(request);
  const { success: userOk, reset: userReset } = await rateLimit(
    `change-pin:user:${auth.userId}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_SECS,
  );
  const { success: ipOk, reset: ipReset } = await rateLimit(
    `change-pin:ip:${ip}`,
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
    return NextResponse.json(
      { error: 'weak_pin', message: 'PIN is too common. Please choose a less obvious 6-digit code.' },
      { status: 400 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }

  const admin = getSupabaseAdmin();

  // Get the user's email from Supabase Auth to verify the current PIN
  const { data: authUserData, error: authUserErr } = await admin.auth.admin.getUserById(auth.userId);
  if (authUserErr || !authUserData.user?.email) {
    console.error('[change-pin] getUserById failed', authUserErr);
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
    return NextResponse.json({ error: 'wrong_current_pin' }, { status: 401 });
  }

  // Update the Supabase Auth password (server-authoritative)
  const { error: updateErr } = await admin.auth.admin.updateUserById(auth.userId, {
    password: newPin,
  });
  if (updateErr) {
    console.error('[change-pin] updateUserById failed', updateErr);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  // Refresh the authoritative "PIN is set" stamp (the Auth password above is the
  // credential). Non-fatal: the password was already updated; log and continue.
  const { error: dbErr } = await admin
    .from('users')
    .update({ pin_set_at: new Date().toISOString() })
    .eq('id', auth.userId);
  if (dbErr) {
    console.error('[change-pin] pin_set_at stamp failed', dbErr);
  }

  const nowIso = new Date().toISOString();
  await admin.from('audit_log').insert({
    action: 'change_pin_self',
    user_id: auth.userId,
    center_id: auth.centerId,
    details: { changed_at: nowIso },
    created_at: nowIso,
  });

  return NextResponse.json({ ok: true });
}
