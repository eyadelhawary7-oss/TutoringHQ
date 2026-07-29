import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import { requireOwnedPrivateGroup } from '@/lib/teacherPrivate';
import { countActiveNonGuestStudents, studentCapForPlan } from '@/lib/teacherCap';
import { teacherHasHardCap } from '@/lib/teacherPlans';
import { normalizePhone, isValidEgyptianMobileE164 } from '@/lib/utils/phone';

const ROUTE_TAG = 'api/teacher/private/roster';

type EnrollmentRow = {
  id: string;
  student_id: string;
  status: string;
  payer: string | null;
  joined_at: string | null;
  created_at: string;
  source: string | null;
};

type StudentRow = {
  id: string;
  name: string | null;
  phone: string | null;
  parent_phone: string | null;
  grade_level: string | null;
};

function serverError(step: string, err: { message: string }): NextResponse {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json(
    { error: 'Server error', code: 'server_error' },
    { status: 500 },
  );
}

/**
 * GET: the group's roster (live enrollments + student display info). Gated
 * by requireTeacherPrivateAccess (a private group implies a subscription row
 * exists - no chicken-and-egg here), then the ownership guard. Both the
 * enrollment list and the student-name lookup are CORE: a roster without
 * names is useless, so errors are 500, never a silently empty page.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) {
    return auth.response;
  }
  const { groupId } = await params;
  const owned = await requireOwnedPrivateGroup(auth.supabaseAdmin, auth.userId, groupId, ROUTE_TAG);
  if (!owned.ok) {
    return owned.response;
  }

  const { data: enrollmentRows, error: enrollErr } = await auth.supabaseAdmin
    .from('enrollments')
    .select('id, student_id, status, payer, joined_at, created_at, source')
    .eq('group_id', groupId)
    .in('status', ['pending', 'active']);
  if (enrollErr) {
    return serverError('roster_list', enrollErr);
  }
  const enrollments = (enrollmentRows ?? []) as EnrollmentRow[];

  const studentById = new Map<string, StudentRow>();
  if (enrollments.length > 0) {
    const { data: studentRows, error: studentsErr } = await auth.supabaseAdmin
      .from('students')
      .select('id, name, phone, parent_phone, grade_level')
      .in('id', enrollments.map((e) => e.student_id));
    if (studentsErr) {
      return serverError('roster_students', studentsErr);
    }
    for (const s of (studentRows ?? []) as StudentRow[]) {
      studentById.set(s.id, s);
    }
  }

  // Per-student outstanding: sum of still-pending lesson charges for this
  // group. A names-only roster is the core contract, so a balance lookup
  // failure degrades to zero (logged) rather than 500-ing the whole roster.
  const outstandingByStudent = new Map<string, number>();
  if (enrollments.length > 0) {
    const { data: txnRows, error: txnErr } = await auth.supabaseAdmin
      .from('transactions')
      .select('student_id, amount_billed')
      .eq('group_id', groupId)
      .eq('kind', 'lesson')
      .eq('status', 'pending');
    if (txnErr) {
      Sentry.withScope((scope) => {
        scope.setTag('route', ROUTE_TAG);
        scope.setTag('step', 'roster_outstanding');
        Sentry.captureMessage(`roster outstanding lookup failed: ${txnErr.message}`, 'warning');
      });
    } else {
      for (const tx of (txnRows ?? []) as {
        student_id: string;
        amount_billed: number | string | null;
      }[]) {
        outstandingByStudent.set(
          tx.student_id,
          (outstandingByStudent.get(tx.student_id) ?? 0) + (Number(tx.amount_billed) || 0),
        );
      }
    }
  }

  // Pending first (they need action), then active, newest first within each.
  const rank = (s: string) => (s === 'pending' ? 0 : 1);
  const roster = enrollments
    .sort((a, b) => rank(a.status) - rank(b.status) || (a.created_at < b.created_at ? 1 : -1))
    .map((e) => ({
      enrollmentId: e.id,
      status: e.status,
      payer: e.payer,
      joinedAt: e.joined_at,
      createdAt: e.created_at,
      source: e.source,
      outstanding: outstandingByStudent.get(e.student_id) ?? 0,
      student: {
        id: e.student_id,
        name: studentById.get(e.student_id)?.name ?? null,
        phone: studentById.get(e.student_id)?.phone ?? null,
        parentPhone: studentById.get(e.student_id)?.parent_phone ?? null,
        gradeLevel: studentById.get(e.student_id)?.grade_level ?? null,
      },
    }));

  return NextResponse.json({
    group: {
      id: owned.group.id,
      name: owned.group.name,
      fee_per_class: Number(owned.group.fee_per_class) || 0,
      approval_mode: owned.group.approval_mode,
      status: owned.group.status,
    },
    roster,
  });
}

/**
 * POST: teacher adds a student to their own group. Create-or-link the
 * student (private students are center-less: center_id NULL, matched by
 * normalized phone among center-less rows), then create_enrollment with
 * source='walk_in' and the body's payer. Under approval_mode='manual' the
 * RPC lands the enrollment 'pending'; a teacher-initiated add should not
 * wait for the same teacher's approval, so the route immediately applies the
 * pending -> active transition via apply_enrollment_transition (best-effort:
 * if that second call fails the enrollment stays pending + Sentry warning,
 * and the approval surface covers it).
 *
 * Business failures from create_enrollment map to clean 4xx codes:
 *   23505 / "already has a live enrollment" -> 409 duplicate_enrollment
 *   23514 + "at capacity"                   -> 409 capacity_full
 *   P0002 (group/student vanished mid-call) -> 404 not_found
 *   anything else                           -> 500 + Sentry
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) {
    return auth.response;
  }
  const { groupId } = await params;
  const owned = await requireOwnedPrivateGroup(auth.supabaseAdmin, auth.userId, groupId, ROUTE_TAG);
  if (!owned.ok) {
    return owned.response;
  }

  // Tiered cap: the hard-capped tiers (Standard -> 20, Pro -> 50) limit active
  // enrolled students across all of this teacher's active private groups; Scale
  // (and any pro-or-above tier) is not hard-blocked here. Counting is the shared
  // canonical definition (distinct non-guest active enrollments) so the add gate
  // and the over-cap lock can never disagree about who is over the line.
  const { data: subRow, error: subErr } = await auth.supabaseAdmin
    .from('teacher_subscriptions')
    .select('plan_key')
    .eq('teacher_id', auth.userId)
    .maybeSingle();
  if (subErr) {
    return serverError('subscription_plan', subErr);
  }
  const planKey = (subRow as { plan_key?: string } | null)?.plan_key;
  if (teacherHasHardCap(planKey)) {
    const cap = studentCapForPlan(planKey);
    let distinctStudents: number;
    try {
      distinctStudents = await countActiveNonGuestStudents(auth.supabaseAdmin, auth.userId);
    } catch (countErr) {
      return serverError('student_cap_count', countErr as { message: string });
    }
    // Already past the line (cap+1, e.g. legacy data or the now-closed self-enroll
    // loophole): the over-cap LOCK applies - block with the same code every
    // other action uses, telling them to shed students first.
    if (distinctStudents > cap) {
      return NextResponse.json(
        {
          error: 'Over student cap',
          code: 'OVER_CAP_LOCKED',
          limit: cap,
          current: distinctStudents,
        },
        { status: 403 },
      );
    }
    // Exactly at the line (cap): adding the next student is refused at the boundary.
    if (distinctStudents >= cap) {
      return NextResponse.json(
        {
          error: 'STUDENT_LIMIT_REACHED',
          limit: cap,
          current: distinctStudents,
          upgrade_required: true,
        },
        { status: 429 },
      );
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_body' },
      { status: 400 },
    );
  }
  const {
    name: rawName,
    phone: rawPhone,
    payer: rawPayer,
    parent_phone: rawParentPhone,
  } = (body ?? {}) as { name?: unknown; phone?: unknown; payer?: unknown; parent_phone?: unknown };

  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (name.length < 1 || name.length > 120) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_name' },
      { status: 400 },
    );
  }
  const payer = rawPayer === 'parent' ? 'parent' : rawPayer === 'student' ? 'student' : null;
  if (!payer) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_payer' },
      { status: 400 },
    );
  }
  const phone = normalizePhone(typeof rawPhone === 'string' ? rawPhone : '');
  if (!isValidEgyptianMobileE164(phone)) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_phone' },
      { status: 400 },
    );
  }
  // The payer's phone is where the bill goes later - when the parent pays,
  // the parent phone is required and validated like the student's.
  let parentPhone: string | null = null;
  if (payer === 'parent') {
    parentPhone = normalizePhone(typeof rawParentPhone === 'string' ? rawParentPhone : '');
    if (!isValidEgyptianMobileE164(parentPhone)) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'invalid_parent_phone' },
        { status: 400 },
      );
    }
  }

  // Create-or-link: private students are global people rows with center_id
  // NULL; match by normalized phone so the same student joining two private
  // groups (even across teachers) stays one row, as ar_by_student expects.
  const { data: existing, error: lookupErr } = await auth.supabaseAdmin
    .from('students')
    .select('id, name, parent_phone')
    .eq('phone', phone)
    .is('center_id', null)
    .limit(1)
    .maybeSingle();
  if (lookupErr) {
    return serverError('student_lookup', lookupErr);
  }

  let studentId: string;
  let studentName: string;
  if (existing) {
    const ex = existing as { id: string; name: string | null; parent_phone: string | null };
    studentId = ex.id;
    studentName = ex.name ?? name;
    // Billing needs the parent phone when the parent pays; fill it on the
    // shared row only when missing (best-effort - never block the add).
    if (parentPhone && !ex.parent_phone) {
      const { error: parentErr } = await auth.supabaseAdmin
        .from('students')
        .update({ parent_phone: parentPhone })
        .eq('id', ex.id);
      if (parentErr) {
        Sentry.withScope((scope) => {
          scope.setTag('route', ROUTE_TAG);
          scope.setTag('step', 'parent_phone_backfill');
          Sentry.captureMessage(
            `parent_phone backfill failed: ${parentErr.message}`,
            'warning',
          );
        });
      }
    }
  } else {
    const { data: created, error: createErr } = await auth.supabaseAdmin
      .from('students')
      .insert({
        name,
        phone,
        parent_phone: parentPhone,
        center_id: null,
        origin: 'walk_in',
      })
      .select('id, name')
      .single();
    if (createErr) {
      return serverError('student_create', createErr);
    }
    const cr = created as { id: string; name: string | null };
    studentId = cr.id;
    studentName = cr.name ?? name;
  }

  const { data: enrollData, error: enrollErr } = await auth.supabaseAdmin.rpc(
    'create_enrollment',
    {
      p_group_id: groupId,
      p_student_id: studentId,
      p_payer: payer,
      p_actor_id: auth.userId,
      p_source: 'walk_in',
    },
  );
  if (enrollErr) {
    const code = (enrollErr as { code?: string }).code;
    const msg = enrollErr.message ?? '';
    if (code === '23505' || msg.includes('already has a live enrollment')) {
      return NextResponse.json(
        { error: 'Conflict', code: 'duplicate_enrollment' },
        { status: 409 },
      );
    }
    if (msg.includes('at capacity')) {
      return NextResponse.json(
        { error: 'Conflict', code: 'capacity_full' },
        { status: 409 },
      );
    }
    if (code === 'P0002') {
      return NextResponse.json(
        { error: 'Not found', code: 'not_found' },
        { status: 404 },
      );
    }
    return serverError('create_enrollment', enrollErr);
  }

  const enrollRow = (Array.isArray(enrollData) ? enrollData[0] : enrollData) as
    | { enrollment_id: string; status: string }
    | undefined;
  if (!enrollRow?.enrollment_id) {
    return serverError('create_enrollment_shape', {
      message: 'create_enrollment returned no row',
    });
  }

  let finalStatus = enrollRow.status;
  if (finalStatus === 'pending') {
    const { data: transData, error: transErr } = await auth.supabaseAdmin.rpc(
      'apply_enrollment_transition',
      {
        p_enrollment_id: enrollRow.enrollment_id,
        p_new_status: 'active',
        p_actor_id: auth.userId,
      },
    );
    if (transErr) {
      Sentry.withScope((scope) => {
        scope.setTag('route', ROUTE_TAG);
        scope.setTag('step', 'auto_activate');
        Sentry.captureMessage(
          `teacher-add auto-activate failed, enrollment stays pending: ${transErr.message}`,
          'warning',
        );
      });
    } else {
      const t = (Array.isArray(transData) ? transData[0] : transData) as
        | { status?: string }
        | null;
      finalStatus = t?.status ?? finalStatus;
    }
  }

  return NextResponse.json(
    {
      enrollment: {
        id: enrollRow.enrollment_id,
        status: finalStatus,
        payer,
        student: { id: studentId, name: studentName, phone },
      },
    },
    { status: 201 },
  );
}
