import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { normalizePhone, isValidEgyptianMobileE164 } from '@/lib/utils/phone';
import { isWeakPin } from '@/lib/weakPins';
import { rateLimit, rateLimitExceededResponse, getUpstashRedis } from '@/lib/ratelimit';
import { hashOtp, TEACHER_SIGNUP_OTP_MAX_ATTEMPTS } from '@/lib/teacherSignupOtp';
import {
  createUniqueTeacherReferralCode,
  resolveTeacherReferralCode,
} from '@/lib/teacherReferral';

/**
 * PUBLIC teacher signup (no bearer - the teacher has no account yet). Creates
 * the full Model B identity for a center-less teacher: auth.users +
 * public.users (role 'teacher', center_id NULL) + teacher_profiles. After
 * this the teacher logs in with phone + PIN via the normal login flow.
 *
 * Two-step: the client first calls POST .../signup/send-otp, then submits the
 * 6-digit `code` here. We verify the OTP against teacher_signup_otps BEFORE
 * creating any rows, so the account is never created until the WhatsApp number
 * is proven reachable. Verification mirrors the student self-enrollment verify
 * (fail-CLOSED rate limit + per-row attempts<5 brute-force cap).
 *
 * ITEM 1: when the teacher arrived via ?plan=pro the client sends planIntent:'pro'.
 * We persist it on teacher_profiles.signup_plan_intent as a steering hint only -
 * the trial is unchanged (still the 14-day Standard trial provisioned by
 * trg_provision_teacher_subscription on the first private group).
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
    code: rawCode,
    planIntent: rawPlanIntent,
    referralCode: rawReferralCode,
    termsAccepted,
    privacyAccepted,
  } = (body ?? {}) as {
    phone?: unknown;
    pin?: unknown;
    name?: unknown;
    subject?: unknown;
    code?: unknown;
    planIntent?: unknown;
    referralCode?: unknown;
    termsAccepted?: unknown;
    privacyAccepted?: unknown;
  };

  // PDPL consent: terms acceptance and data-processing consent are distinct and
  // both mandatory. Enforced server-side so a bypassed checkbox (direct API
  // call) is rejected before any account is created.
  if (termsAccepted !== true || privacyAccepted !== true) {
    return NextResponse.json(
      { error: 'Consent required', code: 'CONSENT_REQUIRED' },
      { status: 400 },
    );
  }

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

  // ITEM 1: only the literal 'pro' is honoured; anything else (junk ?plan, absent)
  // is treated as no intent. Never throws - an unknown plan is silently ignored.
  const planIntent = rawPlanIntent === 'pro' ? 'pro' : null;

  const phoneDigits = phone.replace(/\D/g, '');

  // Rate limit: 3 signup attempts per hour per phone (mirrors the Upstash
  // sliding-window pattern used by the auth routes; fails open if Upstash is
  // unset).
  const rl = await rateLimit(`teacher-signup:${phoneDigits}`, 3, 3600);
  if (!rl.success) {
    return rateLimitExceededResponse(rl.reset - Math.floor(Date.now() / 1000));
  }

  // --- OTP gate: verify the WhatsApp code BEFORE creating any rows. Mirrors the
  // student self-enrollment verify-otp. Fail-CLOSED: a 6-digit code is a
  // brute-force surface, so without a trusted rate-limit ceiling (Upstash) we
  // deny rather than allow. The per-row attempts<5 cap is the second guard.
  const submittedCode = typeof rawCode === 'string' ? rawCode.trim() : '';
  if (!/^\d{6}$/.test(submittedCode)) {
    return NextResponse.json({ error: 'Invalid code', code: 'INVALID_CODE' }, { status: 400 });
  }

  if (!getUpstashRedis()) {
    return NextResponse.json(
      { error: 'verification unavailable', code: 'VERIFICATION_UNAVAILABLE' },
      { status: 503 },
    );
  }
  try {
    const verifyRl = await rateLimit(`teacher-signup-otp:verify:${phoneDigits}`, 10, 600);
    if (!verifyRl.success) {
      return NextResponse.json({ error: 'rate_limited', code: 'RATE_LIMITED' }, { status: 429 });
    }
  } catch {
    return NextResponse.json(
      { error: 'verification unavailable', code: 'VERIFICATION_UNAVAILABLE' },
      { status: 503 },
    );
  }

  const nowIso = new Date().toISOString();
  const { data: otpRow, error: otpErr } = await admin
    .from('teacher_signup_otps')
    .select('id, code_hash, attempts')
    .eq('phone', phone)
    .is('verified_at', null)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (otpErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/auth/teacher/signup');
      scope.setTag('step', 'otp_lookup');
      Sentry.captureException(otpErr);
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  }
  if (!otpRow) {
    return NextResponse.json({ error: 'Code expired', code: 'OTP_EXPIRED' }, { status: 410 });
  }
  const otp = otpRow as { id: string; code_hash: string; attempts: number };

  const nextAttempts = (otp.attempts ?? 0) + 1;
  if (nextAttempts >= TEACHER_SIGNUP_OTP_MAX_ATTEMPTS) {
    await admin.from('teacher_signup_otps').delete().eq('id', otp.id);
    return NextResponse.json(
      { error: 'Too many attempts', code: 'OTP_TOO_MANY_ATTEMPTS' },
      { status: 429 },
    );
  }
  if (hashOtp(submittedCode) !== otp.code_hash) {
    await admin.from('teacher_signup_otps').update({ attempts: nextAttempts }).eq('id', otp.id);
    return NextResponse.json({ error: 'Invalid code', code: 'OTP_INVALID' }, { status: 400 });
  }
  // Code matches. verified_at is set only AFTER the account is created (below) so
  // a transient failure leaves the code usable for retry.

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

  // public.users - role and center_id are server-set (never from the body).
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

  // ITEM 4 referral: every teacher gets their OWN unique, name-derived code,
  // and (if they arrived with one) we resolve the code they were referred with
  // to the referrer's user_id. Both are best-effort - createUniqueTeacherReferralCode
  // never throws (referral_code is nullable; the UNIQUE index is the backstop),
  // and resolveTeacherReferralCode silently ignores an invalid/empty code
  // (mirrors center signup). Self-referral is structurally impossible here (the
  // new teacher has no code yet), but we guard referrerId !== userId defensively.
  const referralCode = await createUniqueTeacherReferralCode(admin, name);
  const resolvedReferrer = await resolveTeacherReferralCode(admin, rawReferralCode);
  const referredByTeacherId =
    resolvedReferrer && resolvedReferrer !== userId ? resolvedReferrer : null;

  // teacher_profiles - required: a missing profile makes finish_class_and_bill
  // raise 23503 (the integrity flag from step 6). RULE 151: the consent
  // timestamps are CORE for this route - they are written in the same insert
  // as the profile, so a profErr (handled below: cleanup + 500 + Sentry) means
  // we never create an account without recording consent.
  const consentNow = new Date().toISOString();
  const { error: profErr } = await admin.from('teacher_profiles').insert({
    user_id: userId,
    display_name: name,
    subject,
    is_test: false,
    policy_accepted_at: consentNow,
    terms_accepted_at: consentNow,
    policy_version: '1.0',
    signup_plan_intent: planIntent,
    referral_code: referralCode,
    referred_by_teacher_id: referredByTeacherId,
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

  // Account committed: consume the OTP so it cannot be replayed. Best-effort -
  // a failure here does not undo a successful signup (the code simply expires).
  const { error: consumeErr } = await admin
    .from('teacher_signup_otps')
    .update({ verified_at: nowIso })
    .eq('id', otp.id);
  if (consumeErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/auth/teacher/signup');
      scope.setTag('step', 'otp_consume');
      Sentry.captureMessage(
        `teacher signup OTP consume failed (account created): ${consumeErr.message}`,
        'warning',
      );
    });
  }

  return NextResponse.json({ userId, planIntent }, { status: 201 });
}
