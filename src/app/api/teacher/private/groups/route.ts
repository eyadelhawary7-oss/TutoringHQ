import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth, requireTeacherPrivateAccess } from '@/lib/centerAuth';
import { parseScheduleSlots, type ScheduleSlotInput } from '@/lib/teacherSchedule';

type GroupRow = {
  id: string;
  name: string | null;
  fee_per_class: number | string | null;
  status: string | null;
  created_at: string | null;
};

const LAPSED_BLOCK_STATUSES = new Set(['trialing', 'active']);

function serverError(step: string, err: { message: string }): NextResponse {
  Sentry.withScope((scope) => {
    scope.setTag('route', 'api/teacher/private/groups');
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json(
    { error: 'Server error', code: 'server_error' },
    { status: 500 },
  );
}

/**
 * GET: the teacher's private group list. PRIVATE-ENGINE data, so the gate is
 * the first line of defense - lapsed and never-subscribed teachers get 403
 * NO_PRIVATE_ACCESS and no data query runs.
 *
 * Tenant scoping: student_groups.teacher_id = auth.userId, kind='private'.
 * Enrollment counts are display data (best-effort: error -> zero counts +
 * Sentry warning; the list itself is CORE -> 500 on error).
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { data: groupRows, error: groupsErr } = await auth.supabaseAdmin
    .from('student_groups')
    .select('id, name, fee_per_class, status, created_at')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'private')
    .order('created_at', { ascending: false });
  if (groupsErr) {
    return serverError('group_list', groupsErr);
  }
  const groups = (groupRows ?? []) as GroupRow[];

  const activeByGroup = new Map<string, number>();
  const pendingByGroup = new Map<string, number>();
  if (groups.length > 0) {
    const { data: enrollmentRows, error: enrollErr } = await auth.supabaseAdmin
      .from('enrollments')
      .select('group_id, status')
      .in('group_id', groups.map((g) => g.id))
      .in('status', ['pending', 'active']);
    if (enrollErr) {
      Sentry.withScope((scope) => {
        scope.setTag('route', 'api/teacher/private/groups');
        scope.setTag('step', 'enrollment_counts');
        Sentry.captureMessage(
          `teacher groups enrollment-count lookup failed: ${enrollErr.message}`,
          'warning',
        );
      });
    } else {
      for (const r of (enrollmentRows ?? []) as { group_id: string; status: string }[]) {
        const m = r.status === 'active' ? activeByGroup : pendingByGroup;
        m.set(r.group_id, (m.get(r.group_id) ?? 0) + 1);
      }
    }
  }

  return NextResponse.json({
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      fee_per_class: Number(g.fee_per_class) || 0,
      status: g.status,
      activeStudents: activeByGroup.get(g.id) ?? 0,
      pendingStudents: pendingByGroup.get(g.id) ?? 0,
    })),
  });
}

/**
 * POST: create a private group. Deliberately NOT behind
 * requireTeacherPrivateAccess: the FIRST group is created by a teacher whose
 * gate is still false (no subscription row yet) - that insert is what fires
 * trg_provision_teacher_subscription and starts the 14-day trial. Explicit
 * state logic instead:
 *
 *   no teacher_subscriptions row            -> allow (first group, DB
 *                                               trigger provisions trialing)
 *   row with status trialing/active         -> allow (group #2+)
 *   row with any other status (past_due/
 *   suspended/cancelled)                    -> 403 RESUBSCRIBE_REQUIRED.
 *                                              A lapsed teacher cannot mint a
 *                                              fresh trial via a new group;
 *                                              their path back is resubscribe.
 *
 * (The DB trigger is also idempotent per teacher, so even a bug here could
 * not re-trial a lapsed teacher - but the 403 is the product behaviour.)
 *
 * Rule 151: the subscription-presence read is CORE - on error 500, never
 * guess a state. Tenant scoping: teacher_id and kind are set server-side,
 * never read from the body.
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
    name: rawName,
    fee_per_class: rawFee,
    schedule: rawSchedule,
  } = (body ?? {}) as {
    name?: unknown;
    fee_per_class?: unknown;
    schedule?: unknown;
  };

  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (name.length < 1 || name.length > 120) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_name' },
      { status: 400 },
    );
  }

  const fee = typeof rawFee === 'number' ? rawFee : NaN;
  const isTwoDecimalsMax = Math.abs(fee * 100 - Math.round(fee * 100)) < 1e-6;
  if (!Number.isFinite(fee) || fee <= 0 || fee > 1_000_000 || !isTwoDecimalsMax) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_fee' },
      { status: 400 },
    );
  }

  let scheduleSlots: ScheduleSlotInput[] = [];
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

  const { data: subRow, error: subErr } = await auth.supabaseAdmin
    .from('teacher_subscriptions')
    .select('status')
    .eq('teacher_id', auth.userId)
    .limit(1)
    .maybeSingle();
  if (subErr) {
    return serverError('subscription_status', subErr);
  }
  const subStatus = (subRow as { status?: string } | null)?.status;
  if (subRow && !LAPSED_BLOCK_STATUSES.has(String(subStatus ?? ''))) {
    return NextResponse.json(
      { error: 'Forbidden', code: 'RESUBSCRIBE_REQUIRED' },
      { status: 403 },
    );
  }

  // approval_mode is NOT NULL for private groups (kind_shape CHECK); 'manual'
  // until the enrollment-approval surface exists. kind and teacher_id are
  // server-set - the body cannot scope the row to anyone else.
  const { data: inserted, error: insertErr } = await auth.supabaseAdmin
    .from('student_groups')
    .insert({
      name,
      fee_per_class: Math.round(fee * 100) / 100,
      kind: 'private',
      teacher_id: auth.userId,
      approval_mode: 'manual',
    })
    .select('id, name, fee_per_class, status')
    .single();
  if (insertErr) {
    const pgCode = (insertErr as { code?: string }).code;
    if (pgCode === '23514' || pgCode === '23502') {
      // CHECK / NOT NULL violation: the row shape was rejected by the DB.
      Sentry.withScope((scope) => {
        scope.setTag('route', 'api/teacher/private/groups');
        scope.setTag('step', 'group_insert_check');
        Sentry.captureMessage(
          `private group insert rejected by constraint: ${insertErr.message}`,
          'warning',
        );
      });
      return NextResponse.json(
        { error: 'Invalid request', code: 'invalid_group' },
        { status: 400 },
      );
    }
    return serverError('group_insert', insertErr);
  }

  const g = inserted as GroupRow;

  // Schedule slots are best-effort on create: the group itself must always
  // succeed (it is what provisions the trial). A failed slot insert is a
  // Sentry warning, never a rollback - the teacher can re-add slots via edit.
  if (scheduleSlots.length > 0) {
    const { error: scheduleErr } = await auth.supabaseAdmin
      .from('group_schedule')
      .insert(
        scheduleSlots.map((s) => ({
          group_id: g.id,
          day_of_week: s.day_of_week,
          time_start: s.time_start,
          duration_minutes: s.duration_minutes,
        })),
      );
    if (scheduleErr) {
      Sentry.withScope((scope) => {
        scope.setTag('route', 'api/teacher/private/groups');
        scope.setTag('step', 'schedule_insert');
        Sentry.captureMessage(
          `group schedule insert failed after group create: ${scheduleErr.message}`,
          'warning',
        );
      });
    }
  }

  return NextResponse.json(
    {
      group: {
        id: g.id,
        name: g.name,
        fee_per_class: Number(g.fee_per_class) || 0,
        status: g.status,
        activeStudents: 0,
        pendingStudents: 0,
      },
    },
    { status: 201 },
  );
}
