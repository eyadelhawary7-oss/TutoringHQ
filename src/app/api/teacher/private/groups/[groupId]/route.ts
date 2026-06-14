import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import { requireOwnedPrivateGroup } from '@/lib/teacherPrivate';
import { requireTeacherUnderCap } from '@/lib/teacherCap';
import { validateCSRFRequest } from '@/lib/csrf';
import { parseScheduleSlots, type ScheduleSlotInput } from '@/lib/teacherSchedule';
import { queueScheduleChangedNotification } from '@/lib/teacherScheduleNotifications';

const ROUTE_TAG = 'api/teacher/private/groups/[groupId]';

function serverError(step: string, err: { message: string }): NextResponse {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * PATCH: edit the teacher's own private group (name and/or fee_per_class)
 * or archive/unarchive it (status: 'active' | 'archived' - the only two
 * values student_groups_status_chk allows). A fee change applies to future
 * finish_class_and_bill runs only; existing transactions snapshot the old
 * fee and are untouched. Ownership via requireOwnedPrivateGroup (foreign or
 * unknown ids are 404). kind/teacher_id are never writable.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  const { groupId } = await params;
  const owned = await requireOwnedPrivateGroup(auth.supabaseAdmin, auth.userId, groupId, ROUTE_TAG);
  if (!owned.ok) return owned.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request', code: 'invalid_body' }, { status: 400 });
  }
  const {
    name: rawName,
    fee_per_class: rawFee,
    status: rawStatus,
    schedule: rawSchedule,
  } = (body ?? {}) as {
    name?: unknown;
    fee_per_class?: unknown;
    status?: unknown;
    schedule?: unknown;
  };

  const updates: Record<string, unknown> = {};

  let scheduleSlots: ScheduleSlotInput[] | null = null;
  if (rawSchedule !== undefined && rawSchedule !== null) {
    const parsed = parseScheduleSlots(rawSchedule);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'invalid_schedule' },
        { status: 400 },
      );
    }
    scheduleSlots = parsed.slots;
  }

  if (rawName !== undefined) {
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (name.length < 1 || name.length > 120) {
      return NextResponse.json({ error: 'Invalid request', code: 'invalid_name' }, { status: 400 });
    }
    updates.name = name;
  }

  if (rawFee !== undefined) {
    const fee = typeof rawFee === 'number' ? rawFee : NaN;
    const isTwoDecimalsMax = Math.abs(fee * 100 - Math.round(fee * 100)) < 1e-6;
    if (!Number.isFinite(fee) || fee <= 0 || fee > 1_000_000 || !isTwoDecimalsMax) {
      return NextResponse.json({ error: 'Invalid request', code: 'invalid_fee' }, { status: 400 });
    }
    updates.fee_per_class = Math.round(fee * 100) / 100;
  }

  if (rawStatus !== undefined) {
    if (rawStatus !== 'active' && rawStatus !== 'archived') {
      return NextResponse.json(
        { error: 'Invalid request', code: 'invalid_status' },
        { status: 400 },
      );
    }
    updates.status = rawStatus;
  }

  if (Object.keys(updates).length === 0 && scheduleSlots === null) {
    return NextResponse.json({ error: 'Nothing to update', code: 'no_fields' }, { status: 400 });
  }

  // Over-cap lock: a Standard teacher past 60 students cannot edit a group
  // (name/fee/schedule). Archiving is the escape hatch (it sheds an active
  // group's students from the count), so a PURE archive is always allowed; an
  // unarchive or any other edit is blocked while over the cap.
  const isPureArchive =
    updates.status === 'archived' &&
    updates.name === undefined &&
    updates.fee_per_class === undefined &&
    scheduleSlots === null;
  if (!isPureArchive) {
    const cap = await requireTeacherUnderCap(auth.supabaseAdmin, auth.userId, ROUTE_TAG);
    if (!cap.ok) return cap.response;
  }

  let g = {
    id: owned.group.id,
    name: owned.group.name,
    fee_per_class: owned.group.fee_per_class,
    status: owned.group.status,
  };

  if (Object.keys(updates).length > 0) {
    const { data: updated, error: updateErr } = await auth.supabaseAdmin
      .from('student_groups')
      .update(updates)
      .eq('id', groupId)
      .eq('teacher_id', auth.userId)
      .eq('kind', 'private')
      .select('id, name, fee_per_class, status')
      .single();
    if (updateErr) {
      const pgCode = (updateErr as { code?: string }).code;
      if (pgCode === '23514' || pgCode === '23502') {
        return NextResponse.json(
          { error: 'Invalid request', code: 'invalid_group' },
          { status: 400 },
        );
      }
      return serverError('group_update', updateErr);
    }
    g = updated as typeof g;
  }

  // Replace-all schedule semantics: an empty array clears the schedule, a
  // non-empty array becomes the new full set. Delete-then-insert is the
  // simplest correct shape (slots have no identity the form preserves).
  if (scheduleSlots !== null) {
    const { error: deleteErr } = await auth.supabaseAdmin
      .from('group_schedule')
      .delete()
      .eq('group_id', groupId);
    if (deleteErr) {
      return serverError('schedule_delete', deleteErr);
    }
    if (scheduleSlots.length > 0) {
      const { error: insertErr } = await auth.supabaseAdmin
        .from('group_schedule')
        .insert(
          scheduleSlots.map((s) => ({
            group_id: groupId,
            day_of_week: s.day_of_week,
            time_start: s.time_start,
            duration_minutes: s.duration_minutes,
          })),
        );
      if (insertErr) {
        return serverError('schedule_insert', insertErr);
      }
    }
    // Students see schedule changes over WhatsApp (Phase 4 stub today).
    // Fail open: a notification failure never fails the save.
    try {
      await queueScheduleChangedNotification(groupId, auth.userId, auth.supabaseAdmin);
    } catch (notifyErr) {
      Sentry.withScope((scope) => {
        scope.setTag('route', ROUTE_TAG);
        scope.setTag('step', 'schedule_changed_notification');
        Sentry.captureMessage(
          `queueScheduleChangedNotification failed: ${(notifyErr as Error).message}`,
          'warning',
        );
      });
    }
  }
  return NextResponse.json({
    group: {
      id: g.id,
      name: g.name,
      fee_per_class: Number(g.fee_per_class) || 0,
      status: g.status,
    },
  });
}
