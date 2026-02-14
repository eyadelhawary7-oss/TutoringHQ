import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';

const PLAN_MRR: Record<string, number> = {
  starter: 4000,
  pro: 7200,
  pro_plus: 8000,
  enterprise: 9000,
  payg: 0,
  top_centers: 0,
};

export async function GET(request: Request) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { supabaseAdmin } = ctx;

    const { data: centers, error: centersError } = await supabaseAdmin
      .from('centers')
      .select('id, name, plan, status, created_at')
      .neq('status', 'deleted');

    if (centersError) {
      return NextResponse.json({ error: centersError.message }, { status: 500 });
    }

    const { count: studentsCount, error: studentsError } = await supabaseAdmin
      .from('students')
      .select('id', { count: 'exact', head: true });

    if (studentsError) {
      return NextResponse.json({ error: studentsError.message }, { status: 500 });
    }

    const totalStudents = studentsCount ?? 0;
    const allCenters = centers || [];
    const activeCenters = allCenters.filter((c: { status?: string }) => c.status === 'active');
    const suspendedCenters = allCenters.filter((c: { status?: string }) => c.status === 'suspended');
    const pendingCenters = allCenters.filter((c: { status?: string }) => c.status === 'pending');

    const mrr = activeCenters.reduce((sum: number, c: { plan?: string }) => {
      const plan = c.plan || 'starter';
      return sum + (PLAN_MRR[plan] ?? PLAN_MRR.starter);
    }, 0);

    const byPlan: Record<string, number> = {
      starter: 0,
      pro: 0,
      pro_plus: 0,
      enterprise: 0,
      payg: 0,
    };
    for (const c of allCenters) {
      const plan = c.plan || 'starter';
      byPlan[plan] = (byPlan[plan] ?? 0) + 1;
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const signupsByDay: Record<string, number> = {};
    for (let d = new Date(thirtyDaysAgo); d <= now; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      signupsByDay[key] = 0;
    }
    for (const c of allCenters) {
      const createdAt = c.created_at ? new Date(c.created_at) : null;
      if (createdAt && createdAt >= thirtyDaysAgo) {
        const key = createdAt.toISOString().slice(0, 10);
        signupsByDay[key] = (signupsByDay[key] ?? 0) + 1;
      }
    }
    const signupsChart = Object.entries(signupsByDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    const { count: pendingPlanRequestsCount } = await supabaseAdmin
      .from('plan_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');

    const { count: pendingPaymentProofsCount } = await supabaseAdmin
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');

    const todayStr = new Date().toISOString().split('T')[0];
    const { data: overdueCenters } = await supabaseAdmin
      .from('centers')
      .select('id, name, next_payment_due')
      .eq('status', 'active')
      .lt('next_payment_due', todayStr);

    let recentActivity: unknown[] = [];
    try {
      const { data: auditData } = await supabaseAdmin
        .from('audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      recentActivity = auditData ?? [];
    } catch {
      // audit_log may not exist in some deployments
    }

    return NextResponse.json({
      totalCenters: allCenters.length,
      activeCenters: activeCenters.length,
      suspendedCenters: suspendedCenters.length,
      pendingCenters: pendingCenters.length,
      totalStudents,
      mrr,
      byPlan,
      signupsChart,
      pendingSignupsCount: pendingCenters.length,
      pendingPlanRequestsCount: pendingPlanRequestsCount ?? 0,
      pendingPaymentProofsCount: pendingPaymentProofsCount ?? 0,
      overdueCentersCount: overdueCenters?.length ?? 0,
      overdueCenters: overdueCenters ?? [],
      recentActivity,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
