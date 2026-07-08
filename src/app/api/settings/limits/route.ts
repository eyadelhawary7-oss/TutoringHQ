import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';

/**
 * GET /api/settings/limits
 * Returns the current center's plan limits and current counts.
 * Response: { maxTeachers, currentTeachers, maxStudents, currentStudents, canAddTeacher, canAddStudent }
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    const centerId = auth.centerId;

    const { data: center, error: centerError } = await auth.supabaseAdmin
      .from('centers')
      .select('max_teachers, max_students, plan')
      .eq('id', centerId)
      .single();

    if (centerError || !center) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }

    const maxTeachers = Number(center.max_teachers ?? 2);
    const maxStudents = Number(center.max_students ?? 150);

    // Count all team members (owner, admin, assistant, teacher)
    const { count: currentTeamMembers } = await auth.supabaseAdmin
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('center_id', centerId);

    const { count: currentStudents } = await auth.supabaseAdmin
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('center_id', centerId);

    // Weekly active students (unique students scanned in past 7 days)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const { data: weeklyScans } = await auth.supabaseAdmin
      .from('attendance_scans')
      .select('student_id')
      .eq('center_id', centerId)
      .gte('scanned_at', weekAgo.toISOString());
    const weeklyUniqueStudents = new Set((weeklyScans || []).map((s: { student_id: string }) => s.student_id)).size;

    const plan = (center as { plan?: string })?.plan || 'starter';
    const planLimits: Record<string, number> = { nano: 120, starter: 200, pro: 500, business: 1000, enterprise: 2000 };
    const studentLimit = plan === 'top_centers' ? 999999 : Number(center.max_students ?? planLimits[plan] ?? 200);

    const currentTeachers = currentTeamMembers ?? 0;
    return NextResponse.json({
      maxTeachers,
      currentTeachers,
      maxStudents,
      currentStudents: currentStudents ?? 0,
      canAddTeacher: currentTeachers < maxTeachers,
      canAddStudent: (currentStudents ?? 0) < maxStudents,
      plan,
      weeklyUniqueStudents,
      studentLimit,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
