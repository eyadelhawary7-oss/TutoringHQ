// src/lib/ceoBoard.ts
//
// Read-only aggregates behind `Merged-CEO` §01 (CEO Dashboard) — the design's
// board view: total revenue this month, a six-month revenue history, the MRR /
// accounts / net-new KPI quad, the two segment cards, and churn + ARPU.
//
// Owner-scoped (spans every center and every teacher), so callers MUST gate
// with requireSuperAdminApi before invoking: the service-role client bypasses
// RLS. No writes here — every figure counts or sums rows that already exist.
//
// ── Where each figure comes from, and why ────────────────────────────────────
//
// REVENUE  `invoices` where `status = 'paid'`, bucketed by **Cairo** calendar
//   month on `paid_at`, split by `owner_type` ('center' | 'teacher'). One table
//   and one definition for both segments, which is what makes the segment rows
//   add up to the headline. Deliberately NOT `admin_payments`: that table is
//   center-only (no `teacher_id` column) and is a separate manual-recording
//   path, so mixing the two would double-count centers and still miss teachers.
//   The existing `cash.*` tiles on /ceo keep reading `admin_payments` — this
//   module does not change any figure that already ships.
//
// CENTER MRR  `getImpliedMonthlyMrr(centerRow)` — the canonical row-based path
//   in `src/lib/pricing.ts`, which already owns billing-period normalisation
//   and the inactive-center exclusions. Not re-derived here (see F16/F21 in
//   BUILD-AFTER-REDESIGN.md for what re-deriving a price costs).
//
// TEACHER MRR  `computeTeacherMrr` from `src/lib/ceoTeachers.ts` — the same
//   function the combined top-line on /ceo already uses, so the board view and
//   the combined block can never disagree.
//
// CHURN / NET NEW  center-scoped only, and labelled that way in the UI.
//   `centers.cancellation_approved_at` dates a center cancellation; there is no
//   equivalent column on `teacher_subscriptions` (verified against
//   information_schema — the table has `created_at` and nothing else that dates
//   a status change), so teacher churn cannot be dated at all today. Counting
//   center churn and calling it platform churn would be a fabricated figure.
//
// The churn denominator is `mrr_snapshots.active_centers` recorded on the first
// Cairo day of the current month — a real recorded observation, not a
// back-computed guess. When that snapshot row is absent, churn is `null` and
// the tile is omitted rather than shown against an invented denominator.

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatCalendarMonthYyyyMmInCairo } from '@/lib/formatNumber';
import { startOfUtcInstantForCairoCalendarDay } from '@/lib/cairo/day';
import { getImpliedMonthlyMrr, type ImpliedMrrCenterFields } from '@/lib/pricing';
import { computeTeacherMrr } from '@/lib/ceoTeachers';
import type { CeoBoardData, CeoBoardMonthPoint } from '@/types/ceo';

/** How many Cairo months the §01 revenue chart draws, newest inclusive. */
export const REVENUE_MONTHS = 6;

// ── Pure month math (Cairo calendar, no timezone conversion) ─────────────────

/** Cairo calendar month (`YYYY-MM`) containing the given instant. */
export function cairoMonthKey(d: Date = new Date()): string {
  return formatCalendarMonthYyyyMmInCairo(d);
}

/** The `YYYY-MM` immediately before `key`. Pure string math — TZ-independent. */
export function priorMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return key;
  return m === 1
    ? `${y - 1}-12`
    : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** The last `n` Cairo month keys ending at `now`'s month, oldest → newest. */
export function lastNCairoMonthKeys(now: Date, n: number): string[] {
  const keys: string[] = [];
  let k = cairoMonthKey(now);
  for (let i = 0; i < n; i++) {
    keys.unshift(k);
    k = priorMonthKey(k);
  }
  return keys;
}

/** UTC instant at which a Cairo calendar month begins. */
export function cairoMonthStartUtc(monthKey: string): Date {
  return startOfUtcInstantForCairoCalendarDay(`${monthKey}-01`);
}

type PaidInvoiceRow = {
  paid_at: string | null;
  total_amount: number | string | null;
  owner_type: string | null;
};

/**
 * Sum paid invoice totals into the given Cairo months, oldest → newest.
 * Rows outside the window, unparseable rows and null `paid_at` are dropped —
 * never folded into an adjacent bucket, which would misstate a month.
 */
export function bucketPaidRevenueByCairoMonth(
  rows: ReadonlyArray<PaidInvoiceRow>,
  monthKeys: readonly string[],
  ownerType?: 'center' | 'teacher',
): CeoBoardMonthPoint[] {
  const totals = new Map<string, number>(monthKeys.map((k) => [k, 0]));

  for (const row of rows) {
    if (!row.paid_at) continue;
    if (ownerType && row.owner_type !== ownerType) continue;
    const paid = new Date(row.paid_at);
    if (Number.isNaN(paid.getTime())) continue;
    const key = cairoMonthKey(paid);
    const current = totals.get(key);
    if (current === undefined) continue;
    const amount = Number(row.total_amount);
    if (!Number.isFinite(amount)) continue;
    totals.set(key, current + amount);
  }

  return monthKeys.map((month) => ({
    month,
    revenue: Math.round(totals.get(month) ?? 0),
  }));
}

/**
 * Churn as a percent of the accounts active when the month opened.
 * Null when the denominator is unknown or zero — never 0% by default, because
 * "0% churn" and "we have no baseline" are different statements.
 */
export function churnRatePct(churned: number, activeAtMonthStart: number | null): number | null {
  if (activeAtMonthStart == null || activeAtMonthStart <= 0) return null;
  return (churned / activeAtMonthStart) * 100;
}

/** MRR per active account. Null when there are no accounts to divide by. */
export function arpuFrom(mrr: number, accounts: number): number | null {
  if (accounts <= 0) return null;
  return mrr / accounts;
}

// ── Live assembly ────────────────────────────────────────────────────────────

type CenterRow = ImpliedMrrCenterFields & {
  id: string;
  created_at: string | null;
  cancellation_approved_at: string | null;
  status: string | null;
};

/** Sum implied monthly MRR across centers using the canonical pricing helper. */
export function sumCenterMrr(centers: ReadonlyArray<ImpliedMrrCenterFields>): number {
  return Math.round(
    centers.reduce((sum, c) => sum + Number(getImpliedMonthlyMrr(c) || 0), 0),
  );
}

/** Count rows whose timestamp column falls inside the given Cairo month. */
export function countInCairoMonth(
  rows: ReadonlyArray<{ [k: string]: unknown }>,
  field: string,
  monthKey: string,
): number {
  let n = 0;
  for (const row of rows) {
    const raw = row[field];
    if (typeof raw !== 'string' || !raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    if (cairoMonthKey(d) === monthKey) n += 1;
  }
  return n;
}

/**
 * Assemble `Merged-CEO` §01's board figures. Read-only.
 *
 * Test rows (`centers.is_test`, `teacher_profiles.is_test`) are excluded from
 * every count and every sum, matching the standing admin-aggregate rule.
 */
export async function getCeoBoard(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<CeoBoardData> {
  const monthKeys = lastNCairoMonthKeys(now, REVENUE_MONTHS);
  const thisMonth = monthKeys[monthKeys.length - 1];
  const lastMonth = priorMonthKey(thisMonth);
  const windowStartIso = cairoMonthStartUtc(monthKeys[0]).toISOString();
  const monthStartKey = `${thisMonth}-01`;

  const [invoicesRes, centersRes, teacherSubsRes, teacherProfilesRes, snapshotRes] =
    await Promise.all([
      supabase
        .from('invoices')
        .select('paid_at, total_amount, owner_type')
        .eq('status', 'paid')
        .gte('paid_at', windowStartIso),
      supabase
        .from('centers')
        // Every column here is one `getImpliedMonthlyMrr` reads, plus the two
        // this module dates its own counts on. All verified present in
        // information_schema.columns before this query was written.
        .select(
          'id, status, created_at, cancellation_approved_at, plan, billing_period, billing_type, all_in_price, early_adopter_price, is_early_adopter, is_test',
        )
        .eq('is_test', false),
      supabase
        .from('teacher_subscriptions')
        .select('teacher_id, plan_key, status, price_gross'),
      supabase.from('teacher_profiles').select('user_id, is_test, created_at'),
      supabase
        .from('mrr_snapshots')
        .select('snapshot_date, total_mrr, active_centers')
        .eq('snapshot_date', monthStartKey)
        .maybeSingle(),
    ]);

  for (const [label, res] of [
    ['invoices', invoicesRes],
    ['centers', centersRes],
    ['teacherSubs', teacherSubsRes],
    ['teacherProfiles', teacherProfilesRes],
    ['monthStartSnapshot', snapshotRes],
  ] as const) {
    if (res.error) console.error('[CEO Board]', label, res.error.message);
  }

  const invoices = (invoicesRes.data ?? []) as PaidInvoiceRow[];
  const centers = (centersRes.data ?? []) as CenterRow[];
  const teacherProfiles = (teacherProfilesRes.data ?? []) as Array<{
    user_id: string;
    is_test: boolean | null;
    created_at: string | null;
  }>;
  const allTeacherSubs = (teacherSubsRes.data ?? []) as Array<{
    teacher_id: string;
    plan_key: string | null;
    status: string | null;
    price_gross: number | null;
  }>;
  const snapshot = snapshotRes.data as
    | { total_mrr: number | string | null; active_centers: number | null }
    | null;

  // Test teachers are excluded the same way ceoTeachers.ts does it.
  const testTeacherIds = new Set(
    teacherProfiles.filter((p) => p.is_test).map((p) => p.user_id),
  );
  const realTeachers = teacherProfiles.filter((p) => !p.is_test);
  const teacherSubs = allTeacherSubs.filter((s) => !testTeacherIds.has(s.teacher_id));

  // Revenue: total and per segment, over the same bucketing.
  const revenueSeries = bucketPaidRevenueByCairoMonth(invoices, monthKeys);
  const centerRevenueSeries = bucketPaidRevenueByCairoMonth(invoices, monthKeys, 'center');
  const teacherRevenueSeries = bucketPaidRevenueByCairoMonth(invoices, monthKeys, 'teacher');
  const revenueOf = (series: CeoBoardMonthPoint[], key: string) =>
    series.find((p) => p.month === key)?.revenue ?? 0;

  // MRR.
  const centerMrr = sumCenterMrr(centers);
  const teacherMrr = computeTeacherMrr(teacherSubs);

  // Accounts. Center accounts mirror the /ceo hero's "active centers" rule;
  // teacher accounts mirror the combined block's `total_teachers`.
  const centerAccounts = centers.filter((c) => c.status === 'active').length;
  const teacherAccounts = realTeachers.length;

  // Net new and churn — center-scoped, see the module header.
  const newCenters = countInCairoMonth(centers, 'created_at', thisMonth);
  const newTeachers = countInCairoMonth(realTeachers, 'created_at', thisMonth);
  const churnedCenters = countInCairoMonth(centers, 'cancellation_approved_at', thisMonth);
  const activeCentersAtMonthStart =
    snapshot?.active_centers != null ? Number(snapshot.active_centers) : null;

  const totalMrr = centerMrr + teacherMrr;
  const totalAccounts = centerAccounts + teacherAccounts;

  const centerMrrAtMonthStart =
    snapshot?.total_mrr != null ? Number(snapshot.total_mrr) : null;

  return {
    month: thisMonth,
    revenue_this_month: revenueOf(revenueSeries, thisMonth),
    revenue_prior_month: revenueOf(revenueSeries, lastMonth),
    revenue_series: revenueSeries,
    mrr_total: totalMrr,
    active_accounts: totalAccounts,
    new_accounts: newCenters + newTeachers,
    churned_centers: churnedCenters,
    net_new_centers: newCenters - churnedCenters,
    center: {
      accounts: centerAccounts,
      mrr: centerMrr,
      mrr_at_month_start: centerMrrAtMonthStart,
      revenue_this_month: revenueOf(centerRevenueSeries, thisMonth),
    },
    teacher: {
      accounts: teacherAccounts,
      mrr: teacherMrr,
      mrr_at_month_start: null,
      revenue_this_month: revenueOf(teacherRevenueSeries, thisMonth),
    },
    churn_rate_pct: churnRatePct(churnedCenters, activeCentersAtMonthStart),
    active_centers_at_month_start: activeCentersAtMonthStart,
    arpu: arpuFrom(totalMrr, totalAccounts),
  };
}
