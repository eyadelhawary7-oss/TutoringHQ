import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';

const ROUTE_TAG = 'api/teacher/center-schedule';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

type CenterScheduleSlot = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  room_name: string | null;
};

/**
 * GET /api/teacher/center-schedule?center_id=<uuid>
 * Read-only (Ref 1): the center's existing weekly schedule so a teacher can SEE
 * what is already booked before proposing a class time. This is NOT an
 * open-availability system - it just surfaces the existing schedule_slots
 * (day/time + room name) the center timetable already holds. No writes.
 *
 * Scope (service-role bypasses RLS, so gate here): a teacher may read a center's
 * schedule only when they actually relate to it - an active member, a pending
 * teacher<->center link (incl. the by-code pending join), a pending join
 * request, or an open group proposal to it. Otherwise 403 (no existence oracle:
 * an unrelated center reads the same as a missing one). Roster/teacher details
 * are never returned - only day/time and room.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  const centerId = request.nextUrl.searchParams.get('center_id')?.trim() ?? '';
  if (!centerId) {
    return NextResponse.json({ error: 'Missing center', code: 'INVALID_INPUT' }, { status: 400 });
  }

  const admin = auth.supabaseAdmin;

  // Relationship gate. Active membership is the common case (cheapest check
  // first); otherwise look for any live relationship that legitimizes the read.
  let allowed = auth.centerIds.includes(centerId);
  if (!allowed) {
    const { count: linkCount, error: linkErr } = await admin
      .from('teacher_center')
      .select('teacher_id', { count: 'exact', head: true })
      .eq('teacher_id', auth.userId)
      .eq('center_id', centerId);
    if (linkErr) return fail('link_check', linkErr);
    allowed = (linkCount ?? 0) > 0;
  }
  if (!allowed) {
    const { count: reqCount, error: reqErr } = await admin
      .from('teacher_center_requests')
      .select('id', { count: 'exact', head: true })
      .eq('teacher_id', auth.userId)
      .eq('center_id', centerId)
      .eq('status', 'pending');
    if (reqErr) return fail('request_check', reqErr);
    allowed = (reqCount ?? 0) > 0;
  }
  if (!allowed) {
    const { count: propCount, error: propErr } = await admin
      .from('group_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('teacher_id', auth.userId)
      .eq('center_id', centerId)
      .eq('status', 'open');
    if (propErr) return fail('proposal_check', propErr);
    allowed = (propCount ?? 0) > 0;
  }
  if (!allowed) {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
  }

  const [slotsRes, roomsRes] = await Promise.all([
    admin
      .from('schedule_slots')
      .select('id, day_of_week, start_time, end_time, room_id')
      .eq('center_id', centerId),
    admin.from('rooms').select('id, name').eq('center_id', centerId),
  ]);
  if (slotsRes.error) return fail('slots_lookup', slotsRes.error);
  if (roomsRes.error) return fail('rooms_lookup', roomsRes.error);

  const roomName = new Map(
    ((roomsRes.data ?? []) as Array<{ id: string; name: string | null }>).map((r) => [r.id, r.name]),
  );

  const slots: CenterScheduleSlot[] = (
    (slotsRes.data ?? []) as Array<{
      id: string;
      day_of_week: string | number | null;
      start_time: string;
      end_time: string;
      room_id: string | null;
    }>
  ).map((s) => ({
    id: s.id,
    // schedule_slots.day_of_week is stored as text; normalize to a number.
    day_of_week: Number(s.day_of_week),
    start_time: s.start_time,
    end_time: s.end_time,
    room_name: s.room_id ? roomName.get(s.room_id) ?? null : null,
  }));

  return NextResponse.json({ slots });
}
