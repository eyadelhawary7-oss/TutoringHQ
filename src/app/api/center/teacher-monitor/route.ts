import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireOwnerAdminCenter } from '@/lib/requireOwnerAdminCenter';

const ROUTE_TAG = 'api/center/teacher-monitor';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

type MonitorGroup = {
  id: string;
  name: string | null;
  subject: string | null;
  studentCount: number;
  feePerClass: number | null;
  centerCutEgp: number;
};

type MonitorTeacher = {
  id: string;
  name: string | null;
  subject: string | null;
  groups: MonitorGroup[];
  money: {
    /** Student lesson fees actually collected (paid), scoped to this center. */
    feesCollected: number;
    /** Center cut actually earned (paid center_fee rows), this center. */
    centerCutEarned: number;
    /** Teacher's net of collected fees (feesCollected - centerCutEarned). */
    teacherEarnings: number;
    /** Lesson fees billed but not yet paid, this center. */
    feesOutstanding: number;
  };
};

/**
 * GET /api/center/teacher-monitor
 *
 * VIEW-ONLY money + roster monitor for the owner's Teachers section. For every
 * teacher actively linked to the caller's center, returns the center groups
 * that teacher runs HERE and the money to date - all strictly scoped to this
 * center_id. No teacher subscription status and no other-center data ever
 * crosses this boundary (only teacher_center, teacher_profiles display fields,
 * student_groups, student_group_members and transactions for THIS center are
 * read). Owner/admin only; the service-role client bypasses RLS so the gate is
 * the route's own requireOwnerAdminCenter.
 *
 * Money model (flat-cut center groups, per finish_center_class_and_bill):
 *   feesCollected   = sum(amount_billed) of paid 'lesson' rows
 *   centerCutEarned = sum(amount_billed) of paid 'center_fee' rows
 *   teacherEarnings = feesCollected - centerCutEarned
 * Test rows (is_test=true) are excluded, matching every other finance surface.
 */
export async function GET(request: NextRequest) {
  const ctx = await requireOwnerAdminCenter(request);
  if (ctx instanceof NextResponse) return ctx;

  // Active linked teachers for this center.
  const { data: memberships, error: membersErr } = await ctx.supabaseAdmin
    .from('teacher_center')
    .select('teacher_id')
    .eq('center_id', ctx.centerId)
    .eq('status', 'active');
  if (membersErr) return fail('membership_lookup', membersErr);

  const teacherIds = Array.from(
    new Set(((memberships ?? []) as { teacher_id: string }[]).map((m) => m.teacher_id)),
  );
  if (teacherIds.length === 0) {
    return NextResponse.json({ teachers: [] });
  }

  // Display name (teacher_profiles.display_name -> users.name) + subject.
  const nameById = new Map<string, string | null>();
  const subjectById = new Map<string, string | null>();
  const [profilesRes, usersRes] = await Promise.all([
    ctx.supabaseAdmin
      .from('teacher_profiles')
      .select('user_id, display_name, subject')
      .in('user_id', teacherIds),
    ctx.supabaseAdmin.from('users').select('id, name').in('id', teacherIds),
  ]);
  if (profilesRes.error || usersRes.error) {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'teacher_display');
      Sentry.captureMessage(
        `teacher-monitor display lookup failed: ${(profilesRes.error ?? usersRes.error)?.message}`,
        'warning',
      );
    });
  }
  for (const u of (usersRes.data ?? []) as { id: string; name: string | null }[]) {
    nameById.set(u.id, u.name);
  }
  for (const p of (profilesRes.data ?? []) as {
    user_id: string;
    display_name: string | null;
    subject: string | null;
  }[]) {
    if (p.display_name && p.display_name.trim()) nameById.set(p.user_id, p.display_name);
    subjectById.set(p.user_id, p.subject);
  }

  // Center groups these teachers run HERE (kind='center', this center only).
  const { data: groupRows, error: groupsErr } = await ctx.supabaseAdmin
    .from('student_groups')
    .select('id, name, subject, fee_per_class, center_cut_egp, teacher_id')
    .eq('center_id', ctx.centerId)
    .eq('kind', 'center')
    .in('teacher_id', teacherIds)
    .order('name', { ascending: true });
  if (groupsErr) return fail('groups_lookup', groupsErr);
  const groups = (groupRows ?? []) as {
    id: string;
    name: string | null;
    subject: string | null;
    fee_per_class: number | string | null;
    center_cut_egp: number | string | null;
    teacher_id: string | null;
  }[];

  // Student counts per group (student_group_members - the same source the
  // Groups page counts, so the numbers agree).
  const groupIds = groups.map((g) => g.id);
  const countByGroup = new Map<string, number>();
  if (groupIds.length > 0) {
    const { data: memberRows, error: membersCountErr } = await ctx.supabaseAdmin
      .from('student_group_members')
      .select('group_id')
      .in('group_id', groupIds);
    if (membersCountErr) return fail('member_count', membersCountErr);
    for (const m of (memberRows ?? []) as { group_id: string }[]) {
      countByGroup.set(m.group_id, (countByGroup.get(m.group_id) ?? 0) + 1);
    }
  }

  // Money to date, scoped to this center + these teachers, test rows excluded.
  const feesCollected = new Map<string, number>();
  const centerCutEarned = new Map<string, number>();
  const feesOutstanding = new Map<string, number>();
  const { data: txRows, error: txErr } = await ctx.supabaseAdmin
    .from('transactions')
    .select('teacher_id, kind, status, amount_billed')
    .eq('center_id', ctx.centerId)
    .in('teacher_id', teacherIds)
    .in('kind', ['lesson', 'center_fee'])
    .eq('is_test', false);
  if (txErr) return fail('transactions_lookup', txErr);
  for (const t of (txRows ?? []) as {
    teacher_id: string | null;
    kind: string;
    status: string;
    amount_billed: number | string | null;
  }[]) {
    if (!t.teacher_id) continue;
    const amt = t.amount_billed == null ? 0 : Number(t.amount_billed);
    if (!Number.isFinite(amt)) continue;
    if (t.kind === 'lesson') {
      if (t.status === 'paid') feesCollected.set(t.teacher_id, (feesCollected.get(t.teacher_id) ?? 0) + amt);
      else if (t.status === 'pending')
        feesOutstanding.set(t.teacher_id, (feesOutstanding.get(t.teacher_id) ?? 0) + amt);
    } else if (t.kind === 'center_fee' && t.status === 'paid') {
      centerCutEarned.set(t.teacher_id, (centerCutEarned.get(t.teacher_id) ?? 0) + amt);
    }
  }

  const groupsByTeacher = new Map<string, MonitorGroup[]>();
  for (const g of groups) {
    if (!g.teacher_id) continue;
    const list = groupsByTeacher.get(g.teacher_id) ?? [];
    list.push({
      id: g.id,
      name: g.name,
      subject: g.subject,
      studentCount: countByGroup.get(g.id) ?? 0,
      feePerClass: g.fee_per_class == null ? null : Number(g.fee_per_class),
      centerCutEgp: g.center_cut_egp == null ? 0 : Number(g.center_cut_egp),
    });
    groupsByTeacher.set(g.teacher_id, list);
  }

  const teachers: MonitorTeacher[] = teacherIds
    .map((id) => {
      const collected = feesCollected.get(id) ?? 0;
      const cut = centerCutEarned.get(id) ?? 0;
      return {
        id,
        name: nameById.get(id) ?? null,
        subject: subjectById.get(id) ?? null,
        groups: groupsByTeacher.get(id) ?? [],
        money: {
          feesCollected: collected,
          centerCutEarned: cut,
          teacherEarnings: collected - cut,
          feesOutstanding: feesOutstanding.get(id) ?? 0,
        },
      };
    })
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  return NextResponse.json({ teachers });
}
