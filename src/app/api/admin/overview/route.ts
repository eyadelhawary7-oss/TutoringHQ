import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/auth-helpers-nextjs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getAdminContext } from '@/lib/admin-auth';
import { PLAN_STUDENT_LIMITS } from '@/lib/plans';

const PLAN_MRR: Record<string, number> = {
  starter: 2000,
  pro: 4500,
  business: 6500,
  enterprise: 9000,
  top_centers: 0,
  payg: 0,
};

export async function GET(request: Request) {
  console.log('==========================================');
  console.log('[admin/overview] 🔍 Route called');
  console.log('==========================================');

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[admin/overview] ❌ Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
      return NextResponse.json(
        { error: 'Server misconfiguration: missing Supabase URL or anon key' },
        { status: 500 }
      );
    }

    if (!supabaseServiceKey) {
      console.error('[admin/overview] ❌ Missing SUPABASE_SERVICE_ROLE_KEY');
      return NextResponse.json(
        { error: 'Server misconfiguration: missing Supabase service role key' },
        { status: 500 }
      );
    }

    // Try cookie-based auth first (auth-helpers)
    let supabaseAdmin: SupabaseClient | null = null;
    let internalRole = 'internal_viewer';

    if (supabaseUrl && supabaseAnonKey) {
      const cookieStore = await cookies();
      const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
          getAll() {
            return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      });
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      console.log('[admin/overview] 🔐 Session check (cookies):', {
        hasSession: !!session,
        userId: session?.user?.id,
        error: sessionError?.message,
      });
      if (session && supabaseServiceKey) {
        const userId = session.user.id;
        const adminClient = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data: adminUser } = await adminClient.from('admin_users').select('id, role').eq('id', userId).single();
        const { data: userRecord } = await adminClient.from('users').select('phone').eq('id', userId).single();
        const userPhone = session.user.phone ?? userRecord?.phone ?? null;
        const superAdminPhones = (process.env.SUPER_ADMIN_PHONES || '').split(',').map((p) => p.trim());
        const isPhoneAdmin = !!userPhone && superAdminPhones.includes(String(userPhone).trim());
        console.log('[admin/overview] 🔐 Admin check:', { hasAdminUser: !!adminUser, isPhoneAdmin, userPhone: userPhone ? '***' : null });
        if (adminUser || isPhoneAdmin) {
          supabaseAdmin = adminClient;
          internalRole = isPhoneAdmin || adminUser?.role === 'super_admin' || adminUser?.role === 'admin' ? 'super_admin' : (adminUser?.role === 'internal_admin' ? 'internal_admin' : 'internal_viewer');
        }
      }
    }

    // Fallback: Authorization header (Bearer token) via getAdminContext
    if (!supabaseAdmin) {
      console.log('[admin/overview] 🔐 Trying Authorization header...');
      const ctx = await getAdminContext(request);
      if (ctx) {
        supabaseAdmin = ctx.supabaseAdmin;
        internalRole = ctx.internalRole;
      }
    }

    if (!supabaseAdmin) {
      console.error('[admin/overview] ❌ Unauthorized: no valid session or admin access');
      return NextResponse.json({ error: 'Unauthorized - admin access required' }, { status: 401 });
    }
    console.log('[admin/overview] ✅ Admin authorized, role:', internalRole);

    console.log('[admin/overview] 📡 Querying centers...');
    let centers: unknown[] = [];
    const { data: centersData, error: centersError } = await supabaseAdmin
      .from('centers')
      .select('id, name, phone, plan, status, billing_type, is_early_adopter, early_adopter_price, created_at')
      .neq('status', 'deleted')
      .order('created_at', { ascending: false });

    if (centersError) {
      console.error('[admin/overview] ❌ Centers query error:', centersError);
      return NextResponse.json(
        { error: centersError.message || 'Failed to load centers' },
        { status: 500 }
      );
    }
    centers = centersData || [];

    console.log('[admin/overview] 📊 Centers count:', centers.length);

    let totalStudents = 0;
    try {
      const { count: studentsCount, error: studentsError } = await supabaseAdmin
        .from('students')
        .select('id', { count: 'exact', head: true });
      if (!studentsError) totalStudents = studentsCount ?? 0;
    } catch (e) {
      console.warn('[admin/overview] Students count failed:', e);
    }
    console.log('[admin/overview] 📊 Students count:', totalStudents);

    const allCenters = centers as Array<{ id: string; name: string; plan?: string; status?: string; billing_type?: string; is_early_adopter?: boolean; early_adopter_price?: number; created_at?: string }>;
    const activeCenters = allCenters.filter((c: { status?: string }) => c.status === 'active');
    const suspendedCenters = allCenters.filter((c: { status?: string }) => c.status === 'suspended');
    const pendingCenters = allCenters.filter((c: { status?: string }) => c.status === 'pending');
    const activeCentersCount = activeCenters.length;
    const totalCentersCount = allCenters.length;

    const mrrByPlan: Record<string, number> = {
      starter: 0, pro: 0, business: 0, enterprise: 0, top_centers: 0, payg: 0,
    };
    const centersByPlan: Record<string, number> = { starter: 0, pro: 0, business: 0, enterprise: 0, top_centers: 0, payg: 0 };
    const mrr = activeCenters.reduce((sum: number, c: { plan?: string; is_early_adopter?: boolean; early_adopter_price?: number; billing_type?: string }) => {
      const plan = c.plan || 'starter';
      if ((c.billing_type || 'fixed') === 'payg') {
        centersByPlan.payg = (centersByPlan.payg ?? 0) + 1;
        return sum;
      }
      centersByPlan[plan] = (centersByPlan[plan] ?? 0) + 1;
      const amt = c.is_early_adopter && typeof c.early_adopter_price === 'number'
        ? c.early_adopter_price
        : PLAN_MRR[plan] ?? PLAN_MRR.starter;
      mrrByPlan[plan] = (mrrByPlan[plan] ?? 0) + amt;
      return sum + amt;
    }, 0);

    try {
      const paygCenterIds = activeCenters
        .filter((c: { billing_type?: string }) => (c.billing_type || 'fixed') === 'payg')
        .map((c: { id: string }) => c.id);
      if (paygCenterIds.length > 0) {
        const fourWeeksAgo = new Date();
        fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
        const { data: paygCharges } = await supabaseAdmin
          .from('payg_weekly_charges')
          .select('center_id, total_charge')
          .in('center_id', paygCenterIds)
          .gte('week_start_date', fourWeeksAgo.toISOString().slice(0, 10));
        const paygByCenter: Record<string, number[]> = {};
        (paygCharges || []).forEach((c: { center_id: string; total_charge: number }) => {
          if (!paygByCenter[c.center_id]) paygByCenter[c.center_id] = [];
          paygByCenter[c.center_id].push(Number(c.total_charge));
        });
        const MONTHLY_WEEKS = 4.333;
        let paygMRR = 0;
        Object.values(paygByCenter).forEach((charges) => {
          const avgWeekly = charges.length > 0 ? charges.reduce((a, b) => a + b, 0) / charges.length : 0;
          paygMRR += avgWeekly * MONTHLY_WEEKS;
        });
        mrrByPlan.payg = Math.round(paygMRR);
      }
    } catch (paygErr) {
      console.warn('[admin/overview] PAYG query failed (non-fatal):', paygErr);
    }

    const arpuByPlan: Record<string, number> = {};
    for (const plan of Object.keys(mrrByPlan)) {
      const count = centersByPlan[plan] ?? 0;
      arpuByPlan[plan] = count > 0 ? Math.round(mrrByPlan[plan] / count) : 0;
    }

    const activeCenterIds = activeCenters.map((c: { id: string }) => c.id);
    let upgradeOpportunities: { id: string; name: string; plan: string; students: number; limit: number; pct: number }[] = [];
    try {
      if (activeCenterIds.length > 0) {
        const { data: studentsData } = await supabaseAdmin
          .from('students')
          .select('center_id')
          .in('center_id', activeCenterIds);
        const countByCenter: Record<string, number> = {};
        for (const s of studentsData || []) {
          const cid = (s as { center_id: string }).center_id;
          countByCenter[cid] = (countByCenter[cid] ?? 0) + 1;
        }
        for (const c of activeCenters) {
          const plan = (c as { plan?: string }).plan || 'starter';
          const limit = PLAN_STUDENT_LIMITS[plan] ?? 150;
          if (limit >= 999999) continue;
          const students = countByCenter[(c as { id: string }).id] ?? 0;
          const pct = limit > 0 ? (students / limit) * 100 : 0;
          if (pct >= 80) {
            upgradeOpportunities.push({
              id: (c as { id: string }).id,
              name: (c as { name: string }).name,
              plan,
              students,
              limit,
              pct: Math.round(pct),
            });
          }
        }
        upgradeOpportunities = upgradeOpportunities.sort((a, b) => b.pct - a.pct).slice(0, 10);
      }
    } catch (e) {
      console.warn('[admin/overview] Upgrade opportunities query failed (non-fatal):', e);
    }

    const byPlan: Record<string, number> = {
      starter: 0,
      pro: 0,
      business: 0,
      enterprise: 0,
      top_centers: 0,
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

    let pendingPlanRequestsCount = 0;
    let pendingPaymentProofsCount = 0;
    let overdueCenters: unknown[] = [];
    try {
      const pr = await supabaseAdmin.from('plan_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending');
      pendingPlanRequestsCount = pr.count ?? 0;
    } catch {}
    try {
      const inv = await supabaseAdmin.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'pending');
      pendingPaymentProofsCount = inv.count ?? 0;
    } catch {}
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const { data } = await supabaseAdmin.from('centers').select('id, name, next_payment_due').eq('status', 'active').lt('next_payment_due', todayStr);
      overdueCenters = data ?? [];
    } catch {}

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

    // Revenue KPIs (wrapped for resilience - invoices table may differ by deployment)
    let revenueData: Array<{ payment_amount?: number; created_at?: string }> = [];
    let pendingRevenue = 0;
    let churnedThisMonth = 0;
    try {
      const { data: rev } = await supabaseAdmin.from('invoices').select('payment_amount, status, created_at').in('status', ['approved', 'paid']);
      revenueData = rev || [];
    } catch {}
    try {
      const { data: pend } = await supabaseAdmin.from('invoices').select('payment_amount').eq('status', 'pending');
      pendingRevenue = (pend || []).reduce((sum, inv) => sum + Number(inv.payment_amount || 0), 0);
    } catch {}
    try {
      const { count } = await supabaseAdmin.from('centers').select('id', { count: 'exact', head: true }).eq('status', 'suspended');
      churnedThisMonth = count ?? 0;
    } catch {}

    const totalRevenueCollected = revenueData.reduce((sum, inv) => sum + Number(inv.payment_amount || 0), 0);

    const revenueNow = new Date();
    const monthStart = new Date(revenueNow.getFullYear(), revenueNow.getMonth(), 1).toISOString();
    const revenueThisMonth = revenueData
      .filter((inv) => inv.created_at && inv.created_at >= monthStart)
      .reduce((sum, inv) => sum + Number(inv.payment_amount || 0), 0);

    const lastMonthStart = new Date(revenueNow.getFullYear(), revenueNow.getMonth() - 1, 1).toISOString();
    const lastMonthEnd = new Date(revenueNow.getFullYear(), revenueNow.getMonth(), 0).toISOString();
    const revenueLastMonth = revenueData
      .filter((inv) => inv.created_at && inv.created_at >= lastMonthStart && inv.created_at <= lastMonthEnd)
      .reduce((sum, inv) => sum + Number(inv.payment_amount || 0), 0);

    const revenueGrowth = revenueLastMonth > 0
      ? Math.round(((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100)
      : 0;

    const arpc = activeCentersCount > 0 ? Math.round(totalRevenueCollected / activeCentersCount) : 0;

    const monthlyRevenue: { month: string; revenue: number; centers: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const mStart = new Date(revenueNow.getFullYear(), revenueNow.getMonth() - i, 1);
      const mEnd = new Date(revenueNow.getFullYear(), revenueNow.getMonth() - i + 1, 0);
      const mStartStr = mStart.toISOString();
      const mEndStr = mEnd.toISOString();
      const mRevenue = revenueData
        .filter((inv) => inv.created_at && inv.created_at >= mStartStr && inv.created_at <= mEndStr)
        .reduce((sum, inv) => sum + Number(inv.payment_amount || 0), 0);
      monthlyRevenue.push({
        month: mStart.toLocaleDateString('en', { month: 'short', year: '2-digit' }),
        revenue: mRevenue,
        centers: 0,
      });
    }

    const churnRate = totalCentersCount > 0 ? Math.round((churnedThisMonth / totalCentersCount) * 100) : 0;

    const totalMRR = mrr + (mrrByPlan.payg ?? 0);

    const counts = {
      total: allCenters.length,
      active: activeCenters.length,
      pending: pendingCenters.length,
    };

    if (!counts || typeof counts.total !== 'number') {
      console.error('[admin/overview] ❌ No counts calculated');
      return NextResponse.json(
        {
          error: 'Failed to calculate stats',
          totalCenters: 0,
          activeCenters: 0,
          pendingSignups: 0,
          totalMRR: 0,
          totalStudents: 0,
          centers: [],
        },
        { status: 500 }
      );
    }

    console.log('[admin/overview] ✅ Success - returning overview');
    console.log('==========================================');

    return NextResponse.json({
      totalCenters: counts.total,
      activeCenters: counts.active,
      pendingSignups: counts.pending,
      suspendedCenters: suspendedCenters.length,
      pendingCenters: pendingCenters.length,
      totalStudents,
      totalMRR,
      mrr: totalMRR,
      mrrByPlan,
      arpuByPlan,
      upgradeOpportunities,
      byPlan,
      signupsChart,
      pendingSignupsCount: pendingCenters.length,
      pendingPlanRequestsCount: pendingPlanRequestsCount ?? 0,
      pendingPaymentProofsCount: pendingPaymentProofsCount ?? 0,
      overdueCentersCount: Array.isArray(overdueCenters) ? overdueCenters.length : 0,
      overdueCenters: Array.isArray(overdueCenters) ? overdueCenters : [],
      recentActivity,
      totalRevenueCollected,
      revenueThisMonth,
      revenueLastMonth,
      revenueGrowth,
      arpc,
      monthlyRevenue,
      pendingRevenue,
      churnRate,
      churnedCenters: churnedThisMonth,
      internalRole,
      centers: allCenters.slice(0, 10),
    });
  } catch (error) {
    console.error('==========================================');
    console.error('[admin/overview] 💥 CAUGHT ERROR:', error);
    console.error('[admin/overview] Error type:', error?.constructor?.name);
    console.error('[admin/overview] Error message:', error instanceof Error ? error.message : String(error));
    console.error('[admin/overview] Error stack:', error instanceof Error ? error.stack : 'No stack');
    console.error('==========================================');
    const errorMessage = error instanceof Error ? error.message : (typeof error === 'string' ? error : 'Unknown error');
    return NextResponse.json(
      {
        error: errorMessage || 'Internal server error',
        type: error?.constructor?.name,
        stack: process.env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
