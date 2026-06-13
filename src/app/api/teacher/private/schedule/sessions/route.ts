import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { isUuid } from '@/lib/teacherPrivate';
import { normalizePhone, isValidEgyptianMobileE164 } from '@/lib/utils/phone';
import {
  cairoDateKey,
  cairoPaidAtDayUtcBounds,
  startOfUtcInstantForCairoCalendarDay,
} from '@/lib/cairo/day';

const ROUTE_TAG = 'api/teacher/private/schedule/sessions';

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
 * POST: record attendance and bill from a schedule slot, in one shot.
 *
 * Creates the session for the Cairo calendar day, inserts a billable
 * attendance scan per attendee, then runs finish_class_and_bill (idempotent
 * at the DB layer: per-session+student idempotency keys). Re-recording the
 * same slot day is a no-op: an existing session for (group, Cairo day)
 * returns 200 with already_exists=true and zero new charges.
 *
 * If billing fails AFTER the session + scans are committed, the work is not
 * lost - respond 207 with the session id and the billing error so the UI can
 * say "saved, billing failed" instead of silently double-creating later.
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
    attendee_ids: rawAttendees,
    guests: rawGuests,
  } = (body ?? {}) as {
    group_id?: unknown;
    schedule_id?: unknown;
    session_date?: unknown;
    attendee_ids?: unknown;
    guests?: unknown;
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
  const attendeeIds = Array.from(new Set((rawAttendees as string[] | undefined) ?? []));

  // One-time (guest) attendees: name + WhatsApp phone. They become is_guest
  // student rows with NO enrollment, billed at the group fee like any other
  // billable scan. Optional - the manual record sheet sends none.
  type GuestInput = { name: string; phone: string };
  const guests: GuestInput[] = [];
  if (rawGuests !== undefined) {
    if (!Array.isArray(rawGuests)) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'invalid_guests' },
        { status: 400 },
      );
    }
    for (const g of rawGuests) {
      const rawName = (g as { name?: unknown })?.name;
      const rawPhone = (g as { phone?: unknown })?.phone;
      const name = typeof rawName === 'string' ? rawName.trim() : '';
      const phone = normalizePhone(typeof rawPhone === 'string' ? rawPhone : '');
      if (name.length < 1 || name.length > 120 || !isValidEgyptianMobileE164(phone)) {
        return NextResponse.json(
          { error: 'Invalid request', code: 'invalid_guests' },
          { status: 400 },
        );
      }
      guests.push({ name, phone });
    }
  }

  if (attendeeIds.length + guests.length === 0) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_attendees' },
      { status: 400 },
    );
  }

  const todayKey = cairoDateKey();
  if (sessionDate > todayKey) {
    return NextResponse.json(
      { error: 'Unprocessable', code: 'FUTURE_DATE' },
      { status: 422 },
    );
  }

  // Ownership: the group must exist, be private, and belong to the caller.
  // Spec'd as an explicit 403 (not the roster routes' blind 404) because the
  // schedule page already proved the group exists to this teacher.
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

  // A cancelled occurrence cannot be recorded - the teacher must remove the
  // cancellation first (or it really was cancelled and there is nothing to bill).
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

  // Idempotence at the day level: one session per (group, Cairo calendar
  // day) through this surface. sessions.scheduled_at is timestamptz, so the
  // day check is the Cairo-day UTC window.
  const { start, endExclusive } = cairoPaidAtDayUtcBounds(sessionDate);
  const { data: existingRow, error: existingErr } = await auth.supabaseAdmin
    .from('sessions')
    .select('id')
    .eq('group_id', groupId)
    .gte('scheduled_at', start.toISOString())
    .lt('scheduled_at', endExclusive.toISOString())
    .limit(1)
    .maybeSingle();
  if (existingErr) {
    return serverError('existing_session_check', existingErr);
  }
  if (existingRow) {
    return NextResponse.json({
      session_id: (existingRow as { id: string }).id,
      charges_created: 0,
      already_exists: true,
    });
  }

  // Every enrolled attendee must hold an ACTIVE enrollment in the verified
  // group - otherwise a stray UUID would mint a billable scan (and a charge)
  // for a student who was never in this group. Guests skip this check by
  // design (they have no enrollment).
  if (attendeeIds.length > 0) {
    const { data: enrollmentRows, error: enrollErr } = await auth.supabaseAdmin
      .from('enrollments')
      .select('student_id')
      .eq('group_id', groupId)
      .eq('status', 'active')
      .in('student_id', attendeeIds);
    if (enrollErr) {
      return serverError('enrollment_check', enrollErr);
    }
    const enrolledIds = new Set(
      ((enrollmentRows ?? []) as { student_id: string }[]).map((r) => r.student_id),
    );
    if (attendeeIds.some((id) => !enrolledIds.has(id))) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'invalid_attendees' },
        { status: 400 },
      );
    }
  }

  // sessions has no teacher_id/center_id columns and its schedule_id FK
  // points at the legacy schedule_slots table (NOT group_schedule), so the
  // slot link stays out of the row; ownership flows through the group.
  // Status starts at the default and finish_class_and_bill performs the
  // sanctioned scheduled -> finished transition.
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
  const sessionId = (insertedSession as { id: string }).id;

  // Create the guest student rows now that the session is committed (so a
  // failed session insert never leaves orphan guests). is_guest=true,
  // center-less, all notifications off, unverified - they exist only to carry
  // attendance + a one-time charge. No enrollment row.
  const guestIds: string[] = [];
  if (guests.length > 0) {
    const { data: guestRows, error: guestErr } = await auth.supabaseAdmin
      .from('students')
      .insert(
        guests.map((g) => ({
          name: g.name,
          phone: g.phone,
          center_id: null,
          is_guest: true,
          origin: 'walk_in',
          phone_verified: false,
          parent_phone_verified: false,
          notify_on_scan: false,
          notify_on_absence: false,
          notify_on_balance: false,
        })),
      )
      .select('id');
    if (guestErr) {
      return serverError('guest_insert', guestErr);
    }
    for (const r of (guestRows ?? []) as { id: string }[]) {
      guestIds.push(r.id);
    }
  }

  const scanStudentIds = [...attendeeIds, ...guestIds];

  // Same scan shape as the manual attendance toggle route - billable=true is
  // exactly what finish_class_and_bill bills.
  const { error: scansErr } = await auth.supabaseAdmin
    .from('attendance_scans')
    .insert(
      scanStudentIds.map((studentId) => ({
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
    return serverError('scans_insert', scansErr);
  }

  const { data: finishData, error: finishErr } = await auth.supabaseAdmin.rpc(
    'finish_class_and_bill',
    { p_session_id: sessionId, p_actor_id: auth.userId },
  );
  if (finishErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'finish_class_and_bill');
      Sentry.captureException(finishErr);
    });
    return NextResponse.json(
      {
        session_id: sessionId,
        charges_created: 0,
        billing_error: finishErr.message,
      },
      { status: 207 },
    );
  }

  const result = (Array.isArray(finishData) ? finishData[0] : finishData) as
    | { session_id: string; billed_now: boolean; charges_created: number }
    | undefined;

  return NextResponse.json({
    session_id: sessionId,
    charges_created: result?.charges_created ?? 0,
    already_exists: false,
  });
}
