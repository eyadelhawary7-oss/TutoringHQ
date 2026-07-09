import 'server-only';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminContext, requireAdminRole } from '@/lib/admin-auth';
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
import { computeSubscriptionTotalMrrRounded } from '@/lib/adminSubscriptionMrr';
import { computeMrrSnapshot } from '@/lib/mrrSnapshot';
import { getImpliedMonthlyMrr } from '@/lib/pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INVOICE_TYPE_LABELS: Record<string, string> = {
  subscription: 'Subscriptions',
  plan: 'Subscriptions',
  card_order: 'Card orders',
  cards: 'Card orders',
  parent_pack: 'Parent pack',
  whatsapp_pack: 'Parent pack',
  blast: 'Blast',
  other: 'Other',
};

const REVENUE_BUCKET_ORDER = ['Subscriptions', 'Card orders', 'Parent pack', 'Blast', 'Other'];

export async function GET(request: Request) {
  const ctx = await getAdminContext(request);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // PDPL: aggregate centre financials are accountant-and-above only. Roles
  // collapsing to internal_viewer (sales_rep / support_agent / custom) must
  // not read this data.
  const denied = requireAdminRole(ctx, ['super_admin', 'admin', 'internal_admin', 'accountant']);
  if (denied) return denied;

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
    snapshotRows,
  ] = await Promise.all([
    fetchCentersForFinance(admin, includeTest),
    fetchAllInvoices(admin, addMonths(now, -12)),
    fetchCardOrders(admin),
    fetchAtRiskHealth(admin),
    fetchMrrSnapshots(admin),
  ]);

  const subscriptionTotalMrr = computeSubscriptionTotalMrrRounded(centersData);

  const centerIds = new Set(centersData.map((c) => c.id));
  const invoicesForMetrics = includeTest
    ? invoicesData
    : invoicesData.filter((i) => i.center_id && centerIds.has(i.center_id));
  const healthForMetrics = includeTest
    ? healthData
    : healthData.filter((h) => h.center_id && centerIds.has(h.center_id));

  const northStar = computeNorthStar(centersData, invoicesForMetrics, monthStart, subscriptionTotalMrr);
  const unitEconomics = computeUnitEconomics(centersData, invoicesForMetrics);
  const mrrTrend = await buildMrrTrend(admin, now, snapshotRows, subscriptionTotalMrr);
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
  plan: string | null;
  status: string | null;
  created_at: string | null;
  all_in_price: number | null;
  billing_period: string | null;
  billing_type: string | null;
  is_early_adopter: boolean | null;
  early_adopter_price: number | null;
  is_test: boolean | null;
};

async function fetchCentersForFinance(admin: SupabaseClient, includeTest: boolean): Promise<CenterRow[]> {
  try {
    let q = admin
      .from('centers')
      .select(
        'id, name, plan, status, created_at, all_in_price, billing_period, billing_type, is_early_adopter, early_adopter_price, is_test',
      )
      .neq('status', 'deleted');
    if (!includeTest) {
      q = q.eq('is_test', false);
    }
    const { data } = await q;
    return (data ?? []) as CenterRow[];
  } catch {
    return [];
  }
}

async function fetchMrrSnapshots(
  admin: SupabaseClient,
): Promise<{ snapshot_date: string; total_mrr: number | string | null }[]> {
  try {
    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - 7);
    const sinceStr = since.toISOString().slice(0, 10);
    const { data } = await admin
      .from('mrr_snapshots')
      .select('snapshot_date, total_mrr')
      .gte('snapshot_date', sinceStr)
      .order('snapshot_date', { ascending: true });
    return (data ?? []) as { snapshot_date: string; total_mrr: number | string | null }[];
  } catch {
    return [];
  }
}

async function buildMrrTrend(
  admin: SupabaseClient,
  now: Date,
  snapshots: { snapshot_date: string; total_mrr: number | string | null }[],
  liveSubscriptionMrr: number,
): Promise<FinanceMrrPoint[]> {
  const hasToday = snapshots.some((r) => String(r.snapshot_date).slice(0, 10) === now.toISOString().slice(0, 10));

  if (snapshots.length === 0) {
    const flat = await safeLiveSnapshotTotal(admin, liveSubscriptionMrr);
    const out: FinanceMrrPoint[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = startOfMonthUtc(addMonths(now, -i));
      out.push({ month: yearMonthKey(d), amount: flat });
    }
    return out;
  }

  const currentMonthKey = yearMonthKey(startOfMonthUtc(now));
  const points: FinanceMrrPoint[] = [];

  for (let i = 5; i >= 0; i--) {
    const monthStart = startOfMonthUtc(addMonths(now, -i));
    const monthEnd = startOfMonthUtc(addMonths(monthStart, 1));
    const monthKey = yearMonthKey(monthStart);

    const inMonth = snapshots.filter((r) => {
      const sd = String(r.snapshot_date).slice(0, 10);
      const t = new Date(`${sd}T12:00:00.000Z`);
      return t >= monthStart && t < monthEnd;
    });

    let amount =
      inMonth.length > 0 ? Math.round(Number(inMonth[inMonth.length - 1].total_mrr ?? 0)) : 0;

    if (monthKey === currentMonthKey && !hasToday) {
      amount = liveSubscriptionMrr;
    }

    points.push({ month: monthKey, amount });
  }

  return points;
}

/** When snapshots are empty, prefer computeMrrSnapshot so trend matches cron payload after deploy. */
async function safeLiveSnapshotTotal(admin: SupabaseClient, fallback: number): Promise<number> {
  try {
    const snap = await computeMrrSnapshot(admin);
    return Math.round(Number(snap.total_mrr));
  } catch {
    return fallback;
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
  return getImpliedMonthlyMrr({
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
}

function computeNorthStar(
  centers: CenterRow[],
  invoices: InvoiceRow[],
  monthStart: Date,
  subscriptionTotalMrr: number,
): FinanceNorthStar {
  const active = centers.filter(isActive);
  const totalMRR = subscriptionTotalMrr;

  const activeLastMonth = active.filter(
    (c) => c.created_at && new Date(c.created_at) < monthStart,
  );
  const mrrLastMonth = computeSubscriptionTotalMrrRounded(activeLastMonth);
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
    const key = (c.plan ?? 'unknown').toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return order
    .filter((k) => counts.has(k))
    .map((plan) => ({ plan, count: counts.get(plan) ?? 0 }));
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
