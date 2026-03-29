import { requireSuperAdminApi } from '@/lib/admin-auth';
import type { FinancialsResponse, MonthlyRevenue } from '@/types/financials';
import { NextRequest } from 'next/server';

/*
  Required env vars (set in Vercel dashboard and .env.local):
  MONTHLY_FIXED_COSTS_EGP  — default 2500
  CARD_COGS_EGP            — default 0, set to actual print cost per card
                             once printer deal is signed. No code change needed.
*/

type MrrRow = { date: string | null; mrr: number | string | null };

function latestMrrInMonth(rows: MrrRow[], startYmd: string, endYmd: string): number | null {
  const inRange = rows.filter(
    (r) => r.date != null && String(r.date) >= startYmd && String(r.date) < endYmd,
  );
  if (inRange.length === 0) return null;
  let best = inRange[0];
  for (const r of inRange) {
    if (String(r.date) > String(best.date)) best = r;
  }
  return Number(best.mrr ?? 0);
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) {
    return auth.response;
  }

  const supabaseAdmin = auth.supabaseAdmin;

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonthIndex = now.getUTCMonth();

  const monthStartUTC = (year: number, month: number): string =>
    new Date(Date.UTC(year, month, 1)).toISOString();

  const nextMonthStartUTC = (year: number, month: number): string =>
    new Date(Date.UTC(year, month + 1, 1)).toISOString();

  const thisMonthStart = monthStartUTC(currentYear, currentMonthIndex);
  const thisMonthEnd = nextMonthStartUTC(currentYear, currentMonthIndex);
  const twelveMonthsAgo = monthStartUTC(currentYear, currentMonthIndex - 11);

  const twelveMonthsAgoYmd = twelveMonthsAgo.slice(0, 10);
  const thisMonthEndYmd = thisMonthEnd.slice(0, 10);

  const [
    activeCentersRes,
    mrrHistoryRes,
    paidWindowRes,
    allTimePaidRes,
    pendingOrdersRes,
    paidOrdersRes,
  ] = await Promise.all([
    supabaseAdmin
      .from('centers')
      .select('id, subscription_monthly_fee')
      .in('subscription_status', ['active', 'overdue'])
      .eq('status', 'active'),
    supabaseAdmin
      .from('mrr_snapshots')
      .select('date, mrr')
      .gte('date', twelveMonthsAgoYmd)
      .lt('date', thisMonthEndYmd),
    supabaseAdmin
      .from('card_orders')
      .select('total_amount, quantity, created_at')
      .eq('payment_status', 'paid')
      .gte('created_at', twelveMonthsAgo)
      .lt('created_at', thisMonthEnd),
    supabaseAdmin.from('card_orders').select('total_amount, quantity').eq('payment_status', 'paid'),
    supabaseAdmin
      .from('card_orders')
      .select('id', { count: 'exact', head: true })
      .eq('payment_status', 'unpaid')
      .neq('status', 'cancelled'),
    supabaseAdmin
      .from('card_orders')
      .select('id', { count: 'exact', head: true })
      .eq('payment_status', 'paid'),
  ]);

  const activeCentersData = activeCentersRes.data;
  const activeCenterIds: string[] = activeCentersData?.map((c) => c.id) ?? [];

  const mrrRows: MrrRow[] =
    !mrrHistoryRes.error && mrrHistoryRes.data ? (mrrHistoryRes.data as MrrRow[]) : [];

  const allPaidCardOrders = paidWindowRes.data;
  const allTimePaidOrders = allTimePaidRes.data;
  const pendingOrdersCount = pendingOrdersRes.count;
  const paidOrdersCount = paidOrdersRes.count;

  const proxySubRevenue =
    activeCentersData?.reduce((s, c) => s + Number(c.subscription_monthly_fee ?? 0), 0) ?? 0;

  const cmSubRevenue = proxySubRevenue;

  const cmCardRevenue = (allPaidCardOrders ?? [])
    .filter(
      (o) =>
        o.created_at != null &&
        o.created_at >= thisMonthStart &&
        o.created_at < thisMonthEnd,
    )
    .reduce((s, o) => s + Number(o.total_amount ?? 0), 0);

  let cmWaRevenue = 0;
  let activeParentsCount = 0;
  if (activeCenterIds.length > 0) {
    const { count: parentCount } = await supabaseAdmin
      .from('students')
      .select('id', { count: 'exact', head: true })
      .or('notify_on_scan.eq.true,notify_on_absence.eq.true,notify_on_balance.eq.true')
      .eq('is_active', true)
      .in('center_id', activeCenterIds);
    activeParentsCount = parentCount ?? 0;
    cmWaRevenue = activeParentsCount * 10;
  }

  const cmTotalRevenue = cmSubRevenue + cmCardRevenue + cmWaRevenue;

  const fixedCosts = parseFloat(process.env.MONTHLY_FIXED_COSTS_EGP ?? '2500');

  const cardCogs = parseFloat(process.env.CARD_COGS_EGP ?? '0');

  const cmTotalQty = (allPaidCardOrders ?? [])
    .filter(
      (o) =>
        o.created_at != null &&
        o.created_at >= thisMonthStart &&
        o.created_at < thisMonthEnd,
    )
    .reduce((s, o) => s + (o.quantity ?? 0), 0);
  const variableCosts = cmTotalQty * cardCogs;

  const grossProfit = cmTotalRevenue - fixedCosts - variableCosts;
  const profitMargin = cmTotalRevenue > 0 ? (grossProfit / cmTotalRevenue) * 100 : 0;

  const months: MonthlyRevenue[] = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(currentYear, currentMonthIndex - i, 1));
    const loopYear = d.getUTCFullYear();
    const loopMonth = d.getUTCMonth();
    const loopStart = monthStartUTC(loopYear, loopMonth);
    const loopEnd = nextMonthStartUTC(loopYear, loopMonth);
    const loopLabel = d.toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });

    const loopStartYmd = loopStart.slice(0, 10);
    const loopEndYmd = loopEnd.slice(0, 10);

    const fromSnapshot = latestMrrInMonth(mrrRows, loopStartYmd, loopEndYmd);
    const loopSubRevenue = fromSnapshot ?? proxySubRevenue;

    const loopCardRevenue = (allPaidCardOrders ?? [])
      .filter(
        (o) =>
          o.created_at != null && o.created_at >= loopStart && o.created_at < loopEnd,
      )
      .reduce((s, o) => s + Number(o.total_amount ?? 0), 0);

    const loopWaRevenue = 0;

    const loopTotal = loopSubRevenue + loopCardRevenue + loopWaRevenue;

    months.push({
      month: loopLabel,
      subscriptionRevenue: loopSubRevenue,
      cardOrderRevenue: loopCardRevenue,
      whatsappPackRevenue: loopWaRevenue,
      totalRevenue: loopTotal,
    });
  }

  const revenueAllTime = (allTimePaidOrders ?? []).reduce(
    (s, o) => s + Number(o.total_amount ?? 0),
    0,
  );

  const totalCardsSold = (allTimePaidOrders ?? []).reduce(
    (s, o) => s + (o.quantity ?? 0),
    0,
  );

  const revenueThisMonth = (allPaidCardOrders ?? [])
    .filter(
      (o) =>
        o.created_at != null &&
        o.created_at >= thisMonthStart &&
        o.created_at < thisMonthEnd,
    )
    .reduce((s, o) => s + Number(o.total_amount ?? 0), 0);

  const paidOrders = paidOrdersCount ?? 0;
  const pendingOrders = pendingOrdersCount ?? 0;
  const averageOrderValue = paidOrders > 0 ? revenueAllTime / paidOrders : 0;

  const packMRR = activeParentsCount * 10;
  const growthVsLastMonth = 0;

  const currentYearRevenue = months
    .filter((m) => m.month.includes(String(currentYear)))
    .reduce((sum, m) => sum + m.totalRevenue, 0);

  const projectedARR = cmTotalRevenue * 12;

  const nonZeroMonths = months.filter((m) => m.totalRevenue > 0);
  let bestMonth: string | null = null;
  let worstMonth: string | null = null;
  if (nonZeroMonths.length > 0) {
    bestMonth = nonZeroMonths.reduce((a, b) =>
      a.totalRevenue >= b.totalRevenue ? a : b,
    ).month;
    worstMonth = nonZeroMonths.reduce((a, b) =>
      a.totalRevenue <= b.totalRevenue ? a : b,
    ).month;
  }

  return Response.json({
    currentMonth: {
      subscriptionRevenue: cmSubRevenue,
      cardOrderRevenue: cmCardRevenue,
      whatsappPackRevenue: cmWaRevenue,
      totalRevenue: cmTotalRevenue,
      fixedCosts,
      variableCosts,
      grossProfit,
      profitMargin,
    },
    monthly: months,
    cardOrders: {
      totalCardsSold,
      revenueAllTime,
      revenueThisMonth,
      averageOrderValue,
      pendingOrders,
      paidOrders,
    },
    whatsappPack: {
      activeParents: activeParentsCount,
      packMRR,
      growthVsLastMonth,
    },
    annualView: {
      currentYearRevenue,
      projectedARR,
      bestMonth,
      worstMonth,
    },
  } satisfies FinancialsResponse);
}
