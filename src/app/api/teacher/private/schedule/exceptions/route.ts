import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { isUuid } from '@/lib/teacherPrivate';
import { isValidTimeHHMM } from '@/lib/teacherSchedule';
import {
  queueClassCancelledNotification,
  queueClassRescheduledNotification,
} from '@/lib/teacherScheduleNotifications';

const ROUTE_TAG = 'api/teacher/private/schedule/exceptions';

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
 * POST: create a one-time exception (cancel or reschedule a single
 * occurrence of a recurring slot). One exception per
 * (group, schedule, date) - a duplicate is 409 EXCEPTION_ALREADY_EXISTS.
 * Student notifications are Phase 4 stubs and always fail open.
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
    exception_date: rawDate,
    kind: rawKind,
    new_date: rawNewDate,
    new_time_start: rawNewTime,
    new_duration_minutes: rawNewDuration,
    note: rawNote,
  } = (body ?? {}) as {
    group_id?: unknown;
    schedule_id?: unknown;
    exception_date?: unknown;
    kind?: unknown;
    new_date?: unknown;
    new_time_start?: unknown;
    new_duration_minutes?: unknown;
    note?: unknown;
  };

  const groupId = typeof rawGroupId === 'string' ? rawGroupId : '';
  const scheduleId = typeof rawScheduleId === 'string' ? rawScheduleId : '';
  if (!isUuid(groupId) || !isUuid(scheduleId)) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_ids' },
      { status: 400 },
    );
  }
  const exceptionDate = typeof rawDate === 'string' ? rawDate : '';
  if (!DATE_RE.test(exceptionDate)) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_date' },
      { status: 400 },
    );
  }
  if (rawKind !== 'cancelled' && rawKind !== 'rescheduled') {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_kind' },
      { status: 400 },
    );
  }

  let newDate: string | null = null;
  let newTimeStart: string | null = null;
  let newDurationMinutes: number | null = null;
  if (rawKind === 'rescheduled') {
    if (typeof rawNewDate !== 'string' || !DATE_RE.test(rawNewDate)) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'new_date_required' },
        { status: 400 },
      );
    }
    newDate = rawNewDate;
    if (rawNewTime !== undefined && rawNewTime !== null && rawNewTime !== '') {
      if (typeof rawNewTime !== 'string' || !isValidTimeHHMM(rawNewTime)) {
        return NextResponse.json(
          { error: 'Invalid request', code: 'invalid_new_time' },
          { status: 400 },
        );
      }
      newTimeStart = rawNewTime;
    }
    if (rawNewDuration !== undefined && rawNewDuration !== null) {
      if (
        typeof rawNewDuration !== 'number' ||
        !Number.isInteger(rawNewDuration) ||
        rawNewDuration < 1 ||
        rawNewDuration > 480
      ) {
        return NextResponse.json(
          { error: 'Invalid request', code: 'invalid_new_duration' },
          { status: 400 },
        );
      }
      newDurationMinutes = rawNewDuration;
    }
  }
  const note =
    typeof rawNote === 'string' && rawNote.trim().length > 0
      ? rawNote.trim().slice(0, 500)
      : null;

  const { data: groupRow, error: groupErr } = await auth.supabaseAdmin
    .from('student_groups')
    .select('id, teacher_id, kind')
    .eq('id', groupId)
    .maybeSingle();
  if (groupErr) {
    return serverError('group_lookup', groupErr);
  }
  const group = groupRow as { id: string; teacher_id: string | null; kind: string | null } | null;
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

  const { data: slotRow, error: slotErr } = await auth.supabaseAdmin
    .from('group_schedule')
    .select('id, group_id')
    .eq('id', scheduleId)
    .eq('group_id', groupId)
    .maybeSingle();
  if (slotErr) {
    return serverError('slot_lookup', slotErr);
  }
  if (!slotRow) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'schedule_not_in_group' },
      { status: 400 },
    );
  }

  const { data: inserted, error: insertErr } = await auth.supabaseAdmin
    .from('schedule_exceptions')
    .insert({
      group_id: groupId,
      schedule_id: scheduleId,
      exception_date: exceptionDate,
      kind: rawKind,
      new_date: newDate,
      new_time_start: newTimeStart,
      new_duration_minutes: newDurationMinutes,
      note,
    })
    .select('id')
    .single();
  if (insertErr) {
    const pgCode = (insertErr as { code?: string }).code;
    if (pgCode === '23505') {
      return NextResponse.json({ error: 'EXCEPTION_ALREADY_EXISTS' }, { status: 409 });
    }
    return serverError('exception_insert', insertErr);
  }
  const exceptionId = (inserted as { id: string }).id;

  // Notifications are Phase 4 stubs; a failure never fails the exception.
  try {
    if (rawKind === 'cancelled') {
      await queueClassCancelledNotification(
        groupId,
        exceptionDate,
        auth.userId,
        auth.supabaseAdmin,
      );
    } else if (newDate) {
      await queueClassRescheduledNotification(
        groupId,
        exceptionDate,
        newDate,
        newTimeStart ?? '',
        auth.userId,
        auth.supabaseAdmin,
      );
    }
  } catch (notifyErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'exception_notification');
      Sentry.captureMessage(
        `schedule exception notification failed: ${(notifyErr as Error).message}`,
        'warning',
      );
    });
  }

  return NextResponse.json({ id: exceptionId }, { status: 201 });
}
