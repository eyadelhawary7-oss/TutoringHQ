import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { isUuid } from '@/lib/teacherPrivate';
import { requireTeacherUnderCap } from '@/lib/teacherCap';
import {
  cairoDateKey,
  cairoPaidAtDayUtcBounds,
  startOfUtcInstantForCairoCalendarDay,
} from '@/lib/cairo/day';

const ROUTE_TAG = 'api/teacher/private/schedule/sessions/start';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
 * POST: start a class - create (or resume) a session in the LIVE state, without
 * billing. This is the first leg of the live-session flow (start -> sync
 * attendance -> finish). Unlike the one-shot record+bill surface, nothing is
 * charged here; finish_class_and_bill runs only from the /finish route.
 *
 * Session status changes go exclusively through apply_session_transition (the
 * sessions table is lifecycle-guarded). A new session is born 'scheduled' and
 * transitioned to 'live'; an existing 'scheduled' session is transitioned in
 * place. An already-live session is resumed idempotently (already_started); an
 * already-finished one is a hard 409 so a stale tab can never re-open billing.
 */
export async function POST(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) {
    return auth.response;
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
    group_id: rawGroupId,
    schedule_id: rawScheduleId,
    session_date: rawDate,
    initial_attendees: rawAttendees,
  } = (body ?? {}) as {
    group_id?: unknown;
    schedule_id?: unknown;
    session_date?: unknown;
    initial_attendees?: unknown;
  };

  const groupId = typeof rawGroupId === 'string' ? rawGroupId : '';
  const scheduleId = typeof rawScheduleId === 'string' ? rawScheduleId : '';
  if (!isUuid(groupId) || !isUuid(scheduleId)) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_ids' },
      { status: 400 },
    );
  }
  const sessionDate = typeof rawDate === 'string' ? rawDate : '';
  if (!DATE_RE.test(sessionDate)) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_date' },
      { status: 400 },
    );
  }
  if (
    rawAttendees !== undefined &&
    (!Array.isArray(rawAttendees) ||
      rawAttendees.some((a) => typeof a !== 'string' || !isUuid(a)))
  ) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_attendees' },
      { status: 400 },
    );
  }
  const initialAttendees = Array.from(
    new Set((rawAttendees as string[] | undefined) ?? []),
  );

  const todayKey = cairoDateKey();
  if (sessionDate > todayKey) {
    return NextResponse.json(
      { error: 'Unprocessable', code: 'FUTURE_DATE' },
      { status: 422 },
    );
  }

  // Ownership: the group must exist, be private, and belong to the caller.
  const { data: groupRow, error: groupErr } = await auth.supabaseAdmin
    .from('student_groups')
    .select('id, name, teacher_id, center_id, kind, status')
    .eq('id', groupId)
    .maybeSingle();
  if (groupErr) {
    return serverError('group_lookup', groupErr);
  }
  const group = groupRow as
    | { id: string; teacher_id: string | null; center_id: string | null; kind: string | null }
    | null;
  if (!group) {
    return NextResponse.json(
      { error: 'Not found', code: 'group_not_found' },
      { status: 404 },
    );
  }
  if (group.teacher_id !== auth.userId || group.kind !== 'private') {
    return NextResponse.json(
      { error: 'Forbidden', code: 'not_your_group' },
      { status: 403 },
    );
  }

  // A cancelled occurrence cannot be started - the teacher must clear the
  // cancellation exception first.
  const { data: cancelledRow, error: cancelledErr } = await auth.supabaseAdmin
    .from('schedule_exceptions')
    .select('id')
    .eq('group_id', groupId)
    .eq('schedule_id', scheduleId)
    .eq('exception_date', sessionDate)
    .eq('kind', 'cancelled')
    .limit(1)
    .maybeSingle();
  if (cancelledErr) {
    return serverError('cancelled_check', cancelledErr);
  }
  if (cancelledRow) {
    return NextResponse.json({ error: 'CLASS_CANCELLED' }, { status: 409 });
  }

  // One session per (group, Cairo calendar day) on this surface. Pull every
  // session in the day window so a stray cancelled row can never shadow a real
  // live/finished one (maybeSingle would error on >1 row).
  const { start, endExclusive } = cairoPaidAtDayUtcBounds(sessionDate);
  const { data: existingRows, error: existingErr } = await auth.supabaseAdmin
    .from('sessions')
    .select('id, status')
    .eq('group_id', groupId)
    .gte('scheduled_at', start.toISOString())
    .lt('scheduled_at', endExclusive.toISOString());
  if (existingErr) {
    return serverError('existing_session_check', existingErr);
  }
  const existing = (existingRows ?? []) as { id: string; status: string }[];
  const liveExisting = existing.find((s) => s.status === 'live');
  const finishedExisting = existing.find((s) => s.status === 'finished');
  const scheduledExisting = existing.find((s) => s.status === 'scheduled');

  if (finishedExisting) {
    return NextResponse.json(
      { error: 'SESSION_ALREADY_FINISHED' },
      { status: 409 },
    );
  }

  if (liveExisting) {
    // Resume: hand back the live session and its current attendees so the
    // sheet can open straight into the live phase.
    const { data: scanRows, error: scansErr } = await auth.supabaseAdmin
      .from('attendance_scans')
      .select('student_id')
      .eq('session_id', liveExisting.id);
    if (scansErr) {
      return serverError('resume_scans_lookup', scansErr);
    }
    return NextResponse.json({
      session_id: liveExisting.id,
      status: 'live',
      already_started: true,
      attendees: ((scanRows ?? []) as { student_id: string }[]).map((r) => r.student_id),
    });
  }

  // Over-cap lock: a Standard teacher past 60 students cannot open a class.
  // Pro is never capped. Resume of an existing live session returns above, so
  // this only gates creating/transitioning into a new live session.
  const cap = await requireTeacherUnderCap(auth.supabaseAdmin, auth.userId, ROUTE_TAG);
  if (!cap.ok) {
    return cap.response;
  }

  // Either transition the existing scheduled session, or create a fresh one.
  let sessionId: string;
  if (scheduledExisting) {
    sessionId = scheduledExisting.id;
  } else {
    const scheduledAt =
      sessionDate === todayKey
        ? new Date().toISOString()
        : startOfUtcInstantForCairoCalendarDay(sessionDate).toISOString();
    const { data: insertedSession, error: sessionErr } = await auth.supabaseAdmin
      .from('sessions')
      .insert({
        group_id: groupId,
        kind: 'private',
        scheduled_at: scheduledAt,
        created_by: auth.userId,
      })
      .select('id')
      .single();
    if (sessionErr) {
      return serverError('session_insert', sessionErr);
    }
    sessionId = (insertedSession as { id: string }).id;
  }

  const { error: transitionErr } = await auth.supabaseAdmin.rpc(
    'apply_session_transition',
    { p_session_id: sessionId, p_new_status: 'live', p_actor_id: auth.userId },
  );
  if (transitionErr) {
    return serverError('apply_session_transition', transitionErr);
  }

  // Optional initial attendees: each must hold an ACTIVE enrollment in the
  // verified group, else a stray UUID would mint a billable scan. Scans are
  // billable=true (what finish_class_and_bill bills). UNIQUE(session_id,
  // student_id) makes re-adds idempotent.
  if (initialAttendees.length > 0) {
    const { data: enrollmentRows, error: enrollErr } = await auth.supabaseAdmin
      .from('enrollments')
      .select('student_id')
      .eq('group_id', groupId)
      .eq('status', 'active')
      .in('student_id', initialAttendees);
    if (enrollErr) {
      return serverError('enrollment_check', enrollErr);
    }
    const enrolledIds = new Set(
      ((enrollmentRows ?? []) as { student_id: string }[]).map((r) => r.student_id),
    );
    if (initialAttendees.some((id) => !enrolledIds.has(id))) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'invalid_attendees' },
        { status: 400 },
      );
    }
    const { error: scansErr } = await auth.supabaseAdmin
      .from('attendance_scans')
      .insert(
        initialAttendees.map((studentId) => ({
          session_id: sessionId,
          student_id: studentId,
          group_id: groupId,
          center_id: group.center_id ?? null,
          billable: true,
          status: 'present',
          method: 'confirm',
          scanned_by: auth.userId,
        })),
      );
    if (scansErr) {
      const code = (scansErr as { code?: string }).code;
      if (code !== '23505') {
        return serverError('scans_insert', scansErr);
      }
    }
  }

  return NextResponse.json({
    session_id: sessionId,
    status: 'live',
    already_started: false,
    attendees: initialAttendees,
  });
}
