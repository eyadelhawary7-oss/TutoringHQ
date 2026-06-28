import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import { requireOwnedPrivateGroup } from '@/lib/teacherPrivate';
import { toHHMM } from '@/lib/teacherSchedule';
import { cairoDateKey } from '@/lib/cairo/day';

const ROUTE_TAG = 'api/teacher/private/groups/[groupId]/schedule';

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
 * GET: one group's recurring slots plus its exceptions from today (Cairo)
 * forward. Same shape as GET /api/teacher/private/schedule but scoped to the
 * verified group, so the edit form can pre-populate without over-fetching.
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

  const { data: slotRows, error: slotsErr } = await auth.supabaseAdmin
    .from('group_schedule')
    .select('id, group_id, day_of_week, time_start, duration_minutes')
    .eq('group_id', groupId);
  if (slotsErr) {
    return serverError('slot_list', slotsErr);
  }
  const slots = (slotRows ?? []) as SlotRow[];

  const todayKey = cairoDateKey();
  const { data: exceptionRows, error: exceptionsErr } = await auth.supabaseAdmin
    .from('schedule_exceptions')
    .select(
      'id, group_id, schedule_id, exception_date, kind, new_date, new_time_start, new_duration_minutes, note',
    )
    .eq('group_id', groupId)
    .gte('exception_date', todayKey);
  if (exceptionsErr) {
    return serverError('exception_list', exceptionsErr);
  }
  const exceptions = (exceptionRows ?? []) as ExceptionRow[];

  const enrolledCount = await (async () => {
    const { data: enrollmentRows, error: enrollErr } = await auth.supabaseAdmin
      .from('enrollments')
      .select('id')
      .eq('group_id', groupId)
      .eq('status', 'active');
    if (enrollErr) {
      Sentry.withScope((scope) => {
        scope.setTag('route', ROUTE_TAG);
        scope.setTag('step', 'enrolled_count');
        Sentry.captureMessage(
          `group schedule enrolled-count lookup failed: ${enrollErr.message}`,
          'warning',
        );
      });
      return 0;
    }
    return (enrollmentRows ?? []).length;
  })();

  return NextResponse.json({
    slots: slots.map((s) => ({
      schedule_id: s.id,
      group_id: s.group_id,
      group_name: owned.group.name,
      fee_per_class: Number(owned.group.fee_per_class) || 0,
      day_of_week: s.day_of_week,
      time_start: toHHMM(s.time_start),
      duration_minutes: s.duration_minutes,
      enrolled_count: enrolledCount,
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
  });
}
