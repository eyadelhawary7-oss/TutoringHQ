import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import { requireOwnedSession, isUuid } from '@/lib/teacherPrivate';
import { requireTeacherUnderCap } from '@/lib/teacherCap';

const ROUTE_TAG = 'api/teacher/private/attendance';

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
 * POST: toggle a student's presence on a session. Present = an
 * attendance_scans row with billable=true (that is exactly what
 * finish_class_and_bill bills); absent = no row. attendance_scans has no
 * write guard (only lifecycle-recalc INSERT triggers, which short-circuit on
 * center-less students), so insert/delete are the sanctioned shape. The
 * UNIQUE(session_id, student_id) makes the present-toggle idempotent: a
 * duplicate insert (double-tap / stale tab) is treated as success.
 *
 * Guards: ownership chain first; a billed session's sheet is frozen (409
 * already_billed); the student must hold an ACTIVE enrollment in the
 * verified group (404 student_not_in_group otherwise).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string; sessionId: string }> },
) {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) {
    return auth.response;
  }
  const { groupId, sessionId } = await params;
  const owned = await requireOwnedSession(
    auth.supabaseAdmin,
    auth.userId,
    groupId,
    sessionId,
    ROUTE_TAG,
  );
  if (!owned.ok) {
    return owned.response;
  }
  if (owned.session.billed) {
    return NextResponse.json(
      { error: 'Conflict', code: 'already_billed' },
      { status: 409 },
    );
  }
  if (owned.session.status === 'cancelled') {
    return NextResponse.json(
      { error: 'Conflict', code: 'session_cancelled' },
      { status: 409 },
    );
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
  const { student_id: rawStudentId, present: rawPresent } = (body ?? {}) as {
    student_id?: unknown;
    present?: unknown;
  };
  const studentId = typeof rawStudentId === 'string' ? rawStudentId : '';
  if (!isUuid(studentId)) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_student_id' },
      { status: 400 },
    );
  }
  if (typeof rawPresent !== 'boolean') {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_present' },
      { status: 400 },
    );
  }

  // The student must be an ACTIVE member of the verified group. CORE read.
  const { data: enrRow, error: enrErr } = await auth.supabaseAdmin
    .from('enrollments')
    .select('id')
    .eq('group_id', groupId)
    .eq('student_id', studentId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (enrErr) {
    return serverError('enrollment_check', enrErr);
  }
  if (!enrRow) {
    return NextResponse.json(
      { error: 'Not found', code: 'student_not_in_group' },
      { status: 404 },
    );
  }

  // Over-cap lock: a Standard teacher past 60 students cannot toggle attendance.
  // Pro is never capped. After ownership + membership, before the scan write.
  const cap = await requireTeacherUnderCap(auth.supabaseAdmin, auth.userId, ROUTE_TAG);
  if (!cap.ok) {
    return cap.response;
  }

  if (rawPresent) {
    const { error: insertErr } = await auth.supabaseAdmin
      .from('attendance_scans')
      .insert({
        session_id: sessionId,
        student_id: studentId,
        group_id: groupId,
        center_id: null,
        billable: true,
        status: 'present',
        method: 'confirm',
        scanned_by: auth.userId,
      });
    if (insertErr) {
      const code = (insertErr as { code?: string }).code;
      // UNIQUE(session_id, student_id): already marked present - idempotent.
      if (code !== '23505') {
        return serverError('attendance_insert', insertErr);
      }
    }
  } else {
    const { error: deleteErr } = await auth.supabaseAdmin
      .from('attendance_scans')
      .delete()
      .eq('session_id', sessionId)
      .eq('student_id', studentId);
    if (deleteErr) {
      return serverError('attendance_delete', deleteErr);
    }
  }

  return NextResponse.json({ studentId, present: rawPresent });
}
