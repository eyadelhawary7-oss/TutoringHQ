import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import { countActiveNonGuestStudents, studentCapForPlan } from '@/lib/teacherCap';
import { isProOrAbove } from '@/lib/teacherPlans';

const ROUTE_TAG = 'api/teacher/private/students';

function serverError(step: string, err: { message: string }): NextResponse {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * GET: every student (active + pending) across the teacher's private groups,
 * one row per enrollment so a student in two groups appears under each. PRIVATE
 * data, so requireTeacherPrivateAccess is the first line of defense - a lapsed
 * or never-subscribed teacher gets 403 and no query runs. Tenant scoping:
 * student_groups.teacher_id = auth.userId.
 *
 * The list is name + phone + group only, because that is all §01 draws. The
 * per-student billing / parent-contact / attendance payloads this route used to
 * carry moved to GET /api/teacher/private/students/[studentId], which the
 * detail screen fetches for one student - removing an unbounded transaction
 * scan from every list render.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) return auth.response;

  const { data: groupRows, error: groupsErr } = await auth.supabaseAdmin
    .from('student_groups')
    .select('id, name')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'private');
  if (groupsErr) return serverError('group_list', groupsErr);
  const groups = (groupRows ?? []) as { id: string; name: string | null }[];
  if (groups.length === 0) {
    return NextResponse.json({ students: [] });
  }
  const nameByGroup = new Map(groups.map((g) => [g.id, g.name]));

  const { data: enrollRows, error: enrollErr } = await auth.supabaseAdmin
    .from('enrollments')
    .select('id, student_id, group_id, status')
    .in('group_id', groups.map((g) => g.id))
    .in('status', ['pending', 'active']);
  if (enrollErr) return serverError('enrollment_list', enrollErr);
  const enrollments = (enrollRows ?? []) as {
    id: string;
    student_id: string;
    group_id: string;
    status: string;
  }[];

  const studentById = new Map<string, { name: string | null; phone: string | null }>();
  if (enrollments.length > 0) {
    const { data: studentRows, error: studentsErr } = await auth.supabaseAdmin
      .from('students')
      .select('id, name, phone')
      .in('id', enrollments.map((e) => e.student_id));
    if (studentsErr) return serverError('student_list', studentsErr);
    for (const s of (studentRows ?? []) as {
      id: string;
      name: string | null;
      phone: string | null;
    }[]) {
      studentById.set(s.id, { name: s.name, phone: s.phone });
    }
  }

  // Pending first (they need action), then active; alpha within each.
  const rank = (s: string) => (s === 'pending' ? 0 : 1);
  const students = enrollments
    .map((e) => ({
      enrollmentId: e.id,
      studentId: e.student_id,
      name: studentById.get(e.student_id)?.name ?? null,
      phone: studentById.get(e.student_id)?.phone ?? null,
      status: e.status,
      groupId: e.group_id,
      groupName: nameByGroup.get(e.group_id) ?? null,
    }))
    .sort(
      (a, b) =>
        rank(a.status) - rank(b.status) ||
        (a.name ?? '').localeCompare(b.name ?? ''),
    );

  // Over-cap flag for the students-page warning banner. The students page is
  // the ONE surface a locked Standard teacher can still reach, so it carries the
  // "shed students to 60" message. Best-effort (Rule 151: an error is not a
  // state - a blip must not raise a false over-cap alarm), so default false.
  let overCap = false;
  let studentCount = 0;
  let planKey: string | undefined;
  try {
    const { data: subRow } = await auth.supabaseAdmin
      .from('teacher_subscriptions')
      .select('plan_key')
      .eq('teacher_id', auth.userId)
      .maybeSingle();
    planKey = (subRow as { plan_key?: string } | null)?.plan_key;
    if (!isProOrAbove(planKey)) {
      studentCount = await countActiveNonGuestStudents(auth.supabaseAdmin, auth.userId);
      overCap = studentCount > studentCapForPlan(planKey);
    }
  } catch (capErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'over_cap_flag');
      Sentry.captureMessage(
        `teacher students over-cap flag lookup failed: ${(capErr as Error).message}`,
        'warning',
      );
    });
  }

  return NextResponse.json({
    students,
    over_cap: overCap,
    student_count: studentCount,
    student_limit: studentCapForPlan(planKey),
  });
}
