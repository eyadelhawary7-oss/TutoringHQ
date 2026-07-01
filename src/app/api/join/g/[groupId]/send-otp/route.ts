import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { rateLimit } from '@/lib/ratelimit';
import {
  parseEnrollmentInput,
  hashOtp,
  generateOtp,
  maskPhone,
} from '@/lib/enrollmentOtp';

const ROUTE_TAG = 'api/join/g/send-otp';
const OTP_TTL_MS = 10 * 60 * 1000;

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'server_error' }, { status: 500 });
}

/**
 * POST /api/join/g/[groupId]/send-otp  - PUBLIC, no auth.
 *
 * Sends a verification code to the payer's phone for public student
 * self-enrollment. Rate limited to 3 sends per phone per hour (fail-OPEN on
 * Upstash outage - a code is better than a hard block here).
 *
 * TODO(whatsapp): OTP delivery needs (1) the Meta-approved Utility template
 * 'chq_enrollment_otp' [Arabic (EGY), body "كود تسجيلك في مجموعة {{1}}: {{2}}.
 * صالح ١٠ دقايق.", no buttons], and (2) a 'send_enrollment_otp_wa' handler in
 * /api/cron/process-outbox. Until both ship, rows queue but do not deliver.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const admin = supabaseAdmin;
  if (!admin) return fail('no_admin', new Error('service role unavailable'));

  const { groupId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const parsed = parseEnrollmentInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.code }, { status: 400 });
  }
  const { studentPhone, payerPhone } = parsed.value;

  // The group must exist, be active, and be private.
  const { data: group, error: groupErr } = await admin
    .from('student_groups')
    .select('id, name')
    .eq('id', groupId)
    .eq('status', 'active')
    .eq('kind', 'private')
    .maybeSingle();
  if (groupErr) return fail('group_lookup', groupErr);
  if (!group) {
    return NextResponse.json({ error: 'group_not_found' }, { status: 404 });
  }
  const groupName = (group as { name: string | null }).name ?? '';

  // Rate limit: 3 sends per payer phone per hour. Fails open (Upstash down ->
  // allow) per the helper's contract.
  const rl = await rateLimit(`enroll-otp:send:${payerPhone}`, 3, 3600);
  if (!rl.success) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // Already enrolled? Private students are center-less rows matched by phone.
  const { data: existingStudent, error: studentErr } = await admin
    .from('students')
    .select('id')
    .eq('phone', studentPhone)
    .is('center_id', null)
    .limit(1)
    .maybeSingle();
  if (studentErr) return fail('student_lookup', studentErr);
  if (existingStudent) {
    const { data: liveEnrollment, error: enrollErr } = await admin
      .from('enrollments')
      .select('id')
      .eq('group_id', groupId)
      .eq('student_id', (existingStudent as { id: string }).id)
      .in('status', ['pending', 'active'])
      .limit(1)
      .maybeSingle();
    if (enrollErr) return fail('enrollment_lookup', enrollErr);
    if (liveEnrollment) {
      return NextResponse.json({ error: 'already_enrolled' }, { status: 409 });
    }
  }

  const code = generateOtp();
  const codeHash = hashOtp(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  // Replace any prior unverified code for this group + phone (insert-or-replace).
  const { error: delErr } = await admin
    .from('enrollment_otps')
    .delete()
    .eq('group_id', groupId)
    .eq('phone', payerPhone)
    .is('verified_at', null);
  if (delErr) return fail('otp_clear', delErr);

  const { error: insErr } = await admin.from('enrollment_otps').insert({
    group_id: groupId,
    phone: payerPhone,
    code_hash: codeHash,
    expires_at: expiresAt,
  });
  if (insErr) return fail('otp_insert', insErr);

  // Queue the WhatsApp delivery (resilient send via the outbox). See TODO above.
  const { error: obErr } = await admin.from('webhook_outbox').insert({
    job_type: 'send_enrollment_otp_wa',
    payload: {
      toPhone: payerPhone,
      templateName: 'chq_enrollment_otp',
      params: [code, groupName],
    },
    status: 'pending',
    attempt_count: 0,
    max_attempts: 5,
    next_attempt_at: new Date().toISOString(),
  });
  if (obErr) {
    // Non-fatal: the OTP exists; a delivery enqueue failure is logged, not 500.
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'outbox_enqueue');
      Sentry.captureMessage(`enrollment OTP outbox enqueue failed: ${obErr.message}`, 'warning');
    });
  }

  return NextResponse.json({
    sent: true,
    maskedPhone: maskPhone(payerPhone),
    expiresAt,
  });
}
