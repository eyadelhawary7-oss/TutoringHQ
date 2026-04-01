import { requireSuperAdminApi } from '@/lib/admin-auth';
import { resolveRange } from '@/lib/ceo-time-range';
import type { FinancialsResponse, MonthlyRevenue } from '@/types/financials';
import { NextRequest } from 'next/server';

/*
  Required env vars (set in Vercel dashboard and .env.local):
  MONTHLY_FIXED_COSTS_EGP  — default 2500
  CARD_COGS_EGP            — default 0, set to actual print cost per card
                             once printer deal is signed. No code change needed.
*/

type InvoiceRow = {
  id?: string;
  billing_period_start: string | null;
  paid_at: string | null;
  total_amount: number | string | null;
  invoice_type: string | null;
  status: string;
};

type CardOrderRow = {
  total_amount: number | string | null;
  quantity: number | string | null;
  created_at: string;
};

type PackRow = {
  id?: string;
  month: string | null;
  amount: number | string | null;
  charged_at: string | null;
};

function safeNum(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function invoiceDayYmd(inv: InvoiceRow): string {
  if (inv.paid_at) {
    return new Date(inv.paid_at).toISOString().slice(0, 10);
  }
  return String(inv.billing_period_start ?? '').slice(0, 10);
}

function packDayYmd(p: PackRow): string {
  if (p.charged_at) {
    return new Date(p.charged_at).toISOString().slice(0, 10);
  }
  return String(p.month ?? '').slice(0, 10);
}

function utcMonthsInclusive(
  fromYmd: string,
  toYmd: string,
): Array<{ startYmd: string; nextYmd: string; label: string }> {
  const [fy, fm] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd.split('-').map(Number);
  const end = Date.UTC(ty, tm - 1, td);
  const result: Array<{ startYmd: string; nextYmd: string; label: string }> = [];
  let cy = fy;
  let cm0 = fm - 1;
  for (;;) {
    const start = Date.UTC(cy, cm0, 1);
    if (start > end) break;
    const d0 = new Date(start);
    const next = new Date(Date.UTC(cy, cm0 + 1, 1));
    result.push({
      startYmd: d0.toISOString().slice(0, 10),
      nextYmd: next.toISOString().slice(0, 10),
      label: d0.toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    });
    cm0++;
    if (cm0 > 11) {
      cm0 = 0;
      cy++;
    }
  }
  return result;
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) {
    return auth.response;
  }

  const supabaseAdmin = auth.supabaseAdmin;

  const url = new URL(request.url);
  const rawFrom = url.searchParams.get('from');
  const rawTo = url.searchParams.get('to');
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const fallback = resolveRange('this_month');

  const fromDate: string =
    rawFrom !== null && DATE_RE.test(rawFrom) ? rawFrom : fallback.from;
  const toDate: string = rawTo !== null && DATE_RE.test(rawTo) ? rawTo : fallback.to;

  const createdFrom = `${fromDate}T00:00:00.000Z`;
  const createdTo = `${toDate}T23:59:59.999Z`;

  const [
    activeCentersRes,
    invoicesPaidAtRes,
    invoicesFallbackRes,
    cardOrdersRangeRes,
    packBillingChargedAtRes,
    packBillingLegacyRes,
    allTimePaidRes,
    pendingOrdersRes,
    paidOrdersRes,
  ] = await Promise.all([
    supabaseAdmin
      .from('centers')
      .select('id')
      .in('subscription_status', ['active', 'overdue'])
      .eq('status', 'active'),
    supabaseAdmin
      .from('invoices')
      .select('id, billing_period_start, paid_at, total_amount, invoice_type, status')
      .not('paid_at', 'is', null)
      .gte('paid_at', createdFrom)
      .lte('paid_at', createdTo)
      .in('status', ['paid', 'approved']),
    supabaseAdmin
      .from('invoices')
      .select('id, billing_period_start, paid_at, total_amount, invoice_type, status')
      .is('paid_at', null)
      .gte('billing_period_start', fromDate)
      .lte('billing_period_start', toDate)
      .in('status', ['paid', 'approved']),
    supabaseAdmin
      .from('card_orders')
      .select('total_amount, quantity, created_at')
      .eq('payment_status', 'paid')
      .gte('created_at', createdFrom)
      .lte('created_at', createdTo),
    supabaseAdmin
      .from('parent_pack_billing')
      .select('id, month, amount, charged_at')
      .eq('status', 'charged')
      .not('charged_at', 'is', null)
      .gte('charged_at', createdFrom)
      .lte('charged_at', createdTo),
    supabaseAdmin
      .from('parent_pack_billing')
      .select('id, month, amount, charged_at')
      .eq('status', 'charged')
      .is('charged_at', null)
      .gte('month', fromDate)
      .lte('month', toDate),
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

  let activeParentsCount = 0;
  if (activeCenterIds.length > 0) {
    const { count: parentCount } = await supabaseAdmin
      .from('students')
      .select('id', { count: 'exact', head: true })
      .or('notify_on_scan.eq.true,notify_on_absence.eq.true,notify_on_balance.eq.true')
      .eq('is_active', true)
      .in('center_id', activeCenterIds);
    activeParentsCount = safeNum(parentCount ?? 0);
  }

  const invPaidRows: InvoiceRow[] =
    !invoicesPaidAtRes.error && invoicesPaidAtRes.data
      ? (invoicesPaidAtRes.data as InvoiceRow[])
      : [];
  const invFallbackRows: InvoiceRow[] =
    !invoicesFallbackRes.error && invoicesFallbackRes.data
      ? (invoicesFallbackRes.data as InvoiceRow[])
      : [];
  const invById = new Map<string, InvoiceRow>();
  for (const inv of [...invPaidRows, ...invFallbackRows]) {
    const key = inv.id ?? `${invoiceDayYmd(inv)}-${inv.total_amount}-${inv.invoice_type}`;
    invById.set(key, inv);
  }
  const invoiceRows: InvoiceRow[] = Array.from(invById.values());

  const cardRangeRows: CardOrderRow[] =
    !cardOrdersRangeRes.error && cardOrdersRangeRes.data
      ? (cardOrdersRangeRes.data as CardOrderRow[])
      : [];
  const packChargedRows: PackRow[] =
    !packBillingChargedAtRes.error && packBillingChargedAtRes.data
      ? (packBillingChargedAtRes.data as PackRow[])
      : [];
  const packLegacyRows: PackRow[] =
    !packBillingLegacyRes.error && packBillingLegacyRes.data
      ? (packBillingLegacyRes.data as PackRow[])
      : [];
  const packByKey = new Map<string, PackRow>();
  for (const p of [...packChargedRows, ...packLegacyRows]) {
    const key = p.id ?? `${packDayYmd(p)}|${p.amount}`;
    packByKey.set(key, p);
  }
  const packRows: PackRow[] = Array.from(packByKey.values());
  const allPaidCardOrders = allTimePaidRes.data as CardOrderRow[] | null;
  const pendingOrdersCount = pendingOrdersRes.count;
  const paidOrdersCount = paidOrdersRes.count;

  const invoicesInRange = invoiceRows;

  let cmSubRevenue = 0;
  let cmInvoiceWa = 0;
  for (const inv of invoicesInRange) {
    const amt = safeNum(inv.total_amount);
    if (inv.invoice_type === 'whatsapp_addon') {
      cmInvoiceWa += amt;
    } else {
      cmSubRevenue += amt;
    }
  }

  const cmCardRevenue = safeNum(
    cardRangeRows.reduce((s, o) => s + safeNum(o.total_amount), 0),
  );

  const cmPackRevenue = safeNum(packRows.reduce((s, p) => s + safeNum(p.amount), 0));

  const cmWaRevenue = safeNum(cmInvoiceWa + cmPackRevenue);

  const cmTotalRevenue = safeNum(cmSubRevenue + cmCardRevenue + cmWaRevenue);

  const fixedCostsPerMonth = safeNum(parseFloat(process.env.MONTHLY_FIXED_COSTS_EGP ?? '2500'));
  const monthBuckets = utcMonthsInclusive(fromDate, toDate);
  const monthCount = Math.max(1, monthBuckets.length);
  const fixedCosts = safeNum(fixedCostsPerMonth * monthCount);

  const cardCogs = safeNum(parseFloat(process.env.CARD_COGS_EGP ?? '0'));
  const cmTotalQty = safeNum(
    cardRangeRows.reduce((s, o) => s + safeNum(o.quantity), 0),
  );
  const variableCosts = safeNum(cmTotalQty * cardCogs);

  const months: MonthlyRevenue[] = [];

  for (const bucket of monthBuckets) {
    const { startYmd, nextYmd, label } = bucket;
    const startIso = `${startYmd}T00:00:00.000Z`;
    const nextIso = `${nextYmd}T00:00:00.000Z`;

    let loopSub = 0;
    let loopInvWa = 0;
    for (const inv of invoicesInRange) {
      const b = invoiceDayYmd(inv);
      if (b >= startYmd && b < nextYmd) {
        const amt = safeNum(inv.total_amount);
        if (inv.invoice_type === 'whatsapp_addon') {
          loopInvWa += amt;
        } else {
          loopSub += amt;
        }
      }
    }

    const loopCardRevenue = safeNum(
      cardRangeRows
        .filter((o) => o.created_at >= startIso && o.created_at < nextIso)
        .reduce((s, o) => s + safeNum(o.total_amount), 0),
    );

    const loopPack = safeNum(
      packRows
        .filter((p) => {
          const d = packDayYmd(p);
          return d >= startYmd && d < nextYmd;
        })
        .reduce((s, p) => s + safeNum(p.amount), 0),
    );

    const loopWaRevenue = safeNum(loopInvWa + loopPack);

    const loopTotal = safeNum(loopSub + loopCardRevenue + loopWaRevenue);

    months.push({
      month: label,
      subscriptionRevenue: loopSub,
      cardOrderRevenue: loopCardRevenue,
      whatsappPackRevenue: loopWaRevenue,
      totalRevenue: loopTotal,
    });
  }

  const revenueAllTime = safeNum(
    (allPaidCardOrders ?? []).reduce((s, o) => s + safeNum(o.total_amount), 0),
  );

  const totalCardsSold = safeNum(
    (allPaidCardOrders ?? []).reduce((s, o) => s + safeNum(o.quantity), 0),
  );

  const revenueThisMonth = cmCardRevenue;

  const paidOrders = safeNum(paidOrdersCount ?? 0);
  const pendingOrders = safeNum(pendingOrdersCount ?? 0);
  const averageOrderValue =
    paidOrders > 0 ? safeNum(revenueAllTime / paidOrders) : 0;

  const packMRR = safeNum(cmPackRevenue / monthCount);
  const growthVsLastMonth = 0;

  const now = new Date();
  const currentYear = now.getUTCFullYear();

  const currentYearRevenue = safeNum(
    months
      .filter((m) => m.month.includes(String(currentYear)))
      .reduce((sum, m) => sum + safeNum(m.totalRevenue), 0),
  );

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
      subscriptionRevenue: safeNum(cmSubRevenue),
      cardOrderRevenue: safeNum(cmCardRevenue),
      whatsappPackRevenue: safeNum(cmWaRevenue),
      totalRevenue: safeNum(cmTotalRevenue),
      fixedCosts: safeNum(fixedCosts),
      variableCosts: safeNum(variableCosts),
    },
    monthly: months.map((m) => ({
      month: m.month,
      subscriptionRevenue: safeNum(m.subscriptionRevenue),
      cardOrderRevenue: safeNum(m.cardOrderRevenue),
      whatsappPackRevenue: safeNum(m.whatsappPackRevenue),
      totalRevenue: safeNum(m.totalRevenue),
    })),
    cardOrders: {
      totalCardsSold: safeNum(totalCardsSold),
      revenueAllTime: safeNum(revenueAllTime),
      revenueThisMonth: safeNum(revenueThisMonth),
      averageOrderValue: safeNum(averageOrderValue),
      pendingOrders: safeNum(pendingOrders),
      paidOrders: safeNum(paidOrders),
    },
    whatsappPack: {
      activeParents: safeNum(activeParentsCount),
      packMRR: safeNum(packMRR),
      growthVsLastMonth: safeNum(growthVsLastMonth),
    },
    annualView: {
      currentYearRevenue: safeNum(currentYearRevenue),
      bestMonth,
      worstMonth,
    },
  } satisfies FinancialsResponse);
}
