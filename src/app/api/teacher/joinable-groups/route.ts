import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';

const ROUTE_TAG = 'api/teacher/joinable-groups';

/**
 * GET /api/teacher/joinable-groups?center_id=<id>
 * The teacher-side mirror of /api/center/attachable-groups: plain center groups
 * a teacher could ASK to run - kind='center', no teacher yet (teacher_id IS
 * NULL), at a center the teacher is ALREADY an active member of. The membership
 * gate is auth.centerIds (resolved server-side from teacher_center status
 * 'active') - never the query string alone (linked-first, Phase 2).
 *
 * Each group carries its current center_cut_egp and a student COUNT (never the
 * roster - same privacy choice as the proposals info card) so the teacher sees
 * the cut and size BEFORE requesting. Groups that already have an OPEN attach
 * proposal (either direction) are filtered out, so the teacher never picks one
 * that would collide with the partial unique index on accept.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  const centerId = (new URL(request.url).searchParams.get('center_id') ?? '').trim();
  if (!centerId) {
    return NextResponse.json({ error: 'Invalid input', code: 'INVALID_INPUT' }, { status: 400 });
  }
  if (!auth.centerIds.includes(centerId)) {
    return NextResponse.json(
      { error: 'Not a member of this center', code: 'NOT_A_MEMBER' },
      { status: 403 },
    );
  }

  // CORE: the teacher-less center groups themselves (Rule 151 - the picker
  // depends on them, so a lookup failure is a 500, not a silent empty list).
  const { data, error } = await auth.supabaseAdmin
    .from('student_groups')
    .select('id, name, subject, fee_per_class, center_cut_egp')
    .eq('center_id', centerId)
    .eq('kind', 'center')
    .is('teacher_id', null)
    .order('name', { ascending: true });
  if (error) {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'list_groups');
      Sentry.captureException(error);
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  }
  const groupRows = (data ?? []) as {
    id: string;
    name: string | null;
    subject: string | null;
    fee_per_class: number | string | null;
    center_cut_egp: number | string | null;
  }[];
  if (groupRows.length === 0) return NextResponse.json({ groups: [] });

  const groupIds = groupRows.map((g) => g.id);

  // BEST-EFFORT: drop groups already under an OPEN attach negotiation so the
  // teacher cannot pick a duplicate (the insert still rejects with 23505 if a
  // race slips through). A failure here only means the list is not pre-filtered.
  const blocked = new Set<string>();
  const { data: openAttach, error: openErr } = await auth.supabaseAdmin
    .from('group_proposals')
    .select('target_group_id')
    .eq('center_id', centerId)
    .eq('status', 'open')
    .in('target_group_id', groupIds);
  if (openErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'open_attach');
      Sentry.captureMessage(`joinable-groups open-attach lookup failed: ${openErr.message}`, 'warning');
    });
  } else {
    for (const r of (openAttach ?? []) as { target_group_id: string | null }[]) {
      if (r.target_group_id) blocked.add(r.target_group_id);
    }
  }

  // BEST-EFFORT: student count per group (count-only), from student_group_members
  // - the SAME source the Groups page uses, so the numbers agree.
  const visibleIds = groupIds.filter((id) => !blocked.has(id));
  const countByGroup = new Map<string, number>();
  if (visibleIds.length > 0) {
    const { data: memberRows, error: membersErr } = await auth.supabaseAdmin
      .from('student_group_members')
      .select('group_id')
      .in('group_id', visibleIds);
    if (membersErr) {
      Sentry.withScope((scope) => {
        scope.setTag('route', ROUTE_TAG);
        scope.setTag('step', 'student_count');
        Sentry.captureMessage(`joinable-groups student-count failed: ${membersErr.message}`, 'warning');
      });
    } else {
      for (const m of (memberRows ?? []) as { group_id: string }[]) {
        countByGroup.set(m.group_id, (countByGroup.get(m.group_id) ?? 0) + 1);
      }
    }
  }

  const groups = groupRows
    .filter((g) => !blocked.has(g.id))
    .map((g) => ({
      id: g.id,
      name: g.name,
      subject: g.subject,
      feePerClass: g.fee_per_class == null ? null : Number(g.fee_per_class),
      centerCutEgp: g.center_cut_egp == null ? 0 : Number(g.center_cut_egp),
      studentCount: countByGroup.get(g.id) ?? 0,
    }));

  return NextResponse.json({ groups });
}
