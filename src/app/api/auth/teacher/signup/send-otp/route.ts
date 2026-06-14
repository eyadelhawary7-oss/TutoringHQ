import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { rateLimit } from '@/lib/ratelimit';
import {
  parseSignupPhone,
  generateOtp,
  hashOtp,
  maskPhone,
  devOtpEchoEnabled,
  TEACHER_SIGNUP_OTP_TTL_MS,
  TEACHER_SIGNUP_OTP_JOB_TYPE,
  TEACHER_SIGNUP_OTP_TEMPLATE,
} from '@/lib/teacherSignupOtp';

const ROUTE_TAG = 'api/auth/teacher/signup/send-otp';

/**
 * PUBLIC, no auth (the teacher has no account yet). Step 1 of the two-step
 * teacher signup: send a 6-digit OTP to the entered phone over WhatsApp so the
 * number is proven to be a live, reachable WhatsApp recipient before the account
 * is created. Step 2 (POST /api/auth/teacher/signup) verifies the code.
 *
 * Mirrors the student self-enrollment OTP send (src/app/api/join/[groupId]/send-otp):
 *   - generate crypto 6-digit code, store ONLY its SHA-256 hash, 10-minute expiry
 *   - replace any prior unverified code for the phone (insert-or-replace)
 *   - queue WhatsApp delivery to webhook_outbox (resilient, gated send)
 *
 * Delivery is feature-flag/stub-gated like every other WA send: the outbox worker
 * routes through the WhatsApp helper, which only sends when the template is
 * APPROVED in wa_meta_templates AND wa_sending_enabled. chq_teacher_signup_otp is
 * not yet approved and WhatsApp is not live, so rows queue but do not deliver.
 * Rule 149: OTP delivery is availability, not money/credentials, so the send
 * path fails OPEN (the OTP row is created even if enqueue fails).
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

  const parsed = parseSignupPhone((body as { phone?: unknown })?.phone);
  if (!parsed.ok) {
    return NextResponse.json({ error: 'Invalid phone', code: parsed.code }, { status: 400 });
  }
  const { phone, phoneDigits } = parsed;

  // Rate limit: 3 OTP sends per phone per hour. Fails OPEN (Upstash down -> allow)
  // per the helper contract; an OTP is better than a hard block here.
  const rl = await rateLimit(`teacher-signup-otp:send:${phoneDigits}`, 3, 3600);
  if (!rl.success) {
    return NextResponse.json({ error: 'rate_limited', code: 'RATE_LIMITED' }, { status: 429 });
  }

  // One account per phone: if the number is already registered, do not OTP it -
  // surface the same 409 the signup route would, so the UI can offer "log in".
  const { data: existing, error: dupErr } = await admin
    .from('users')
    .select('id')
    .eq('phone', phone)
    .limit(1)
    .maybeSingle();
  if (dupErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
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

  const code = generateOtp();
  const codeHash = hashOtp(code);
  const expiresAt = new Date(Date.now() + TEACHER_SIGNUP_OTP_TTL_MS).toISOString();

  // Replace any prior unverified code for this phone (insert-or-replace).
  const { error: delErr } = await admin
    .from('teacher_signup_otps')
    .delete()
    .eq('phone', phone)
    .is('verified_at', null);
  if (delErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'otp_clear');
      Sentry.captureException(delErr);
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  }

  const { error: insErr } = await admin.from('teacher_signup_otps').insert({
    phone,
    code_hash: codeHash,
    expires_at: expiresAt,
  });
  if (insErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'otp_insert');
      Sentry.captureException(insErr);
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  }

  // Queue the WhatsApp delivery (resilient send via the outbox). Gated/stubbed:
  // the worker only sends once chq_teacher_signup_otp is APPROVED and WA is live.
  const { error: obErr } = await admin.from('webhook_outbox').insert({
    job_type: TEACHER_SIGNUP_OTP_JOB_TYPE,
    payload: {
      toPhone: phone,
      templateName: TEACHER_SIGNUP_OTP_TEMPLATE,
      params: [code],
    },
    status: 'pending',
    attempt_count: 0,
    max_attempts: 5,
    next_attempt_at: new Date().toISOString(),
  });
  if (obErr) {
    // Non-fatal (fail-OPEN): the OTP exists; a delivery enqueue failure is logged.
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'outbox_enqueue');
      Sentry.captureMessage(
        `teacher signup OTP outbox enqueue failed: ${obErr.message}`,
        'warning',
      );
    });
  }

  const response: { sent: true; maskedPhone: string; expiresAt: string; devCode?: string } = {
    sent: true,
    maskedPhone: maskPhone(phone),
    expiresAt,
  };
  // Non-prod test bypass ONLY: echo the real code so dev/E2E can finish the flow
  // while WhatsApp delivery is stubbed. Never reachable in production.
  if (devOtpEchoEnabled()) {
    response.devCode = code;
  }

  return NextResponse.json(response);
}
