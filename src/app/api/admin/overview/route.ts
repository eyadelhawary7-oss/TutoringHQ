import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/auth-helpers-nextjs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getAdminContext } from '@/lib/admin-auth';
import { isSuperAdminPhone } from '@/lib/admin-access';
import { fetchCustomerSplit, buildRevenueMix, fetchPaidInvoicesForMonth } from '@/lib/adminCustomerSplit';
import { cairoMonthBounds } from '@/lib/referralProgram';
import { phoneFromCenterhqAuthEmail } from '@/lib/ownerPhone';
import { PLAN_STUDENT_LIMITS } from '@/lib/plans';
import { getImpliedMonthlyMrr, isCenterEligibleForSubscriptionMrr } from '@/lib/pricing';
import { parseIncludeTestCenters } from '@/lib/adminIncludeTest';
import { computeSubscriptionTotalMrrRounded } from '@/lib/adminSubscriptionMrr';

export async function GET(request: Request) {
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
    // Raw admin_users.role so we can gate roles that collapse to internal_viewer
    // (e.g. accountant). null for SUPER_ADMIN_PHONES super-admins.
    let adminRole: string | null = null;

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
      const { data: { session } } = await supabase.auth.getSession();
      if (session && supabaseServiceKey) {
        const userId = session.user.id;
        const adminClient = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data: adminUser } = await adminClient.from('admin_users').select('id, role').eq('id', userId).single();
        const { data: userRecord } = await adminClient.from('users').select('phone').eq('id', userId).single();
        // Phone source: auth.users.email local-part first (`<digits>@centerhq.local`,
        // server-set, not writable via the /api/db proxy), then auth.users.phone, then
        // public.users.phone (centre-tenant data, defence-in-depth only). Compare with the
        // shared normalized isSuperAdminPhone so a `+`-prefixed SUPER_ADMIN_PHONES entry still
        // matches the digits-only email phone. Mirrors admin-auth.ts / centerAuth.ts.
        const emailPhone = phoneFromCenterhqAuthEmail(session.user.email);
        const userPhone = emailPhone ?? session.user.phone ?? userRecord?.phone ?? null;
        const isPhoneAdmin = isSuperAdminPhone(userPhone);
        if (adminUser || isPhoneAdmin) {
          supabaseAdmin = adminClient;
          internalRole = isPhoneAdmin || adminUser?.role === 'super_admin' || adminUser?.role === 'admin' ? 'super_admin' : (adminUser?.role === 'internal_admin' ? 'internal_admin' : 'internal_viewer');
          adminRole = adminUser?.role ?? null;
        }
      }
    }

    // Fallback: Authorization header (Bearer token) via getAdminContext
    if (!supabaseAdmin) {
      const ctx = await getAdminContext(request);
      if (ctx) {
        supabaseAdmin = ctx.supabaseAdmin;
        internalRole = ctx.internalRole;
        adminRole = ctx.adminRole;
      }
    }

    if (!supabaseAdmin) {
      console.error('[admin/overview] ❌ Unauthorized: no valid session or admin access');
      return NextResponse.json({ error: 'Unauthorized - admin access required' }, { status: 401 });
    }

    // PDPL gate: aggregate centre data (names, phones, plans, prices) is
    // accountant-and-above only. Roles collapsing to internal_viewer
    // (sales_rep / support_agent / custom) must not read this.
    const FINANCE_GATE: ReadonlyArray<string> = [
      'super_admin',
      'admin',
      'internal_admin',
      'accountant',
    ];
    const isAllowed =
      internalRole === 'super_admin' ||
      internalRole === 'internal_admin' ||
      (adminRole !== null && FINANCE_GATE.includes(adminRole));
    if (!isAllowed) {
      return NextResponse.json(
        {
          error: 'insufficient_admin_role',
          required: FINANCE_GATE,
          current: internalRole,
        },
        { status: 403 },
      );
    }

    const includeTestCenters = parseIncludeTestCenters(request);

    let centers: unknown[] = [];
    let centersQuery = supabaseAdmin
      .from('centers')
      .select('id, name, phone, plan, status, billing_type, billing_period, all_in_price, is_early_adopter, early_adopter_price, created_at, is_test')
      .neq('status', 'deleted')
      .order('created_at', { ascending: false });
    if (!includeTestCenters) {
      centersQuery = centersQuery.eq('is_test', false);
    }
    const { data: centersData, error: centersError } = await centersQuery;

    if (centersError) {
      console.error('[admin/overview] ❌ Centers query error:', centersError);
      return NextResponse.json(
        { error: centersError.message || 'Failed to load centers' },
        { status: 500 }
      );
    }
    centers = centersData || [];

    let totalStudents = 0;
    try {
      const { count: studentsCount, error: studentsError } = await supabaseAdmin
        .from('students')
        .select('id', { count: 'exact', head: true });
      if (!studentsError) totalStudents = studentsCount ?? 0;
    } catch (e) {
      console.warn('[admin/overview] Students count failed:', e);
    }

    const allCenters = centers as Array<{
      id: string;
      name: string;
      plan?: string;
      status?: string;
      billing_type?: string;
      billing_period?: string | null;
      all_in_price?: number | null;
      is_early_adopter?: boolean;
      early_adopter_price?: number;
      created_at?: string;
      is_test?: boolean | null;
    }>;
    const activeCenters = allCenters.filter((c: { status?: string }) => c.status === 'active');
    const suspendedCenters = allCenters.filter((c: { status?: string }) => c.status === 'suspended');
    const pendingCenters = allCenters.filter((c: { status?: string }) => c.status === 'pending');
    const activeCentersCount = activeCenters.length;
    const totalCentersCount = allCenters.length;

    /** Same cohort as finance north-star MRR (excludes suspended/churned/etc.; includes pending when paying). */
    const subscriptionMrrCenters = allCenters.filter((c) =>
      isCenterEligibleForSubscriptionMrr({ status: c.status, is_test: c.is_test }),
    );

    const mrrByPlan: Record<string, number> = {
      solo: 0,
      nano: 0,
      starter: 0,
      pro: 0,
      business: 0,
      enterprise: 0,
      top_centers: 0,
    };
    const centersByPlan: Record<string, number> = {
      solo: 0,
      nano: 0,
      starter: 0,
      pro: 0,
      business: 0,
      enterprise: 0,
      top_centers: 0,
    };
    for (const c of subscriptionMrrCenters) {
      const plan = c.plan || 'starter';
      centersByPlan[plan] = (centersByPlan[plan] ?? 0) + 1;
      const amt = getImpliedMonthlyMrr({
        plan: c.plan,
        all_in_price: c.all_in_price,
        billing_period: c.billing_period,
        status: c.status,
        billing_type: c.billing_type,
        is_early_adopter: c.is_early_adopter,
        early_adopter_price: c.early_adopter_price,
        id: c.id,
        is_test: c.is_test,
      });
      mrrByPlan[plan] = (mrrByPlan[plan] ?? 0) + amt;
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
    const allowedCenterIds = new Set(allCenters.map((c) => c.id));

    try {
      const todayStr = new Date().toISOString().split('T')[0];
      let overdueQ = supabaseAdmin
        .from('centers')
        .select('id, name, next_payment_due')
        .eq('status', 'active')
        .lt('next_payment_due', todayStr);
      if (!includeTestCenters) overdueQ = overdueQ.eq('is_test', false);
      const { data } = await overdueQ;
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
    let revenueData: Array<{ payment_amount?: number; created_at?: string; center_id?: string | null }> = [];
    let pendingRevenue = 0;
    let churnedThisMonth = 0;
    try {
      const { data: rev } = await supabaseAdmin
        .from('invoices')
        .select('payment_amount, status, created_at, center_id')
        .in('status', ['approved', 'paid']);
      const raw = rev || [];
      revenueData = includeTestCenters
        ? raw
        : raw.filter((inv) => inv.center_id && allowedCenterIds.has(String(inv.center_id)));
    } catch {}
    try {
      const { data: pend } = await supabaseAdmin
        .from('invoices')
        .select('payment_amount, center_id')
        .eq('status', 'pending');
      const rawP = pend || [];
      const filtered = includeTestCenters
        ? rawP
        : rawP.filter((inv) => inv.center_id && allowedCenterIds.has(String(inv.center_id)));
      pendingRevenue = filtered.reduce((sum, inv) => sum + Number(inv.payment_amount || 0), 0);
    } catch {}
    try {
      let churnQ = supabaseAdmin.from('centers').select('id', { count: 'exact', head: true }).eq('status', 'suspended');
      if (!includeTestCenters) churnQ = churnQ.eq('is_test', false);
      const { count } = await churnQ;
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
        month: `${mStart.getFullYear()}-${String(mStart.getMonth() + 1).padStart(2, '0')}`,
        revenue: mRevenue,
        centers: 0,
      });
    }

    const totalMRR = computeSubscriptionTotalMrrRounded(allCenters);

    const churnRate = totalCentersCount > 0 ? Math.round((churnedThisMonth / totalCentersCount) * 100) : 0;

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

    // ── Merged-Admin-Platform §01 ────────────────────────────────────────────
    //
    // CUSTOMERS splits accounts / students / revenue across the two customer
    // types. TutoringHQ serves centres AND solo teachers; this API only ever
    // knew about centres, which is why the design's lead block had nothing
    // behind it.
    //
    // ⚠ The centre student figure filters `center_id is not null`.
    // `students.center_id` is NULLABLE and a solo teacher's students are rows
    // with no centre (private student_groups carry center_id NULL). The
    // unfiltered `totalStudents` above is the correct TOTAL for the "Active
    // students" tile, but using it as the centre row would absorb the teacher
    // row and the split would double-count.
    //
    // "On trial" for a centre is the summer promo: centers.status has no
    // 'trial' value (pending|active|suspended|rejected|pending_payment|dormant),
    // and summer_status='enrolled' is the live free-trial state.
    const { thisMonthStart, nextMonthStart } = cairoMonthBounds();

    let customerSplit = null;
    let revenueMix = null;
    let withdrawalsPendingCount = 0;
    try {
      const { count: centreStudentCount } = await supabaseAdmin
        .from('students')
        .select('id', { count: 'exact', head: true })
        .not('center_id', 'is', null)
        .eq('is_active', true);

      const centreNewThisMonth = allCenters.filter(
        (c) => c.created_at && new Date(c.created_at as string) >= thisMonthStart,
      ).length;

      const { count: centreOnTrial } = await supabaseAdmin
        .from('centers')
        .select('id', { count: 'exact', head: true })
        .eq('summer_status', 'enrolled')
        .eq('is_test', false);

      customerSplit = await fetchCustomerSplit(
        supabaseAdmin,
        {
          accounts: counts.active,
          students: centreStudentCount ?? 0,
          mrr: totalMRR,
          newThisMonth: centreNewThisMonth,
          onTrial: centreOnTrial ?? 0,
        },
        thisMonthStart,
      );

      revenueMix = buildRevenueMix(
        await fetchPaidInvoicesForMonth(supabaseAdmin, thisMonthStart, nextMonthStart),
      );

      // JUMP TO · Withdrawals carries a count in the design.
      const { count: pendingWithdrawals } = await supabaseAdmin
        .from('withdrawal_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      withdrawalsPendingCount = pendingWithdrawals ?? 0;
    } catch {
      // A split failure must not take the whole overview down with it.
      customerSplit = null;
      revenueMix = null;
    }

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
      customerSplit,
      revenueMix,
      withdrawalsPendingCount,
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
