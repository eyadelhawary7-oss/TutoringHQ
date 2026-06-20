import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { isUuid } from '@/lib/teacherPrivate';
import { requireTeacherUnderCap } from '@/lib/teacherCap';
import { isProOrAbove } from '@/lib/teacherPlans';
import { normalizePhone } from '@/lib/utils/phone';

const ROUTE_TAG = 'api/teacher/private/schedule/sessions/[sessionId]/attendance';

const GUEST_LIMIT = 10;

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
 * PATCH: sync attendance on a LIVE session. The body carries the complete
 * current attendee list; the route diffs it against the existing scans and
 * applies the delta (insert new, delete removed). attendance_scans is NOT
 * lifecycle-guarded, so insert/delete are the sanctioned shape; the
 * UNIQUE(session_id, student_id) makes a duplicate insert idempotent.
 *
 * Only LIVE sessions accept edits (409 otherwise) - a finished session is
 * frozen. Ownership flows session -> group -> teacher_id. Enrolled attendees
 * must hold an ACTIVE enrollment; one-time guests are created here (Pro-only,
 * capped per session) and folded into the same scan delta.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) {
    return auth.response;
  }
  const { sessionId } = await params;
  if (!isUuid(sessionId)) {
    return NextResponse.json(
      { error: 'Not found', code: 'session_not_found' },
      { status: 404 },
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
  const { attendee_ids: rawAttendees, guests: rawGuests } = (body ?? {}) as {
    attendee_ids?: unknown;
    guests?: unknown;
  };
  if (
    !Array.isArray(rawAttendees) ||
    rawAttendees.some((a) => typeof a !== 'string' || !isUuid(a))
  ) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_attendees' },
      { status: 400 },
    );
  }
  const attendeeIds = Array.from(new Set(rawAttendees as string[]));

  type GuestInput = { name: string; phone: string };
  if (rawGuests !== undefined && !Array.isArray(rawGuests)) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_guests' },
      { status: 400 },
    );
  }
  const rawGuestList = (Array.isArray(rawGuests) ? rawGuests : []) as unknown[];

  // Session + ownership chain. sessions has no teacher_id, so ownership goes
  // session -> group -> teacher_id (403 on mismatch).
  const { data: sessionRow, error: sessionErr } = await auth.supabaseAdmin
    .from('sessions')
    .select('id, group_id, status')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionErr) {
    return serverError('session_lookup', sessionErr);
  }
  const session = sessionRow as
    | { id: string; group_id: string; status: string }
    | null;
  if (!session) {
    return NextResponse.json(
      { error: 'Not found', code: 'session_not_found' },
      { status: 404 },
    );
  }

  const { data: groupRow, error: groupErr } = await auth.supabaseAdmin
    .from('student_groups')
    .select('id, teacher_id, center_id, kind')
    .eq('id', session.group_id)
    .maybeSingle();
  if (groupErr) {
    return serverError('group_lookup', groupErr);
  }
  const group = groupRow as
    | { id: string; teacher_id: string | null; center_id: string | null; kind: string | null }
    | null;
  if (!group || group.teacher_id !== auth.userId || group.kind !== 'private') {
    return NextResponse.json(
      { error: 'Forbidden', code: 'not_your_session' },
      { status: 403 },
    );
  }

  if (session.status !== 'live') {
    return NextResponse.json(
      { error: 'Conflict', code: 'session_not_live' },
      { status: 409 },
    );
  }

  // Over-cap lock: a Standard teacher past 60 students cannot edit attendance.
  // Pro is never capped. After ownership + live check, before any scan write.
  const cap = await requireTeacherUnderCap(auth.supabaseAdmin, auth.userId, ROUTE_TAG);
  if (!cap.ok) {
    return cap.response;
  }

  // Current scans for this session.
  const { data: scanRows, error: scansErr } = await auth.supabaseAdmin
    .from('attendance_scans')
    .select('student_id')
    .eq('session_id', sessionId);
  if (scansErr) {
    return serverError('current_scans_lookup', scansErr);
  }
  const currentIds = new Set(
    ((scanRows ?? []) as { student_id: string }[]).map((r) => r.student_id),
  );
  const attendeeSet = new Set(attendeeIds);
  const toAdd = attendeeIds.filter((id) => !currentIds.has(id));
  const toRemove = Array.from(currentIds).filter((id) => !attendeeSet.has(id));

  // Enrolled gate: every freshly-added enrolled attendee must hold an ACTIVE
  // enrollment in the verified group. (Guests already in the session arrive as
  // existing scans, not as toAdd; brand-new guests come via `guests` below.)
  if (toAdd.length > 0) {
    const { data: enrollmentRows, error: enrollErr } = await auth.supabaseAdmin
      .from('enrollments')
      .select('student_id')
      .eq('group_id', session.group_id)
      .eq('status', 'active')
      .in('student_id', toAdd);
    if (enrollErr) {
      return serverError('enrollment_check', enrollErr);
    }
    const enrolledIds = new Set(
      ((enrollmentRows ?? []) as { student_id: string }[]).map((r) => r.student_id),
    );
    if (toAdd.some((id) => !enrolledIds.has(id))) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'invalid_attendees' },
        { status: 400 },
      );
    }
  }

  // One-time (guest) attendees: Pro-only, capped per session. Created here as
  // is_guest student rows with no enrollment, then scanned billable like any
  // other attendee. Their new ids come back so the client can fold them into
  // its tracked attendee list (subsequent syncs reference the uuid, not the
  // draft, so they are never re-created).
  const createdGuests: { name: string; phone: string; student_id: string }[] = [];
  if (rawGuestList.length > 0) {
    const { data: planRow, error: planErr } = await auth.supabaseAdmin
      .from('teacher_subscriptions')
      .select('plan_key')
      .eq('teacher_id', auth.userId)
      .maybeSingle();
    if (planErr) {
      return serverError('plan_lookup', planErr);
    }
    const planKey = (planRow as { plan_key?: string } | null)?.plan_key;
    if (!isProOrAbove(planKey)) {
      return NextResponse.json(
        { error: 'GUESTS_PRO_ONLY', upgrade_required: true },
        { status: 403 },
      );
    }

    // Cap counts existing guest scans + the new drafts.
    let existingGuestCount = 0;
    if (currentIds.size > 0) {
      const { data: guestScanRows, error: guestScanErr } = await auth.supabaseAdmin
        .from('students')
        .select('id')
        .eq('is_guest', true)
        .in('id', Array.from(currentIds));
      if (guestScanErr) {
        return serverError('existing_guest_count', guestScanErr);
      }
      existingGuestCount = (guestScanRows ?? []).length;
    }
    if (existingGuestCount + rawGuestList.length > GUEST_LIMIT) {
      return NextResponse.json(
        {
          error: 'GUEST_LIMIT_EXCEEDED',
          limit: GUEST_LIMIT,
          current: existingGuestCount + rawGuestList.length,
        },
        { status: 400 },
      );
    }

    const validated: GuestInput[] = [];
    for (let i = 0; i < rawGuestList.length; i++) {
      const g = rawGuestList[i];
      const rawName = (g as { name?: unknown })?.name;
      const rawPhoneVal = (g as { phone?: unknown })?.phone;
      const name = typeof rawName === 'string' ? rawName.trim() : '';
      if (name.length < 1 || name.length > 100) {
        return NextResponse.json({ error: 'INVALID_GUEST_NAME', index: i }, { status: 400 });
      }
      const phoneStr = typeof rawPhoneVal === 'string' ? rawPhoneVal.trim() : '';
      if (!/^01\d{9}$/.test(phoneStr)) {
        return NextResponse.json({ error: 'INVALID_GUEST_PHONE', index: i }, { status: 400 });
      }
      validated.push({ name, phone: normalizePhone(phoneStr) });
    }

    const { data: guestRows, error: guestErr } = await auth.supabaseAdmin
      .from('students')
      .insert(
        validated.map((g) => ({
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
    const guestIds = ((guestRows ?? []) as { id: string }[]).map((r) => r.id);
    for (let i = 0; i < guestIds.length; i++) {
      createdGuests.push({ ...validated[i], student_id: guestIds[i] });
    }
  }

  // Apply the delta. Inserts first (enrolled adds + new guests), then deletes.
  const insertIds = [...toAdd, ...createdGuests.map((g) => g.student_id)];
  if (insertIds.length > 0) {
    const { error: insertErr } = await auth.supabaseAdmin
      .from('attendance_scans')
      .insert(
        insertIds.map((studentId) => ({
          session_id: sessionId,
          student_id: studentId,
          group_id: session.group_id,
          center_id: group.center_id ?? null,
          billable: true,
          status: 'present',
          method: 'confirm',
          scanned_by: auth.userId,
        })),
      );
    if (insertErr) {
      const code = (insertErr as { code?: string }).code;
      if (code !== '23505') {
        return serverError('scans_insert', insertErr);
      }
    }
  }

  if (toRemove.length > 0) {
    const { error: deleteErr } = await auth.supabaseAdmin
      .from('attendance_scans')
      .delete()
      .eq('session_id', sessionId)
      .in('student_id', toRemove);
    if (deleteErr) {
      return serverError('scans_delete', deleteErr);
    }
  }

  return NextResponse.json({
    added: insertIds.length,
    removed: toRemove.length,
    total: attendeeIds.length + createdGuests.length,
    created_guests: createdGuests,
  });
}
