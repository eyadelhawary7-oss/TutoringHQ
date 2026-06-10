import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { normalizePhone, isValidEgyptianMobileE164 } from '@/lib/utils/phone';
import { isWeakPin } from '@/lib/weakPins';
import { rateLimit, rateLimitExceededResponse } from '@/lib/ratelimit';

/**
 * PUBLIC teacher signup (no bearer - the teacher has no account yet). Creates
 * the full Model B identity for a center-less teacher: auth.users +
 * public.users (role 'teacher', center_id NULL) + teacher_profiles. After
 * this the teacher logs in with phone + PIN via the normal login flow.
 *
 * RULE 152 (the single most dangerous rule): every auth.users row must have
 * confirmation_token / recovery_token / email_change_token_new / email_change
 * set to '' (empty string), NEVER null, or signInWithPassword 500s for that
 * user. The center signup paths (signup/complete, signupPaymobAutoApprove)
 * never set these explicitly and work in production because GoTrue's
 * admin.createUser populates them as empty strings (verified on prod: 0 null
 * among @centerhq.local rows). We additionally pass them explicitly here as
 * defense-in-depth so the guarantee does not depend on GoTrue version drift.
 *
 * Atomicity: the three rows are created in order; any failure rolls back the
 * earlier rows (best-effort) so we never leave an orphaned auth.users row
 * without a public.users row, or a teacher without a teacher_profiles row (a
 * missing profile makes finish_class_and_bill raise 23503).
 */
export async function POST(request: Request) {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request', code: 'INVALID_BODY' }, { status: 400 });
  }
  const {
    phone: rawPhone,
    pin: rawPin,
    name: rawName,
    subject: rawSubject,
  } = (body ?? {}) as { phone?: unknown; pin?: unknown; name?: unknown; subject?: unknown };

  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (name.length < 2 || name.length > 120) {
    return NextResponse.json({ error: 'Invalid name', code: 'INVALID_NAME' }, { status: 400 });
  }

  const phone = normalizePhone(typeof rawPhone === 'string' ? rawPhone : '');
  if (!isValidEgyptianMobileE164(phone)) {
    return NextResponse.json({ error: 'Invalid phone', code: 'INVALID_PHONE' }, { status: 400 });
  }

  const pin = typeof rawPin === 'string' ? rawPin : '';
  if (!/^\d{6}$/.test(pin) || isWeakPin(pin)) {
    return NextResponse.json({ error: 'Weak PIN', code: 'WEAK_PIN' }, { status: 400 });
  }

  const subject =
    typeof rawSubject === 'string' && rawSubject.trim() ? rawSubject.trim() : null;

  const phoneDigits = phone.replace(/\D/g, '');

  // Rate limit: 3 signup attempts per hour per phone (mirrors the Upstash
  // sliding-window pattern used by the auth routes; fails open if Upstash is
  // unset).
  const rl = await rateLimit(`teacher-signup:${phoneDigits}`, 3, 3600);
  if (!rl.success) {
    return rateLimitExceededResponse(rl.reset - Math.floor(Date.now() / 1000));
  }

  const authEmail = `${phoneDigits}@centerhq.local`;

  // Duplicate pre-check: one account per phone. createUser's unique-email
  // error is the race-safe backstop below.
  const { data: existing, error: dupErr } = await admin
    .from('users')
    .select('id')
    .eq('phone', phone)
    .limit(1)
    .maybeSingle();
  if (dupErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/auth/teacher/signup');
      scope.setTag('step', 'duplicate_check');
      Sentry.captureException(dupErr);
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json(
      { error: 'Phone already registered', code: 'PHONE_ALREADY_REGISTERED' },
      { status: 409 },
    );
  }

  // RULE 152: token fields forced to '' at creation. Typed loosely because the
  // supabase-js AdminUserAttributes type does not declare these GoTrue columns;
  // unknown fields are ignored server-side, and GoTrue sets them to '' anyway.
  const createAttrs = {
    email: authEmail,
    password: pin,
    email_confirm: true,
    user_metadata: { full_name: name, signup_kind: 'teacher_private' },
    confirmation_token: '',
    recovery_token: '',
    email_change_token_new: '',
    email_change: '',
  };
  const { data: created, error: createErr } = await admin.auth.admin.createUser(
    createAttrs as Parameters<typeof admin.auth.admin.createUser>[0],
  );

  if (createErr || !created?.user?.id) {
    const msg = createErr?.message?.toLowerCase() ?? '';
    if (msg.includes('already') || msg.includes('registered') || msg.includes('duplicate')) {
      return NextResponse.json(
        { error: 'Phone already registered', code: 'PHONE_ALREADY_REGISTERED' },
        { status: 409 },
      );
    }
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/auth/teacher/signup');
      scope.setTag('step', 'create_auth_user');
      Sentry.captureException(createErr ?? new Error('createUser returned no user'));
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  }

  const userId = created.user.id;

  // public.users — role and center_id are server-set (never from the body).
  // Model B: a teacher is center-less (center_id NULL).
  const { error: userErr } = await admin.from('users').insert({
    id: userId,
    role: 'teacher',
    name,
    phone,
    center_id: null,
    preferred_locale: 'ar',
  });
  if (userErr) {
    // Cleanup: never leave an auth.users row without a public.users row.
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/auth/teacher/signup');
      scope.setTag('step', 'insert_users');
      Sentry.captureException(userErr);
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  }

  // teacher_profiles — required: a missing profile makes finish_class_and_bill
  // raise 23503 (the integrity flag from step 6).
  const { error: profErr } = await admin.from('teacher_profiles').insert({
    user_id: userId,
    display_name: name,
    subject,
    is_test: false,
  });
  if (profErr) {
    // Cleanup both rows created above (best-effort).
    try {
      await admin.from('users').delete().eq('id', userId);
    } catch {
      /* best-effort */
    }
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/auth/teacher/signup');
      scope.setTag('step', 'insert_teacher_profile');
      Sentry.captureException(profErr);
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  }

  return NextResponse.json({ userId }, { status: 201 });
}
