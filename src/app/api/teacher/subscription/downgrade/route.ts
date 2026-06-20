import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';
import { isProOrAbove } from '@/lib/teacherPlans';

const ROUTE_TAG = 'api/teacher/subscription/downgrade';
const GROUP_LIMIT = 8;
const STUDENT_LIMIT = 60;

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/** Tag an error with the failure phase so the catch can report it. */
function withPhase(phase: string, err: unknown): Error & { _phase: string } {
  const base =
    err instanceof Error
      ? err
      : new Error(
          typeof (err as { message?: string })?.message === 'string'
            ? (err as { message: string }).message
            : String(err),
        );
  return Object.assign(base, { _phase: phase });
}

/**
 * POST /api/teacher/subscription/downgrade
 * Pro (teacher_pro) -> Standard (teacher_standard). Standard caps at 8 active
 * private groups and 60 active enrolled students, so a Pro teacher who is over
 * either cap must shed groups/students before the downgrade lands.
 *
 * Multi-pass contract (the UI walks these in order):
 *   - no body, over a cap        -> 200 { needs_cap_resolution | needs_student_resolution }
 *   - { groups_to_archive }       -> archive, recount; may return needs_student_resolution
 *   - { students_to_unenroll }    -> unenroll (via apply_enrollment_transition,
 *                                     status 'removed'), recount; still over -> 422
 *   - under both caps             -> downgrade_teacher_to_standard, 200 { downgraded: true }
 *
 * Lifecycle: the plan/status/credits change goes through the
 * downgrade_teacher_to_standard RPC; enrollment removals go through
 * apply_enrollment_transition (direct status UPDATEs are blocked by a guard).
 */
export async function POST(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  const { data: subRow, error: subErr } = await auth.supabaseAdmin
    .from('teacher_subscriptions')
    .select('plan_key')
    .eq('teacher_id', auth.userId)
    .maybeSingle();
  if (subErr) return fail('subscription_lookup', subErr);
  const planKey = (subRow as { plan_key?: string } | null)?.plan_key;
  if (!isProOrAbove(planKey)) {
    return NextResponse.json({ error: 'NOT_PRO' }, { status: 400 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const { groups_to_archive: rawArchive, students_to_unenroll: rawUnenroll } = (body ?? {}) as {
    groups_to_archive?: unknown;
    students_to_unenroll?: unknown;
  };
  const groupsToArchive = Array.isArray(rawArchive)
    ? rawArchive.filter((x): x is string => typeof x === 'string')
    : [];
  const studentsToUnenroll = Array.isArray(rawUnenroll)
    ? rawUnenroll.filter((x): x is string => typeof x === 'string')
    : [];

  try {
    // 1. Archive selected groups (scoped to this teacher's private groups).
    if (groupsToArchive.length > 0) {
      const { error } = await auth.supabaseAdmin
        .from('student_groups')
        .update({ status: 'archived' })
        .in('id', groupsToArchive)
        .eq('teacher_id', auth.userId)
        .eq('kind', 'private');
      if (error) throw withPhase('archive_groups', error);
    }

    // 2. Unenroll selected students. The enrollments guard blocks direct status
    //    UPDATEs, so each removal goes through apply_enrollment_transition
    //    (active -> removed). Scoped to this teacher's active private groups.
    if (studentsToUnenroll.length > 0) {
      const { data: ag, error: agErr } = await auth.supabaseAdmin
        .from('student_groups')
        .select('id')
        .eq('teacher_id', auth.userId)
        .eq('kind', 'private')
        .eq('status', 'active');
      if (agErr) throw withPhase('unenroll_groups', agErr);
      const activeGroupIds = (ag ?? []).map((g) => (g as { id: string }).id);
      if (activeGroupIds.length > 0) {
        const { data: enr, error: enrErr } = await auth.supabaseAdmin
          .from('enrollments')
          .select('id, student_id')
          .in('group_id', activeGroupIds)
          .eq('status', 'active')
          .in('student_id', studentsToUnenroll);
        if (enrErr) throw withPhase('unenroll_lookup', enrErr);
        for (const e of (enr ?? []) as { id: string; student_id: string }[]) {
          const { error: trErr } = await auth.supabaseAdmin.rpc('apply_enrollment_transition', {
            p_enrollment_id: e.id,
            p_new_status: 'removed',
            p_actor_id: auth.userId,
          });
          if (trErr) throw withPhase('unenroll_transition', trErr);
        }
      }
    }

    // 3. Recompute the cap snapshot after any mutations above.
    const { data: groupRows, error: gErr } = await auth.supabaseAdmin
      .from('student_groups')
      .select('id, name')
      .eq('teacher_id', auth.userId)
      .eq('kind', 'private')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    if (gErr) throw withPhase('snapshot_groups', gErr);
    const groups = (groupRows ?? []) as { id: string; name: string | null }[];
    const groupIds = groups.map((g) => g.id);

    let enrollments: { student_id: string; group_id: string }[] = [];
    if (groupIds.length > 0) {
      const { data: enr, error: eErr } = await auth.supabaseAdmin
        .from('enrollments')
        .select('student_id, group_id')
        .in('group_id', groupIds)
        .eq('status', 'active');
      if (eErr) throw withPhase('snapshot_enrollments', eErr);
      enrollments = (enr ?? []) as { student_id: string; group_id: string }[];
    }

    const perGroupCount = new Map<string, number>();
    const distinct = new Set<string>();
    for (const e of enrollments) {
      perGroupCount.set(e.group_id, (perGroupCount.get(e.group_id) ?? 0) + 1);
      distinct.add(e.student_id);
    }
    const groupCount = groups.length;
    const studentCount = distinct.size;

    // 4. Still over the group cap -> ask to archive (easiest first: fewest students).
    if (groupCount > GROUP_LIMIT) {
      const groupsPayload = groups
        .map((g) => ({ id: g.id, name: g.name, student_count: perGroupCount.get(g.id) ?? 0 }))
        .sort((a, b) => a.student_count - b.student_count);
      return NextResponse.json({
        needs_cap_resolution: true,
        groups: groupsPayload,
        students: [],
        group_count: groupCount,
        student_count: studentCount,
        group_limit: GROUP_LIMIT,
        student_limit: STUDENT_LIMIT,
      });
    }

    // 5. Still over the student cap.
    if (studentCount > STUDENT_LIMIT) {
      if (studentsToUnenroll.length > 0) {
        // Second pass and still over the line -> hard stop.
        return NextResponse.json({ error: 'STILL_OVER_LIMIT' }, { status: 422 });
      }
      const groupNameById = new Map(groups.map((g) => [g.id, g.name]));
      const studentIds = Array.from(distinct);
      const nameById = new Map<string, string | null>();
      if (studentIds.length > 0) {
        const { data: studs, error: sErr } = await auth.supabaseAdmin
          .from('students')
          .select('id, name')
          .in('id', studentIds);
        if (sErr) throw withPhase('snapshot_students', sErr);
        for (const s of (studs ?? []) as { id: string; name: string | null }[]) {
          nameById.set(s.id, s.name);
        }
      }
      // One row per distinct student (the cap is distinct-student based).
      const seen = new Set<string>();
      const studentsPayload: { id: string; name: string | null; group_name: string | null }[] = [];
      for (const e of enrollments) {
        if (seen.has(e.student_id)) continue;
        seen.add(e.student_id);
        studentsPayload.push({
          id: e.student_id,
          name: nameById.get(e.student_id) ?? null,
          group_name: groupNameById.get(e.group_id) ?? null,
        });
      }
      return NextResponse.json({
        needs_student_resolution: true,
        students: studentsPayload,
        student_count: studentCount,
        student_limit: STUDENT_LIMIT,
      });
    }

    // 6. Under both caps -> perform the downgrade via the lifecycle RPC.
    const { error: dErr } = await auth.supabaseAdmin.rpc('downgrade_teacher_to_standard', {
      p_user_id: auth.userId,
    });
    if (dErr) throw withPhase('downgrade_rpc', dErr);
    return NextResponse.json({ downgraded: true });
  } catch (e) {
    const phase = (e as { _phase?: string })._phase ?? 'downgrade';
    return fail(phase, e);
  }
}
