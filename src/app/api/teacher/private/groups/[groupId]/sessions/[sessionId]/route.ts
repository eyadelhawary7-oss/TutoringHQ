import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import { requireOwnedSession } from '@/lib/teacherPrivate';

const ROUTE_TAG = 'api/teacher/private/session-detail';

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
 * GET: the attendance-sheet payload - session header, the group's ACTIVE
 * roster, who is marked present, and (when billed) the charges. Roster and
 * present-set are CORE (the sheet is unusable without either); the charges
 * list on a billed session is also CORE since it IS the billed summary.
 */
export async function GET(
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

  const { data: enrollmentRows, error: enrollErr } = await auth.supabaseAdmin
    .from('enrollments')
    .select('id, student_id, payer')
    .eq('group_id', groupId)
    .eq('status', 'active');
  if (enrollErr) {
    return serverError('active_roster', enrollErr);
  }
  const enrollments = (enrollmentRows ?? []) as {
    id: string;
    student_id: string;
    payer: string | null;
  }[];

  const studentById = new Map<string, { name: string | null; phone: string | null }>();
  if (enrollments.length > 0) {
    const { data: studentRows, error: studentsErr } = await auth.supabaseAdmin
      .from('students')
      .select('id, name, phone')
      .in('id', enrollments.map((e) => e.student_id));
    if (studentsErr) {
      return serverError('roster_students', studentsErr);
    }
    for (const s of (studentRows ?? []) as { id: string; name: string | null; phone: string | null }[]) {
      studentById.set(s.id, { name: s.name, phone: s.phone });
    }
  }

  const { data: scanRows, error: scansErr } = await auth.supabaseAdmin
    .from('attendance_scans')
    .select('student_id')
    .eq('session_id', sessionId)
    .eq('billable', true);
  if (scansErr) {
    return serverError('present_set', scansErr);
  }
  const presentIds = new Set(
    ((scanRows ?? []) as { student_id: string }[]).map((r) => r.student_id),
  );

  let charges: { id: string; studentId: string; amount: number; status: string }[] = [];
  if (owned.session.billed) {
    const { data: txnRows, error: txnErr } = await auth.supabaseAdmin
      .from('transactions')
      .select('id, student_id, amount_billed, status')
      .eq('teacher_id', auth.userId)
      .eq('kind', 'lesson')
      .eq('session_id', sessionId);
    if (txnErr) {
      return serverError('session_charges', txnErr);
    }
    charges = ((txnRows ?? []) as { id: string; student_id: string; amount_billed: number | string | null; status: string }[]).map(
      (r) => ({
        id: r.id,
        studentId: r.student_id,
        amount: Number(r.amount_billed) || 0,
        status: r.status,
      }),
    );
  }

  return NextResponse.json({
    session: {
      id: owned.session.id,
      scheduled_at: owned.session.scheduled_at,
      status: owned.session.status,
      billed: owned.session.billed,
    },
    group: {
      id: owned.group.id,
      name: owned.group.name,
      fee_per_class: Number(owned.group.fee_per_class) || 0,
    },
    roster: enrollments.map((e) => ({
      studentId: e.student_id,
      name: studentById.get(e.student_id)?.name ?? null,
      payer: e.payer,
      present: presentIds.has(e.student_id),
    })),
    charges,
  });
}
