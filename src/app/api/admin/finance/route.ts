import 'server-only';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminContext } from '@/lib/admin-auth';
import { parseIncludeTestCenters } from '@/lib/adminIncludeTest';
import type {
  FinanceAtRiskCenter,
  FinanceCardPipeline,
  FinanceCohort,
  FinanceData,
  FinanceMrrPoint,
  FinanceNorthStar,
  FinanceOutstandingInvoice,
  FinancePlanCount,
  FinanceRevenueSlice,
  FinanceUnitEconomics,
} from '@/types/admin-finance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// TODO(post-launch): swap PLAN_MONTHLY_FALLBACK for getImpliedMonthlyMrr / PLANS
// from @/lib/pricing once the duplicated MRR loop in admin/billing/route.ts and
// admin/overview/route.ts is extracted into a shared helper.
const PLAN_MONTHLY_FALLBACK: Record<string, number> = {
  solo: 999,
  nano: 1999,
  starter: 4499,
  pro: 7999,
  business: 12999,
  enterprise: 18499,
};

const INVOICE_TYPE_LABELS: Record<string, string> = {
  subscription: 'Subscriptions',
  plan: 'Subscriptions',
  card_order: 'Card orders',
  cards: 'Card orders',
  parent_pack: 'Parent pack',
  whatsapp_pack: 'Parent pack',
  blast: 'Blast',
  payg: 'PAYG',
  other: 'Other',
};

const REVENUE_BUCKET_ORDER = ['Subscriptions', 'Card orders', 'Parent pack', 'Blast', 'PAYG', 'Other'];

export async function GET(request: Request) {
  const ctx = await getAdminContext(request);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const includeTest = parseIncludeTestCenters(request);
  const data = await getFinanceData(ctx.supabaseAdmin, includeTest);
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

async function getFinanceData(admin: SupabaseClient, includeTest: boolean): Promise<FinanceData> {
  const now = new Date();
  const monthStart = startOfMonthUtc(now);
  const sixMonthsAgo = startOfMonthUtc(addMonths(now, -5));

  const [
    centersData,
    invoicesData,
    cardOrdersData,
    healthData,
  ] = await Promise.all([
    fetchActiveCenters(admin, includeTest),
    fetchAllInvoices(admin, addMonths(now, -12)),
    fetchCardOrders(admin),
    fetchAtRiskHealth(admin),
  ]);

  const centerIds = new Set(centersData.map((c) => c.id));
  const invoicesForMetrics = includeTest
    ? invoicesData
    : invoicesData.filter((i) => i.center_id && centerIds.has(i.center_id));
  const healthForMetrics = includeTest
    ? healthData
    : healthData.filter((h) => h.center_id && centerIds.has(h.center_id));

  const northStar = computeNorthStar(centersData, invoicesForMetrics, monthStart);
  const unitEconomics = computeUnitEconomics(centersData, invoicesForMetrics);
  const mrrTrend = computeMrrTrend(invoicesForMetrics, now);
  const revenueByType = computeRevenueByType(invoicesForMetrics, monthStart);
  const planDistribution = computePlanDistribution(centersData);
  const cohorts = computeCohorts(centersData, invoicesForMetrics, sixMonthsAgo, now);
  const outstandingInvoices = computeOutstanding(invoicesForMetrics, centersData, now);
  const atRiskCenters = computeAtRisk(healthForMetrics, centersData);
  const cardOrdersFiltered = includeTest
    ? cardOrdersData
    : cardOrdersData.filter((o) => o.center_id && centerIds.has(o.center_id));
  const cardPipeline = computeCardPipeline(cardOrdersFiltered);

  return {
    northStar,
    unitEconomics,
    mrrTrend,
    revenueByType,
    planDistribution,
    cohorts,
    outstandingInvoices,
    atRiskCenters,
    cardPipeline,
    generatedAt: now.toISOString(),
  };
}

// ---------- fetchers (resilient, return [] on failure) ----------

type CenterRow = {
  id: string;
  name: string | null;
  plan_key: string | null;
  status: string | null;
  created_at: string | null;
  monthly_price: number | null;
  base_monthly_price: number | null;
};

async function fetchActiveCenters(admin: SupabaseClient, includeTest: boolean): Promise<CenterRow[]> {
  try {
    let q = admin
      .from('centers')
      .select('id, name, plan_key, status, created_at, monthly_price, base_monthly_price');
    if (!includeTest) {
      q = q.eq('is_test', false);
    }
    const { data } = await q;
    return (data ?? []) as CenterRow[];
  } catch {
    return [];
  }
}

type InvoiceRow = {
  id: string;
  center_id: string | null;
  payment_amount: number | null;
  status: string | null;
  invoice_type: string | null;
  created_at: string | null;
  due_date: string | null;
};

async function fetchAllInvoices(admin: SupabaseClient, since: Date): Promise<InvoiceRow[]> {
  try {
    const { data } = await admin
      .from('invoices')
      .select('id, center_id, payment_amount, status, invoice_type, created_at, due_date')
      .gte('created_at', since.toISOString());
    return (data ?? []) as InvoiceRow[];
  } catch {
    return [];
  }
}

type CardOrderRow = {
  id: string;
  center_id: string | null;
  status: string | null;
  vendor_bosta_failed?: boolean | null;
};

async function fetchCardOrders(admin: SupabaseClient): Promise<CardOrderRow[]> {
  try {
    const { data } = await admin
      .from('card_orders')
      .select('id, center_id, status, vendor_bosta_failed');
    return (data ?? []) as CardOrderRow[];
  } catch {
    return [];
  }
}

type HealthRow = { center_id: string; health_score: number | null; day: string | null };

async function fetchAtRiskHealth(admin: SupabaseClient): Promise<HealthRow[]> {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await admin
      .from('center_metrics_daily')
      .select('center_id, health_score, day')
      .gte('day', since)
      .order('day', { ascending: false })
      .limit(2000);
    return (data ?? []) as HealthRow[];
  } catch {
    return [];
  }
}

// ---------- computations ----------

function isActive(c: CenterRow): boolean {
  const s = (c.status ?? '').toLowerCase();
  return s !== 'suspended' && s !== 'churned' && s !== 'deleted' && s !== 'cancelled' && s !== 'inactive';
}

function isPaid(inv: InvoiceRow): boolean {
  const s = (inv.status ?? '').toLowerCase();
  return s === 'paid' || s === 'approved';
}

function isPending(inv: InvoiceRow): boolean {
  const s = (inv.status ?? '').toLowerCase();
  return s === 'pending';
}

function monthlyChargeForCenter(c: CenterRow): number {
  if (typeof c.monthly_price === 'number' && c.monthly_price > 0) return c.monthly_price;
  if (typeof c.base_monthly_price === 'number' && c.base_monthly_price > 0) return c.base_monthly_price;
  return PLAN_MONTHLY_FALLBACK[c.plan_key ?? ''] ?? 0;
}

function computeNorthStar(
  centers: CenterRow[],
  invoices: InvoiceRow[],
  monthStart: Date,
): FinanceNorthStar {
  const active = centers.filter(isActive);
  const totalMRR = Math.round(active.reduce((s, c) => s + monthlyChargeForCenter(c), 0));

  const activeLastMonth = active.filter(
    (c) => c.created_at && new Date(c.created_at) < monthStart,
  );
  const mrrLastMonth = Math.round(activeLastMonth.reduce((s, c) => s + monthlyChargeForCenter(c), 0));
  const mrrChangePct = mrrLastMonth > 0
    ? Math.round(((totalMRR - mrrLastMonth) / mrrLastMonth) * 1000) / 10
    : 0;

  const thisMonthRevenue = invoices
    .filter(isPaid)
    .filter((i) => i.created_at && new Date(i.created_at) >= monthStart)
    .reduce((s, i) => s + Number(i.payment_amount ?? 0), 0);

  const pending = invoices.filter(isPending);
  const outstandingTotal = pending.reduce((s, i) => s + Number(i.payment_amount ?? 0), 0);
  const outstandingCount = pending.length;

  const newCentersThisMonth = centers.filter(
    (c) => c.created_at && new Date(c.created_at) >= monthStart,
  ).length;

  return {
    totalMRR,
    activeCenters: active.length,
    thisMonthRevenue: Math.round(thisMonthRevenue),
    outstandingTotal: Math.round(outstandingTotal),
    outstandingCount,
    mrrChangePct,
    newCentersThisMonth,
  };
}

function computeUnitEconomics(
  centers: CenterRow[],
  invoices: InvoiceRow[],
): FinanceUnitEconomics {
  const total = centers.length;
  const churnedThisMonth = centers.filter((c) => {
    const s = (c.status ?? '').toLowerCase();
    return s === 'suspended' || s === 'churned' || s === 'cancelled';
  }).length;

  const monthlyChurnRate = total > 0 ? Math.round((churnedThisMonth / total) * 1000) / 10 : 0;

  const active = centers.filter(isActive);
  const arpc = active.length > 0
    ? active.reduce((s, c) => s + monthlyChargeForCenter(c), 0) / active.length
    : 0;

  const monthlyChurnFraction = monthlyChurnRate / 100;
  const ltv = monthlyChurnFraction > 0
    ? Math.round(arpc / monthlyChurnFraction)
    : Math.round(arpc * 60);

  const firstPaidByCenter = new Map<string, Date>();
  for (const inv of invoices) {
    if (!isPaid(inv) || !inv.center_id || !inv.created_at) continue;
    const t = new Date(inv.created_at);
    const existing = firstPaidByCenter.get(inv.center_id);
    if (!existing || t < existing) firstPaidByCenter.set(inv.center_id, t);
  }
  const ttfpSamples: number[] = [];
  for (const c of centers) {
    if (!c.created_at) continue;
    const firstPaid = firstPaidByCenter.get(c.id);
    if (!firstPaid) continue;
    const days = (firstPaid.getTime() - new Date(c.created_at).getTime()) / 86_400_000;
    if (days >= 0) ttfpSamples.push(days);
  }
  const ttfpDays = ttfpSamples.length > 0 ? Math.round(median(ttfpSamples) * 10) / 10 : null;

  return { monthlyChurnRate, ltv, ttfpDays };
}

function computeMrrTrend(invoices: InvoiceRow[], now: Date): FinanceMrrPoint[] {
  const out: FinanceMrrPoint[] = [];
  for (let i = 5; i >= 0; i--) {
    const start = startOfMonthUtc(addMonths(now, -i));
    const end = startOfMonthUtc(addMonths(now, -i + 1));
    const amount = invoices
      .filter(isPaid)
      .filter((inv) => inv.created_at && new Date(inv.created_at) >= start && new Date(inv.created_at) < end)
      .reduce((s, inv) => s + Number(inv.payment_amount ?? 0), 0);
    out.push({ month: yearMonthKey(start), amount: Math.round(amount) });
  }
  return out;
}

function computeRevenueByType(invoices: InvoiceRow[], monthStart: Date): FinanceRevenueSlice[] {
  const totals = new Map<string, number>();
  let grand = 0;
  for (const inv of invoices) {
    if (!isPaid(inv)) continue;
    if (!inv.created_at || new Date(inv.created_at) < monthStart) continue;
    const amount = Number(inv.payment_amount ?? 0);
    if (amount <= 0) continue;
    const label = INVOICE_TYPE_LABELS[(inv.invoice_type ?? 'other').toLowerCase()] ?? 'Other';
    totals.set(label, (totals.get(label) ?? 0) + amount);
    grand += amount;
  }
  const slices: FinanceRevenueSlice[] = [];
  for (const label of REVENUE_BUCKET_ORDER) {
    const amount = totals.get(label);
    if (!amount) continue;
    slices.push({
      type: label,
      label,
      amount: Math.round(amount),
      pct: grand > 0 ? Math.round((amount / grand) * 1000) / 10 : 0,
    });
  }
  return slices;
}

function computePlanDistribution(centers: CenterRow[]): FinancePlanCount[] {
  const order = ['solo', 'nano', 'starter', 'pro', 'business', 'enterprise', 'top_centers'];
  const counts = new Map<string, number>();
  for (const c of centers.filter(isActive)) {
    const key = (c.plan_key ?? 'unknown').toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return order
    .filter((k) => counts.has(k))
    .map((plan_key) => ({ plan_key, count: counts.get(plan_key) ?? 0 }));
}

function computeCohorts(
  centers: CenterRow[],
  invoices: InvoiceRow[],
  sixMonthsAgo: Date,
  now: Date,
): FinanceCohort[] {
  const cohortMap = new Map<string, { centerIds: Set<string>; activeByMonth: Map<number, Set<string>> }>();

  for (const c of centers) {
    if (!c.created_at) continue;
    const created = new Date(c.created_at);
    if (created < sixMonthsAgo) continue;
    const key = yearMonthKey(startOfMonthUtc(created));
    if (!cohortMap.has(key)) {
      cohortMap.set(key, { centerIds: new Set(), activeByMonth: new Map() });
    }
    cohortMap.get(key)!.centerIds.add(c.id);
  }

  const centerById = new Map(centers.map((c) => [c.id, c]));

  for (const inv of invoices) {
    if (!isPaid(inv) || !inv.center_id || !inv.created_at) continue;
    const c = centerById.get(inv.center_id);
    if (!c?.created_at) continue;
    const cohortKey = yearMonthKey(startOfMonthUtc(new Date(c.created_at)));
    const cohort = cohortMap.get(cohortKey);
    if (!cohort) continue;
    const monthsSince = monthDiff(new Date(c.created_at), new Date(inv.created_at));
    if (monthsSince < 0 || monthsSince > 5) continue;
    if (!cohort.activeByMonth.has(monthsSince)) {
      cohort.activeByMonth.set(monthsSince, new Set());
    }
    cohort.activeByMonth.get(monthsSince)!.add(inv.center_id);
  }

  const out: FinanceCohort[] = [];
  for (const [cohortMonth, { centerIds, activeByMonth }] of cohortMap.entries()) {
    const size = centerIds.size;
    const cohortDate = new Date(`${cohortMonth}-01T00:00:00Z`);
    const monthsElapsed = monthDiff(cohortDate, now);
    const retention: (number | null)[] = [];
    for (let m = 0; m <= 5; m++) {
      if (m > monthsElapsed) {
        retention.push(null);
      } else {
        const activeSet = activeByMonth.get(m) ?? new Set();
        retention.push(size > 0 ? Math.round((activeSet.size / size) * 100) : 0);
      }
    }
    out.push({ cohortMonth, size, retention });
  }
  return out.sort((a, b) => a.cohortMonth.localeCompare(b.cohortMonth));
}

function computeOutstanding(
  invoices: InvoiceRow[],
  centers: CenterRow[],
  now: Date,
): FinanceOutstandingInvoice[] {
  const centerNameById = new Map(centers.map((c) => [c.id, c.name ?? '(unnamed)']));
  const pending = invoices.filter(isPending);
  const out: FinanceOutstandingInvoice[] = [];
  for (const inv of pending) {
    if (!inv.center_id) continue;
    const due = inv.due_date ? new Date(inv.due_date) : (inv.created_at ? new Date(inv.created_at) : null);
    const days = due ? Math.max(0, Math.floor((now.getTime() - due.getTime()) / 86_400_000)) : 0;
    out.push({
      invoiceId: inv.id,
      centerId: inv.center_id,
      centerName: centerNameById.get(inv.center_id) ?? '(unknown)',
      amount: Math.round(Number(inv.payment_amount ?? 0)),
      daysOverdue: days,
    });
  }
  return out
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.amount - a.amount)
    .slice(0, 10);
}

function computeAtRisk(health: HealthRow[], centers: CenterRow[]): FinanceAtRiskCenter[] {
  const latestByCenter = new Map<string, HealthRow>();
  for (const h of health) {
    if (!h.center_id || !h.day) continue;
    const existing = latestByCenter.get(h.center_id);
    if (!existing || (existing.day && h.day > existing.day)) {
      latestByCenter.set(h.center_id, h);
    }
  }
  const centerById = new Map(centers.map((c) => [c.id, c]));
  const out: FinanceAtRiskCenter[] = [];
  for (const [centerId, h] of latestByCenter.entries()) {
    const score = Number(h.health_score ?? 100);
    if (score >= 40) continue;
    const c = centerById.get(centerId);
    if (!c || !isActive(c)) continue;
    out.push({
      centerId,
      centerName: c.name ?? '(unnamed)',
      healthScore: Math.round(score),
      reason: scoreReason(score),
    });
  }
  return out
    .sort((a, b) => a.healthScore - b.healthScore)
    .slice(0, 10);
}

function scoreReason(score: number): string {
  if (score < 20) return 'critical';
  if (score < 30) return 'severe drop';
  if (score < 40) return 'warning';
  return 'monitor';
}

function computeCardPipeline(orders: CardOrderRow[]): FinanceCardPipeline {
  let pendingVendor = 0;
  let inTransit = 0;
  let delivered = 0;
  let failed = 0;
  for (const o of orders) {
    const s = (o.status ?? '').toLowerCase();
    if (o.vendor_bosta_failed === true || s === 'failed' || s === 'cancelled') {
      failed += 1;
    } else if (s === 'pending' || s === 'pending_vendor' || s === 'awaiting_vendor') {
      pendingVendor += 1;
    } else if (
      s === 'shipped' || s === 'in_transit' || s === 'out_for_delivery' || s === 'ready' || s === 'picked_up'
    ) {
      inTransit += 1;
    } else if (s === 'delivered' || s === 'completed') {
      delivered += 1;
    }
  }
  return { pendingVendor, inTransit, delivered, failed };
}

// ---------- date / math helpers ----------

function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

function yearMonthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthDiff(start: Date, end: Date): number {
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
