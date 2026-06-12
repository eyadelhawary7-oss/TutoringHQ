import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getUpstashRedis, rateLimit } from '@/lib/ratelimit';
import { parseEnrollmentInput, hashOtp } from '@/lib/enrollmentOtp';

const ROUTE_TAG = 'api/join/verify-otp';
const MAX_ATTEMPTS = 5;

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'server_error' }, { status: 500 });
}

/**
 * POST /api/join/[groupId]/verify-otp  - PUBLIC, no auth.
 *
 * Verifies the code and, on success, enrolls the student. Rate limiting is
 * fail-CLOSED: if Upstash is unavailable we deny, because this endpoint mutates
 * enrollment and brute-forces a 6-digit code. The per-row attempts<5 cap is the
 * second guard.
 *
 * Student insert mirrors the teacher add-student route (create-or-link a
 * center-less student by phone), then create_enrollment(source='self_link')
 * with the group's teacher as actor, then auto-activate pending -> active.
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

  const submittedCode = typeof (body as { code?: unknown })?.code === 'string'
    ? ((body as { code: string }).code).trim()
    : '';

  const parsed = parseEnrollmentInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.code }, { status: 400 });
  }
  const { studentName, studentPhone, payer, parentPhone, payerPhone } = parsed.value;

  if (!/^\d{6}$/.test(submittedCode)) {
    return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
  }

  // Fail-CLOSED rate limit: no Redis (or a Redis error) means we cannot trust
  // the brute-force ceiling, so we deny rather than allow.
  if (!getUpstashRedis()) {
    return NextResponse.json({ error: 'verification_unavailable' }, { status: 503 });
  }
  try {
    const rl = await rateLimit(`enroll-otp:verify:${payerPhone}`, 10, 600);
    if (!rl.success) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
  } catch {
    return NextResponse.json({ error: 'verification_unavailable' }, { status: 503 });
  }

  // The group must still be active + private (and we need its teacher + fee).
  const { data: group, error: groupErr } = await admin
    .from('student_groups')
    .select('id, name, fee_per_class, teacher_id')
    .eq('id', groupId)
    .eq('status', 'active')
    .eq('kind', 'private')
    .maybeSingle();
  if (groupErr) return fail('group_lookup', groupErr);
  if (!group) {
    return NextResponse.json({ error: 'group_not_found' }, { status: 404 });
  }
  const g = group as {
    id: string;
    name: string | null;
    fee_per_class: number | string | null;
    teacher_id: string | null;
  };

  // Most recent unverified, unexpired code for this group + phone.
  const nowIso = new Date().toISOString();
  const { data: otpRow, error: otpErr } = await admin
    .from('enrollment_otps')
    .select('id, code_hash, attempts')
    .eq('group_id', groupId)
    .eq('phone', payerPhone)
    .is('verified_at', null)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (otpErr) return fail('otp_lookup', otpErr);
  if (!otpRow) {
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }
  const otp = otpRow as { id: string; code_hash: string; attempts: number };

  const nextAttempts = (otp.attempts ?? 0) + 1;
  if (nextAttempts >= MAX_ATTEMPTS) {
    await admin.from('enrollment_otps').delete().eq('id', otp.id);
    return NextResponse.json({ error: 'too_many_attempts' }, { status: 429 });
  }

  if (hashOtp(submittedCode) !== otp.code_hash) {
    await admin.from('enrollment_otps').update({ attempts: nextAttempts }).eq('id', otp.id);
    return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
  }

  // --- Code matches: enroll. verified_at is set only AFTER a successful
  // enrollment so a transient failure leaves the code usable for retry.

  // Create-or-link the center-less student by normalized phone.
  const { data: existing, error: lookupErr } = await admin
    .from('students')
    .select('id, parent_phone')
    .eq('phone', studentPhone)
    .is('center_id', null)
    .limit(1)
    .maybeSingle();
  if (lookupErr) return fail('student_lookup', lookupErr);

  let studentId: string;
  let createdNewStudent = false;
  if (existing) {
    const ex = existing as { id: string; parent_phone: string | null };
    studentId = ex.id;
    if (parentPhone && !ex.parent_phone) {
      const { error: backfillErr } = await admin
        .from('students')
        .update({ parent_phone: parentPhone })
        .eq('id', ex.id);
      if (backfillErr) {
        Sentry.withScope((scope) => {
          scope.setTag('route', ROUTE_TAG);
          scope.setTag('step', 'parent_phone_backfill');
          Sentry.captureMessage(`parent_phone backfill failed: ${backfillErr.message}`, 'warning');
        });
      }
    }
  } else {
    const { data: created, error: createErr } = await admin
      .from('students')
      .insert({
        name: studentName,
        phone: studentPhone,
        parent_phone: parentPhone,
        center_id: null,
        origin: 'self_link',
      })
      .select('id')
      .single();
    if (createErr) return fail('student_create', createErr);
    studentId = (created as { id: string }).id;
    createdNewStudent = true;
  }

  // Compensating cleanup approximates a rollback when the enrollment fails
  // after we created a brand-new student row.
  const rollbackStudent = async () => {
    if (createdNewStudent) {
      await admin.from('students').delete().eq('id', studentId);
    }
  };

  const { data: enrollData, error: enrollErr } = await admin.rpc('create_enrollment', {
    p_group_id: groupId,
    p_student_id: studentId,
    p_payer: payer,
    p_actor_id: g.teacher_id,
    p_source: 'self_link',
  });

  if (enrollErr) {
    const code = (enrollErr as { code?: string }).code;
    const msg = enrollErr.message ?? '';
    // Already enrolled (race vs send-otp's check): idempotent success.
    if (code === '23505' || msg.includes('already has a live enrollment')) {
      await admin.from('enrollment_otps').update({ verified_at: nowIso }).eq('id', otp.id);
      return NextResponse.json({
        enrolled: true,
        groupName: g.name,
        teacherDisplayName: await teacherName(admin, g.teacher_id),
        feePerClass: Number(g.fee_per_class) || 0,
      });
    }
    await rollbackStudent();
    if (msg.includes('at capacity')) {
      return NextResponse.json({ error: 'capacity_full' }, { status: 409 });
    }
    if (code === 'P0002') {
      return NextResponse.json({ error: 'group_not_found' }, { status: 404 });
    }
    return fail('create_enrollment', enrollErr);
  }

  const enrollRow = (Array.isArray(enrollData) ? enrollData[0] : enrollData) as
    | { enrollment_id: string; status: string }
    | undefined;
  if (!enrollRow?.enrollment_id) {
    await rollbackStudent();
    return fail('create_enrollment_shape', new Error('create_enrollment returned no row'));
  }

  // Mark the code consumed now that the enrollment is committed.
  await admin.from('enrollment_otps').update({ verified_at: nowIso }).eq('id', otp.id);

  // Auto-activate (best-effort): a verified self-enroll should not wait for the
  // teacher's manual approval. If this fails the enrollment stays pending and
  // the teacher's roster approval surface covers it.
  if (enrollRow.status === 'pending') {
    const { error: transErr } = await admin.rpc('apply_enrollment_transition', {
      p_enrollment_id: enrollRow.enrollment_id,
      p_new_status: 'active',
      p_actor_id: g.teacher_id,
    });
    if (transErr) {
      Sentry.withScope((scope) => {
        scope.setTag('route', ROUTE_TAG);
        scope.setTag('step', 'auto_activate');
        Sentry.captureMessage(
          `self-enroll auto-activate failed, stays pending: ${transErr.message}`,
          'warning',
        );
      });
    }
  }

  // Audit the self-enrollment (create_enrollment already logs 'enrollment_created';
  // this marks the public self-serve path explicitly). Best-effort.
  const { error: auditErr } = await admin.from('audit_log').insert({
    action: 'self_enrollment',
    entity_type: 'enrollment',
    entity_id: enrollRow.enrollment_id,
    user_id: g.teacher_id,
    center_id: null,
    details: { group_id: groupId, student_id: studentId, source: 'self_link' },
  });
  if (auditErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'audit_log');
      Sentry.captureMessage(`self-enroll audit insert failed: ${auditErr.message}`, 'warning');
    });
  }

  return NextResponse.json({
    enrolled: true,
    groupName: g.name,
    teacherDisplayName: await teacherName(admin, g.teacher_id),
    feePerClass: Number(g.fee_per_class) || 0,
  });
}

/** Best-effort teacher display name for the success screen. */
async function teacherName(
  admin: NonNullable<typeof supabaseAdmin>,
  teacherId: string | null,
): Promise<string | null> {
  if (!teacherId) return null;
  const { data } = await admin
    .from('teacher_profiles')
    .select('display_name')
    .eq('user_id', teacherId)
    .maybeSingle();
  return (data as { display_name?: string | null } | null)?.display_name ?? null;
}
