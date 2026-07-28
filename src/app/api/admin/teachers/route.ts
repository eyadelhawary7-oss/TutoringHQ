import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { customPermissionsToKeys, fetchAdminAccessFlags } from '@/lib/admin-access';
import { getAdminPermissions } from '@/lib/admin-roles';
import { parseIncludeTestCenters } from '@/lib/adminIncludeTest';
import {
  buildAdminTeacherRows,
  type AdminTeacherProfileRow,
} from '@/lib/adminTeacherAccounts';
import type { TeacherSubRow, TeacherUserRow } from '@/lib/ownerNormalizer';

/**
 * Admin solo-teacher account list — the teacher half of `/admin/centers`.
 *
 * Gated on the `centers` permission. The design's premise is that centers and
 * solo teachers are two co-equal customer types, so whoever may list one may
 * list the other; a separate `teachers` permission key would be a roles change.
 *
 * Test rows are excluded by default (`is_test = false`), with `include_test=1`
 * as the documented diagnostic toggle — the rule every admin aggregate follows.
 *
 * Row assembly lives in `@/lib/adminTeacherAccounts` and is unit-tested there.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { supabaseAdmin, userId } = ctx;
    const { data: au } = await supabaseAdmin
      .from('admin_users')
      .select('role, custom_permissions')
      .eq('id', userId)
      .maybeSingle();
    const flags = await fetchAdminAccessFlags(supabaseAdmin, userId);
    const effRole = flags.isSuperAdmin ? 'super_admin' : (au?.role ?? 'internal_viewer');
    const keys = customPermissionsToKeys(au?.custom_permissions);
    const perms = getAdminPermissions(effRole, keys);
    if (!flags.isSuperAdmin && !flags.canApproveSignups && !perms.includes('centers')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const includeTest = parseIncludeTestCenters(request);
    const teacherIdFilter = new URL(request.url).searchParams.get('teacher_id');

    // Accounts first. Everything else hangs off this list — see the module
    // docstring for why this is profile-driven rather than subscription-driven.
    let profileQuery = supabaseAdmin
      .from('teacher_profiles')
      .select('user_id, display_name, subject, is_test, created_at');
    if (teacherIdFilter) profileQuery = profileQuery.eq('user_id', teacherIdFilter);
    const { data: profileData, error: profileError } = await profileQuery;
    if (profileError) {
      return NextResponse.json({ error: 'Failed to load teachers' }, { status: 500 });
    }

    const profiles = ((profileData ?? []) as AdminTeacherProfileRow[]).filter(
      (p) => !!p.user_id && (includeTest || !p.is_test),
    );
    const teacherIds = profiles.map((p) => p.user_id as string);

    if (teacherIds.length === 0) {
      return NextResponse.json({ teachers: [], includeTest });
    }

    const [subsRes, usersRes, groupsRes] = await Promise.all([
      supabaseAdmin
        .from('teacher_subscriptions')
        .select(
          'teacher_id, plan_key, status, price_gross, billing_interval, next_billing_at, last_payment_at',
        )
        .in('teacher_id', teacherIds),
      supabaseAdmin.from('users').select('id, phone, name').in('id', teacherIds),
      supabaseAdmin.from('student_groups').select('id, teacher_id').in('teacher_id', teacherIds),
    ]);

    const groups = (groupsRes.data ?? []) as { id: string; teacher_id: string | null }[];
    const groupIds = groups.map((g) => g.id).filter(Boolean);

    let members: { student_id: string; group_id: string }[] = [];
    if (groupIds.length > 0) {
      const { data: memberData } = await supabaseAdmin
        .from('student_group_members')
        .select('student_id, group_id')
        .in('group_id', groupIds);
      members = (memberData ?? []) as { student_id: string; group_id: string }[];
    }

    const teachers = buildAdminTeacherRows({
      profiles,
      subs: (subsRes.data ?? []) as TeacherSubRow[],
      users: (usersRes.data ?? []) as TeacherUserRow[],
      groups,
      members,
    });

    return NextResponse.json({ teachers, includeTest });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
