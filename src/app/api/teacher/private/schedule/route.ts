import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { toHHMM } from '@/lib/teacherSchedule';
import {
  cairoDateKey,
  cairoYmdMinusDays,
  cairoYmdPlusDays,
  startOfUtcInstantForCairoCalendarDay,
} from '@/lib/cairo/day';

const ROUTE_TAG = 'api/teacher/private/schedule';

type GroupRow = {
  id: string;
  name: string | null;
  fee_per_class: number | string | null;
};

type SlotRow = {
  id: string;
  group_id: string;
  day_of_week: number;
  time_start: string;
  duration_minutes: number;
};

type ExceptionRow = {
  id: string;
  group_id: string;
  schedule_id: string;
  exception_date: string;
  kind: string;
  new_date: string | null;
  new_time_start: string | null;
  new_duration_minutes: number | null;
  note: string | null;
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
 * GET: every group_schedule slot across the teacher's ACTIVE private groups,
 * plus schedule exceptions for the next 30 Cairo calendar days. Slot list and
 * exceptions are CORE reads (500 on error); the per-group enrolled counts are
 * display extras (best-effort: zeros + Sentry warning on error).
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { data: groupRows, error: groupsErr } = await auth.supabaseAdmin
    .from('student_groups')
    .select('id, name, fee_per_class')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'private')
    .eq('status', 'active');
  if (groupsErr) {
    return serverError('group_list', groupsErr);
  }
  const groups = (groupRows ?? []) as GroupRow[];
  if (groups.length === 0) {
    return NextResponse.json({ slots: [], exceptions: [], sessions: [] });
  }
  const groupIds = groups.map((g) => g.id);
  const groupById = new Map(groups.map((g) => [g.id, g]));

  const { data: slotRows, error: slotsErr } = await auth.supabaseAdmin
    .from('group_schedule')
    .select('id, group_id, day_of_week, time_start, duration_minutes')
    .in('group_id', groupIds);
  if (slotsErr) {
    return serverError('slot_list', slotsErr);
  }
  const slots = (slotRows ?? []) as SlotRow[];

  const todayKey = cairoDateKey();
  const horizonKey = cairoYmdPlusDays(todayKey, 30);
  const { data: exceptionRows, error: exceptionsErr } = await auth.supabaseAdmin
    .from('schedule_exceptions')
    .select(
      'id, group_id, schedule_id, exception_date, kind, new_date, new_time_start, new_duration_minutes, note',
    )
    .in('group_id', groupIds)
    .gte('exception_date', todayKey)
    .lte('exception_date', horizonKey);
  if (exceptionsErr) {
    return serverError('exception_list', exceptionsErr);
  }
  const exceptions = (exceptionRows ?? []) as ExceptionRow[];

  // Recorded sessions over the last 30 Cairo days: how the UI tells an
  // unrecorded past occurrence (actions) from a recorded one (detail link).
  const sessionsSince = startOfUtcInstantForCairoCalendarDay(
    cairoYmdMinusDays(todayKey, 30),
  );
  const { data: sessionRows, error: sessionsErr } = await auth.supabaseAdmin
    .from('sessions')
    .select('id, group_id, scheduled_at')
    .in('group_id', groupIds)
    .gte('scheduled_at', sessionsSince.toISOString());
  if (sessionsErr) {
    return serverError('session_list', sessionsErr);
  }
  const sessions = (sessionRows ?? []) as {
    id: string;
    group_id: string;
    scheduled_at: string;
  }[];

  const enrolledByGroup = new Map<string, number>();
  const { data: enrollmentRows, error: enrollErr } = await auth.supabaseAdmin
    .from('enrollments')
    .select('group_id')
    .in('group_id', groupIds)
    .eq('status', 'active');
  if (enrollErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'enrolled_counts');
      Sentry.captureMessage(
        `schedule enrolled-count lookup failed: ${enrollErr.message}`,
        'warning',
      );
    });
  } else {
    for (const r of (enrollmentRows ?? []) as { group_id: string }[]) {
      enrolledByGroup.set(r.group_id, (enrolledByGroup.get(r.group_id) ?? 0) + 1);
    }
  }

  return NextResponse.json({
    slots: slots.map((s) => ({
      schedule_id: s.id,
      group_id: s.group_id,
      group_name: groupById.get(s.group_id)?.name ?? null,
      fee_per_class: Number(groupById.get(s.group_id)?.fee_per_class) || 0,
      day_of_week: s.day_of_week,
      time_start: toHHMM(s.time_start),
      duration_minutes: s.duration_minutes,
      enrolled_count: enrolledByGroup.get(s.group_id) ?? 0,
    })),
    exceptions: exceptions.map((e) => ({
      id: e.id,
      group_id: e.group_id,
      schedule_id: e.schedule_id,
      exception_date: e.exception_date,
      kind: e.kind,
      new_date: e.new_date,
      new_time_start: e.new_time_start ? toHHMM(e.new_time_start) : null,
      new_duration_minutes: e.new_duration_minutes,
      note: e.note,
    })),
    sessions: sessions.map((s) => ({
      id: s.id,
      group_id: s.group_id,
      scheduled_date: cairoDateKey(new Date(s.scheduled_at)),
    })),
  });
}
