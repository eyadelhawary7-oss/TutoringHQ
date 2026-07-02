import { getAdminContext, requireAdminRole } from '@/lib/admin-auth';
import { getActionQueue, getPipelineSummary } from '@/lib/ceo';
import { DEFAULT_RANGE, resolveRange } from '@/lib/ceo-time-range';
import { getCurrentBillingMonth } from '@/lib/parent-pack';
import type {
  CeoActivationCenter,
  CeoCenterHealth,
  CeoCenterHealthTierRow,
  CeoDashboardData,
} from '@/types/ceo';
import { NextRequest, NextResponse } from 'next/server';
import { getImpliedMonthlyMrr, isPlanKey, normalizeBillingPeriod, PLANS, type PlanKey } from '@/lib/pricing';
import { getTeacherDashboardCombined } from '@/lib/ceoTeachers';

export async function GET(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // M1: the CEO dashboard exposes MRR / revenue / health — finance data.
  // Gate to super_admin/accountant (matches ceo/financials + ceo/mrr).
  const denied = requireAdminRole(ctx, ['super_admin', 'accountant']);
  if (denied) return denied;

  const url = new URL(request.url);
  const rawFrom = url.searchParams.get('from');
  const rawTo = url.searchParams.get('to');
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const fallback = resolveRange(DEFAULT_RANGE);

  const fromDate: string =
    rawFrom !== null && DATE_RE.test(rawFrom) ? rawFrom : fallback.from;
  const toDate: string = rawTo !== null && DATE_RE.test(rawTo) ? rawTo : fallback.to;

  const supabase = ctx.supabaseAdmin;
  const now = new Date();
  const todayIso = now.toISOString().split('T')[0];
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
  const quarterStart = new Date(now.getFullYear(), quarterMonth, 1).toISOString();
  const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const currentBillingMonth = getCurrentBillingMonth();

  const monthStartDateStr = monthStart.slice(0, 10);
  const thirtyDaysAgoStr = thirtyDaysAgo.slice(0, 10);

  const results = await Promise.all([
    supabase.from('centers').select('id, created_at, subscription_status, subscription_monthly_fee, early_adopter_price, billing_amount, billing_period, all_in_price, plan', { count: 'exact', head: false }).in('subscription_status', ['active', 'overdue']).eq('status', 'active').eq('is_test', false),
    supabase.from('mrr_snapshots').select('total_mrr, active_centers').order('snapshot_date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('centers').select('id').eq('status', 'active').eq('is_test', false).gte('created_at', new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString()).lt('created_at', new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()),
    supabase.from('centers').select('id').in('subscription_status', ['suspended', 'cancelled']).eq('is_test', false).gte('updated_at', monthStartDateStr),
    supabase.from('payments').select('amount, status, confirmed').gte('paid_at', monthStartDateStr),
    supabase.from('referrals').select('id').not('referrer_center_id', 'is', null),
    supabase.from('centers').select('id, created_at, subscription_status').eq('status', 'active').eq('is_test', false),
    supabase
      .from('centers')
      .select('id, created_at, subscription_status')
      .eq('status', 'active')
      .eq('is_test', false)
      .gte('created_at', `${fromDate}T00:00:00Z`)
      .lte('created_at', `${toDate}T23:59:59Z`),
    supabase.from('centers').select('health_score_band').eq('status', 'active').eq('is_test', false).not('health_score_band', 'is', null),
    supabase
      .from('centers')
      .select(
        'id, name, phone, plan, status, health_score, health_status, health_score_band, subscription_renewal_date, all_in_price, billing_period, onboarding_completed, onboarding_step, district, created_at, next_payment_due, parent_pack_enabled',
      )
      .order('health_score', { ascending: true, nullsFirst: false }),
    supabase.from('admin_payments').select('amount').gte('paid_at', monthStart),
    supabase.from('admin_payments').select('amount').gte('paid_at', quarterStart),
    supabase.from('sales_leads').select('*', { count: 'exact', head: true }).eq('stage', 'trial'),
    supabase.from('admin_alerts').select('*', { count: 'exact', head: true }).eq('is_resolved', false),
    supabase.from('wa_message_queue').select('status').in('status', ['pending', 'failed']),
    supabase.from('platform_config').select('key, value'),
    supabase.from('status_checks').select('service, status, checked_at').order('checked_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('parent_pack_billing').select('amount').eq('month', currentBillingMonth).eq('status', 'charged'),
    supabase.from('attendance_scans').select('center_id').eq('session_date', todayIso),
    supabase.from('attendance_scans').select('center_id'),
    supabase.from('payments').select('center_id'),
  ]).catch((err: unknown) => {
    console.error('[CEO Dashboard] Parallel query failed:', err);
    return null;
  });

  if (!results) {
    return NextResponse.json(
      { error: 'Dashboard data unavailable' },
      { status: 503 },
    );
  }

  const [
    activeCentersRes,
    mrrSnapshotRes,
    newYesterdayRes,
    churnedRes,
    paymentsRes,
    referralsRes,
    cohortRes,
    cohortTableFilteredRes,
    healthRes,
    centersResult,
    cashMtdResult,
    cashQtdResult,
    trialsCountResult,
    alertsCountResult,
    waQueueResult,
    platformConfigResult,
    lastStatusResult,
    packRevenueResult,
    scansTodayResult,
    hasScannedResult,
    hasPaymentResult,
  ] = results;

  const dashboardQueryLabels = [
    'activeCenters',
    'mrrSnapshot',
    'newYesterday',
    'churned',
    'payments',
    'referrals',
    'cohort',
    'cohortTableFiltered',
    'healthBands',
    'centersHealthList',
    'cashMtd',
    'cashQtd',
    'trialsCount',
    'alertsCount',
    'waQueue',
    'platformConfig',
    'lastStatus',
    'packRevenue',
    'scansToday',
    'hasScanned',
    'hasPayment',
  ] as const;
  for (let i = 0; i < results.length; i++) {
    const { error } = results[i];
    if (error) {
      console.error('[CEO Dashboard]', dashboardQueryLabels[i] ?? `q${i}`, error.message);
    }
  }

  const centers = (activeCentersRes.data ?? []) as { id: string; subscription_monthly_fee: number | null; early_adopter_price: number | null; billing_amount: number | null; billing_period?: string | null; all_in_price?: number | null; plan: string | null }[];
  const mrrSnapshot = mrrSnapshotRes.data as { total_mrr?: number; active_centers?: number } | null;
  const newYesterday = (newYesterdayRes.data ?? []).length;
  const churned = (churnedRes.data ?? []).length;
  const payments = (paymentsRes.data ?? []) as { amount: number; status: string; confirmed: boolean }[];
  const referrals = (referralsRes.data ?? []) as { id: string }[];
  const cohortCenters = (cohortRes.data ?? []) as { id: string; created_at: string; subscription_status: string }[];
  const cohortTableCenters = (cohortTableFilteredRes.data ?? []) as {
    id: string;
    created_at: string;
    subscription_status: string;
  }[];
  const healthBands = (healthRes.data ?? []) as { health_score_band: string | null }[];

  const mrr = Number(mrrSnapshot?.total_mrr ?? centers.reduce((s, c) => {
    const pk: PlanKey = isPlanKey(c.plan) ? (c.plan as PlanKey) : 'starter';
    let baseQ = 0;
    if (c.all_in_price != null && Number(c.all_in_price) > 0) {
      baseQ = Number(c.all_in_price);
    } else if (c.billing_amount != null && Number(c.billing_amount) > 0) {
      baseQ = Math.round(Number(c.billing_amount) / 3);
    } else if (typeof c.subscription_monthly_fee === 'number' && c.subscription_monthly_fee > 0) {
      baseQ = c.subscription_monthly_fee;
    } else {
      baseQ = PLANS[pk].quarterlyAllIn;
    }
    const period = normalizeBillingPeriod(c.billing_period);
    const fee = getImpliedMonthlyMrr(baseQ, period, pk);
    return s + Number(fee);
  }, 0));
  const arr = mrr * 12;
  const activeCount = centers.length;

  const netNew30d = cohortCenters.filter((c) => c.created_at >= thirtyDaysAgoStr && ['active', 'overdue'].includes(c.subscription_status ?? '')).length
    - cohortCenters.filter((c) => c.created_at < thirtyDaysAgoStr && ['suspended', 'cancelled'].includes(c.subscription_status ?? '')).length;

  const lastMonthActive = cohortCenters.filter((c) => c.created_at < monthStartDateStr && ['active', 'overdue'].includes(c.subscription_status ?? '')).length;
  const monthlyChurnRate = lastMonthActive > 0 ? (churned / lastMonthActive) * 100 : 0;

  const confirmedPayments = payments.filter((p) => p.status === 'confirmed' || p.status === 'paid' || p.confirmed);
  const collected = confirmedPayments.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const expectedMrr = mrr;
  const collectionRate = expectedMrr > 0 ? (collected / expectedMrr) * 100 : 100;

  const referralRate = activeCount > 0 ? (referrals.length / activeCount) * 100 : 0;

  const bandCounts: Record<string, number> = { Healthy: 0, Engaged: 0, 'At Risk': 0, Critical: 0 };
  for (const b of healthBands) {
    const band = b.health_score_band ?? 'Unknown';
    if (band in bandCounts) bandCounts[band]++;
  }

  const cohortByMonth: Record<string, { total: number; activeByMonth: Record<number, number> }> = {};
  for (const c of cohortTableCenters) {
    const signupMonth = c.created_at.slice(0, 7);
    if (!cohortByMonth[signupMonth]) {
      cohortByMonth[signupMonth] = { total: 0, activeByMonth: {} };
    }
    cohortByMonth[signupMonth].total++;
    const isActive = ['active', 'overdue'].includes(c.subscription_status ?? '');
    if (isActive) {
      const monthsSinceSignup = Math.floor((now.getTime() - new Date(c.created_at).getTime()) / (30 * 24 * 60 * 60 * 1000));
      for (let m = 0; m <= Math.min(monthsSinceSignup, 12); m++) {
        cohortByMonth[signupMonth].activeByMonth[m] = (cohortByMonth[signupMonth].activeByMonth[m] ?? 0) + 1;
      }
    }
  }

  const cohortTable = Object.entries(cohortByMonth)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 12)
    .map(([month, data]) => {
      const row: { month: string; total: number; [k: string]: number | string } = { month, total: data.total };
      for (let m = 0; m <= 6; m++) {
        row[`m${m}`] = data.total > 0 ? Math.round(((data.activeByMonth[m] ?? 0) / data.total) * 100) : 0;
      }
      return row;
    });

  const scansTodayMap = new Map<string, number>();
  for (const row of (scansTodayResult.data ?? []) as { center_id: string }[]) {
    scansTodayMap.set(row.center_id, (scansTodayMap.get(row.center_id) ?? 0) + 1);
  }
  const hasScannedSet = new Set((hasScannedResult.data ?? []).map((r: { center_id: string }) => r.center_id));
  const hasPaymentSet = new Set((hasPaymentResult.data ?? []).map((r: { center_id: string }) => r.center_id));

  const platformConfigMap = (platformConfigResult.data ?? []).reduce<Record<string, unknown>>(
    (acc, row: { key: string; value: unknown }) => {
      acc[row.key] = row.value;
      return acc;
    },
    {},
  );

  const cashMtd = (cashMtdResult.data ?? []).reduce((s, r: { amount: unknown }) => s + Number(r.amount), 0);
  const cashQtd = (cashQtdResult.data ?? []).reduce((s, r: { amount: unknown }) => s + Number(r.amount), 0);
  const packRevenueMtd = (packRevenueResult.data ?? []).reduce((s, r: { amount: unknown }) => s + Number(r.amount), 0);
  const waPending = (waQueueResult.data ?? []).filter((r: { status: string }) => r.status === 'pending').length;
  const waFailed = (waQueueResult.data ?? []).filter((r: { status: string }) => r.status === 'failed').length;

  const liveTrials = trialsCountResult.count ?? 0;
  const openAlerts = alertsCountResult.count ?? 0;

  type CenterRow = {
    id: string;
    name: string;
    phone: string | null;
    plan: string;
    status: string | null;
    health_score: number | null;
    health_status: string | null;
    health_score_band: string | null;
    subscription_renewal_date: string | null;
    all_in_price: number | string | null;
    billing_period: string | null;
    onboarding_completed: boolean | null;
    onboarding_step: number | null;
    district: string | null;
    created_at: string;
    next_payment_due: string | null;
    parent_pack_enabled: boolean | null;
  };

  const allCenters = (centersResult.data ?? []) as CenterRow[];

  const { data: ownerListRaw } = await supabase
    .from('users')
    .select('id, center_id, phone')
    .eq('role', 'owner');

  const ownerByCenter = new Map<string, { id: string; phone: string | null }>();
  for (const r of ownerListRaw ?? []) {
    const row = r as { id: string; center_id: string | null; phone: string | null };
    if (row.center_id && !ownerByCenter.has(row.center_id)) {
      ownerByCenter.set(row.center_id, { id: row.id, phone: row.phone ?? null });
    }
  }

  const MS_DAY = 86_400_000;
  const activeCentersOnly = allCenters.filter((c) => c.status === 'active');

  function pickTierCenters(tier: 'red' | 'amber'): CenterRow[] {
    return activeCentersOnly
      .filter((c) => c.health_status === tier)
      .sort((a, b) => (a.health_score ?? 101) - (b.health_score ?? 101))
      .slice(0, 10);
  }

  async function buildTierRows(rows: CenterRow[]): Promise<CeoCenterHealthTierRow[]> {
    return Promise.all(
      rows.map(async (c) => {
        const o = ownerByCenter.get(c.id);
        let days_since_owner_login: number | null = null;
        if (o?.id) {
          const { data, error } = await supabase.auth.admin.getUserById(o.id);
          if (!error && data?.user?.last_sign_in_at) {
            days_since_owner_login = Math.floor(
              (Date.now() - new Date(data.user.last_sign_in_at).getTime()) / MS_DAY,
            );
          }
        }
        return {
          id: c.id,
          name: c.name,
          plan: c.plan,
          health_score: c.health_score,
          days_since_owner_login,
          owner_phone: o?.phone ?? null,
        };
      }),
    );
  }

  const atRiskCount = allCenters.filter(
    (c) => c.health_score_band === 'At Risk' || c.health_score_band === 'Critical',
  ).length;
  const overdueCount = allCenters.filter(
    (c) => c.next_payment_due && c.next_payment_due < todayIso && c.status === 'active',
  ).length;
  const dueSoonCount = allCenters.filter(
    (c) => c.next_payment_due
      && c.next_payment_due >= todayIso
      && c.next_payment_due <= twoWeeksFromNow,
  ).length;

  const centersHealth: CeoCenterHealth[] = allCenters.slice(0, 50).map((c) => {
    const renewal = c.subscription_renewal_date ?? null;
    let daysToRenewal: number | null = null;
    if (renewal) {
      daysToRenewal = Math.max(
        0,
        Math.ceil((new Date(renewal).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      );
    }
    return {
      id: c.id,
      name: c.name,
      phone: c.phone ?? null,
      plan: c.plan,
      status: c.status ?? 'active',
      health_score: c.health_score ?? null,
      health_score_band: c.health_score_band ?? null,
      scans_today: scansTodayMap.get(c.id) ?? 0,
      renewal_date: renewal,
      days_to_renewal: daysToRenewal,
      district: c.district ?? null,
      all_in_price: c.all_in_price != null ? Number(c.all_in_price) : null,
    };
  });

  const activationCenters: CeoActivationCenter[] = allCenters
    .filter((c) => !c.onboarding_completed || c.created_at >= thirtyDaysAgo)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 20)
    .map((c) => ({
      id: c.id,
      name: c.name,
      plan: c.plan,
      onboarding_step: c.onboarding_step ?? 0,
      onboarding_completed: c.onboarding_completed ?? false,
      has_scanned: hasScannedSet.has(c.id),
      has_payment: hasPaymentSet.has(c.id),
      created_at: c.created_at,
    }));

  const [actionQueue, pipeline, redTierRows, amberTierRows, teacherCombined] = await Promise.all([
    getActionQueue(supabase, 20),
    getPipelineSummary(supabase),
    buildTierRows(pickTierCenters('red')),
    buildTierRows(pickTierCenters('amber')),
    getTeacherDashboardCombined(supabase, mrr),
  ]);

  const center_health_tiers = {
    green: activeCentersOnly.filter((c) => c.health_status === 'green').length,
    amber: activeCentersOnly.filter((c) => c.health_status === 'amber').length,
    red: activeCentersOnly.filter((c) => c.health_status === 'red').length,
    red_centers: redTierRows,
    amber_centers: amberTierRows,
  };

  const newDashboardFields: CeoDashboardData = {
    hero: {
      active_centers: allCenters.filter((c) => c.status === 'active').length,
      cash_collected_mtd: cashMtd,
      live_trials: liveTrials,
      at_risk_centers: atRiskCount,
      open_alerts: openAlerts,
    },
    action_queue: actionQueue,
    pipeline,
    activation: { centers: activationCenters },
    centers_health: centersHealth,
    center_health_tiers,
    cash: {
      collected_this_quarter: cashQtd,
      cash_collected_mtd: cashMtd,
      overdue_count: overdueCount,
      due_soon_count: dueSoonCount,
      pack_revenue_mtd: packRevenueMtd,
      total_centers: allCenters.length,
    },
    ops: {
      wa_queue_pending: waPending,
      wa_queue_failed: waFailed,
      platform_config: platformConfigMap,
      last_status_check: lastStatusResult.data
        ? {
            service: lastStatusResult.data.service,
            status: lastStatusResult.data.status,
            checked_at: lastStatusResult.data.checked_at,
          }
        : null,
    },
    teacher_combined: teacherCombined,
  };

  const legacyPayload = {
    totalActiveCenters: activeCount,
    mrr,
    arr,
    netNew30d,
    monthlyChurnRate,
    collectionRate,
    referralRate,
    newYesterday,
    churned,
    atRisk: bandCounts['At Risk'] + bandCounts.Critical,
    healthDistribution: [
      { name: 'Healthy', value: bandCounts.Healthy, color: '#10b981' },
      { name: 'Engaged', value: bandCounts.Engaged, color: '#0d9488' },
      { name: 'At Risk', value: bandCounts['At Risk'], color: '#f59e0b' },
      { name: 'Critical', value: bandCounts.Critical, color: '#ef4444' },
    ].filter((d) => d.value > 0),
    cohortTable,
  };

  return NextResponse.json({
    ...legacyPayload,
    ...newDashboardFields,
  });
}
