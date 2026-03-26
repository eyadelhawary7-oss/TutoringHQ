import { getAdminContext } from '@/lib/admin-auth';
import { NextRequest, NextResponse } from 'next/server';
import { getImpliedMonthlyMrr, isPlanKey, normalizeBillingPeriod, PLANS, type PlanKey } from '@/lib/pricing';

export async function GET(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = ctx.supabaseAdmin;
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);

  const [
    activeCentersRes,
    mrrSnapshotRes,
    newYesterdayRes,
    churnedRes,
    paymentsRes,
    referralsRes,
    cohortRes,
    healthRes,
  ] = await Promise.all([
    supabase.from('centers').select('id, created_at, subscription_status, subscription_monthly_fee, early_adopter_price, billing_amount, billing_period, all_in_price, plan', { count: 'exact', head: false }).in('subscription_status', ['active', 'overdue']).eq('status', 'active'),
    supabase.from('mrr_snapshots').select('mrr, active_centers').order('date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('centers').select('id').eq('status', 'active').gte('created_at', new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString()).lt('created_at', new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()),
    supabase.from('centers').select('id').in('subscription_status', ['suspended', 'cancelled']).gte('updated_at', monthStart),
    supabase.from('payments').select('amount, status, confirmed').gte('paid_at', monthStart),
    supabase.from('referrals').select('id').not('referrer_center_id', 'is', null),
    supabase.from('centers').select('id, created_at, subscription_status').eq('status', 'active'),
    supabase.from('centers').select('health_score_band').eq('status', 'active').not('health_score_band', 'is', null),
  ]);

  const centers = (activeCentersRes.data ?? []) as { id: string; subscription_monthly_fee: number | null; early_adopter_price: number | null; billing_amount: number | null; billing_period?: string | null; all_in_price?: number | null; plan: string | null }[];
  const mrrSnapshot = mrrSnapshotRes.data as { mrr?: number; active_centers?: number } | null;
  const newYesterday = (newYesterdayRes.data ?? []).length;
  const churned = (churnedRes.data ?? []).length;
  const payments = (paymentsRes.data ?? []) as { amount: number; status: string; confirmed: boolean }[];
  const referrals = (referralsRes.data ?? []) as { id: string }[];
  const allCenters = (cohortRes.data ?? []) as { id: string; created_at: string; subscription_status: string }[];
  const healthBands = (healthRes.data ?? []) as { health_score_band: string | null }[];

  const mrr = mrrSnapshot?.mrr ?? centers.reduce((s, c) => {
    const pk: PlanKey = isPlanKey(c.plan) ? (c.plan as PlanKey) : 'starter';
    const baseQ =
      c.all_in_price != null && Number(c.all_in_price) > 0
        ? Number(c.all_in_price)
        : typeof c.early_adopter_price === 'number' && c.early_adopter_price > 0
          ? c.early_adopter_price
          : typeof c.subscription_monthly_fee === 'number' && c.subscription_monthly_fee > 0
            ? c.subscription_monthly_fee
            : c.billing_amount != null
              ? Number(c.billing_amount)
              : PLANS[pk].quarterlyAllIn;
    const period = normalizeBillingPeriod(c.billing_period);
    const fee = getImpliedMonthlyMrr(baseQ, period);
    return s + Number(fee);
  }, 0);
  const arr = mrr * 12;
  const activeCount = centers.length;

  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().slice(0, 10);
  const netNew30d = allCenters.filter((c) => c.created_at >= thirtyDaysAgoStr && ['active', 'overdue'].includes(c.subscription_status ?? '')).length
    - allCenters.filter((c) => c.created_at < thirtyDaysAgoStr && ['suspended', 'cancelled'].includes(c.subscription_status ?? '')).length;

  const lastMonthActive = allCenters.filter((c) => c.created_at < monthStart && ['active', 'overdue'].includes(c.subscription_status ?? '')).length;
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
  for (const c of allCenters) {
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

  return NextResponse.json({
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
  });
}
