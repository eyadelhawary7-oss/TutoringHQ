import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import {
  cairoDateKey,
  parseCairoYmd,
  startOfUtcInstantForCairoCalendarDay,
} from '@/lib/cairo/day';

const ROUTE_TAG = 'api/teacher/private/income';

type GroupIncome = {
  id: string;
  name: string | null;
  collectedThisMonth: number;
  outstanding: number;
};

type ActivityItem = {
  sessionId: string;
  date: string;
  groupId: string | null;
  groupName: string | null;
  amountBilled: number;
};

type TxnRow = {
  group_id: string | null;
  amount_billed: number | string | null;
};

type MethodRow = TxnRow & { method: string | null };

/** Collected-by-method totals for the manual payment record. */
type MethodBreakdown = {
  cash: number;
  instapay: number;
  vodafone_cash: number;
  other: number;
};

/**
 * Bucket paid charges by the recorded method. Anything that is not one of the
 * three named manual methods (incl. NULL or a legacy digital method) folds into
 * 'other', so the buckets always sum to the collected total.
 */
function methodBreakdown(rows: MethodRow[]): MethodBreakdown {
  const out: MethodBreakdown = { cash: 0, instapay: 0, vodafone_cash: 0, other: 0 };
  for (const r of rows) {
    const amt = Number(r.amount_billed) || 0;
    const key =
      r.method === 'cash' || r.method === 'instapay' || r.method === 'vodafone_cash'
        ? r.method
        : 'other';
    out[key] = round2(out[key] + amt);
  }
  return out;
}

type ActivityRow = TxnRow & {
  id: string;
  session_id: string | null;
  created_at: string;
};

type MonthEntry = {
  year: number;
  month: number;
  private_collected: number;
  center_collected: number;
  total_collected: number;
  outstanding: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumBilled(rows: TxnRow[]): number {
  return round2(rows.reduce((acc, r) => acc + (Number(r.amount_billed) || 0), 0));
}

/** Cairo calendar month of an ISO instant. */
function cairoMonthOfIso(iso: string): { y: number; m: number } {
  const { y, m } = parseCairoYmd(cairoDateKey(new Date(iso)));
  return { y, m };
}

function nextYm(y: number, m: number): { y: number; m: number } {
  return m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
}

/** First UTC instant of the Cairo calendar month (billing windows are Cairo-anchored). */
function startOfCairoMonthIso(y: number, m: number): string {
  const firstOfMonth = `${y}-${String(m).padStart(2, '0')}-01`;
  return startOfUtcInstantForCairoCalendarDay(firstOfMonth).toISOString();
}

function currentCairoYm(): { y: number; m: number } {
  const { y, m } = parseCairoYmd(cairoDateKey());
  return { y, m };
}

function serverError(step: string, err: { message: string }): NextResponse {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * The teacher's take of a center_fee transaction: the whole amount billed.
 * There is no percentage to apply — see `design/NEW-MODEL.md`. Same rule as
 * /api/teacher/center-cuts so the two surfaces always agree.
 */
function teacherTake(row: { amount_billed: number | string | null }): number {
  const billed = row.amount_billed == null ? null : Number(row.amount_billed);
  return billed != null && Number.isFinite(billed) ? billed : 0;
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

/**
 * Drain a PostgREST query past the 1000-row default cap. `make` must apply
 * .range(from, to) itself; ordering must be deterministic for stable pages.
 * Capped at MAX_PAGES (10k rows) - far above any single teacher's volume.
 */
async function fetchPaged<T>(
  make: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<{ rows: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await make(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) return { rows, error };
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return { rows, error: null };
}

/**
 * GET /api/teacher/private/income - private income analytics, two modes.
 *
 * Mode 1 (default, ?period=current): current-month collected + all-time
 * outstanding + by-group breakdown + recent activity. Unchanged contract.
 * With optional &year=&month= the same shape is returned for that Cairo
 * calendar month instead: collected = paid_at inside the month, outstanding =
 * still-pending charges created inside the month (a past month's "outstanding"
 * is its unpaid records, not the all-time AR headline).
 *
 * Mode 2 (?period=all): lifetime stats + a zero-filled monthly series from
 * the teacher's join month (users.created_at, Cairo calendar) to the current
 * month. private_collected = paid lesson charges on the teacher's private
 * groups; center_collected = the teacher's take of paid center_fee charges
 * (teacherTake, same rule as /api/teacher/center-cuts); outstanding = pending
 * lesson charges bucketed by creation month. Collected amounts bucket by
 * paid_at so the series always agrees with mode 1's month windows.
 *
 * PRIVATE-ENGINE data: requireTeacherPrivateAccess gates both modes; every
 * query filters on the authenticated teacher's id. Rule 151: all mode-2 reads
 * and the mode-1 headline reads are CORE (error -> 500 + Sentry); mode-1
 * recent activity stays best-effort.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  const params = request.nextUrl.searchParams;
  if (params.get('period') === 'all') {
    return allTimeResponse(auth.supabaseAdmin, auth.userId);
  }

  const yearParam = Number(params.get('year'));
  const monthParam = Number(params.get('month'));
  const hasMonthWindow =
    Number.isInteger(yearParam) &&
    Number.isInteger(monthParam) &&
    yearParam >= 2000 &&
    yearParam <= 2100 &&
    monthParam >= 1 &&
    monthParam <= 12;
  if (params.get('year') !== null || params.get('month') !== null) {
    if (!hasMonthWindow) {
      return NextResponse.json(
        { error: 'Invalid request', code: 'invalid_month' },
        { status: 400 },
      );
    }
    return monthWindowResponse(auth.supabaseAdmin, auth.userId, yearParam, monthParam);
  }

  // ---- Mode 1 default: unchanged current-month behaviour. ----

  // CORE: the teacher's private groups (kind='private' rows carry the private
  // practice; center-kind groups belong to the center zone, not this view).
  const { data: groupRows, error: groupsErr } = await auth.supabaseAdmin
    .from('student_groups')
    .select('id, name')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'private');
  if (groupsErr) {
    return serverError('private_groups', groupsErr);
  }
  const groups = (groupRows ?? []) as { id: string; name: string | null }[];

  // CORE: lesson charges paid during the current Cairo month.
  const { y: curY, m: curM } = currentCairoYm();
  const monthStartIso = startOfCairoMonthIso(curY, curM);
  const { data: paidRows, error: paidErr } = await auth.supabaseAdmin
    .from('transactions')
    .select('group_id, amount_billed, method')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'lesson')
    .eq('status', 'paid')
    .eq('is_test', false)
    .gte('paid_at', monthStartIso);
  if (paidErr) {
    return serverError('collected_month', paidErr);
  }
  const paid = (paidRows ?? []) as MethodRow[];

  // CORE: still-pending lesson charges (raw billed-not-paid, per group).
  const { data: pendingRows, error: pendingErr } = await auth.supabaseAdmin
    .from('transactions')
    .select('group_id, amount_billed')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'lesson')
    .eq('status', 'pending')
    .eq('is_test', false);
  if (pendingErr) {
    return serverError('pending_by_group', pendingErr);
  }
  const pending = (pendingRows ?? []) as TxnRow[];

  // CORE: headline outstanding from the canonical AR view (credit-aware:
  // total_outstanding = unpaid minus active student credits, floored at 0).
  // Per-group outstanding below is the raw pending sum, because credits are
  // student-scoped, not group-scoped, and cannot be allocated to a group.
  const { data: arRow, error: arErr } = await auth.supabaseAdmin
    .from('ar_by_teacher')
    .select('total_outstanding')
    .eq('teacher_id', auth.userId)
    .maybeSingle();
  if (arErr) {
    return serverError('ar_headline', arErr);
  }
  const outstanding = round2(
    Number((arRow as { total_outstanding?: number | string | null } | null)?.total_outstanding) || 0,
  );

  const collectedThisMonth = sumBilled(paid);

  const byGroup = (rows: TxnRow[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (!r.group_id) continue;
      m.set(r.group_id, (m.get(r.group_id) ?? 0) + (Number(r.amount_billed) || 0));
    }
    return m;
  };
  const paidByGroup = byGroup(paid);
  const pendingByGroup = byGroup(pending);

  const groupIncomes: GroupIncome[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    collectedThisMonth: round2(paidByGroup.get(g.id) ?? 0),
    outstanding: round2(pendingByGroup.get(g.id) ?? 0),
  }));

  // BEST-EFFORT: recent billed classes. Charges are per attendee; a "billed
  // class" is the session, so recent rows are folded by session_id and the
  // attendees' amounts summed. A failure here degrades to an empty list.
  let recentActivity: ActivityItem[] = [];
  const { data: activityRows, error: activityErr } = await auth.supabaseAdmin
    .from('transactions')
    .select('id, session_id, group_id, amount_billed, created_at')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'lesson')
    .eq('is_test', false)
    .order('created_at', { ascending: false })
    .limit(60);
  if (activityErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'recent_activity');
      Sentry.captureMessage(
        `teacher income recent-activity lookup failed: ${activityErr.message}`,
        'warning',
      );
    });
  } else {
    const nameByGroup = new Map(groups.map((g) => [g.id, g.name]));
    const bySession = new Map<string, ActivityItem>();
    for (const r of (activityRows ?? []) as ActivityRow[]) {
      const key = r.session_id ?? r.id;
      const existing = bySession.get(key);
      if (existing) {
        existing.amountBilled = round2(existing.amountBilled + (Number(r.amount_billed) || 0));
        if (r.created_at > existing.date) existing.date = r.created_at;
      } else {
        bySession.set(key, {
          sessionId: key,
          date: r.created_at,
          groupId: r.group_id,
          groupName: r.group_id ? (nameByGroup.get(r.group_id) ?? null) : null,
          amountBilled: round2(Number(r.amount_billed) || 0),
        });
      }
    }
    recentActivity = Array.from(bySession.values())
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 10);
  }

  return NextResponse.json({
    collectedThisMonth,
    outstanding,
    methodBreakdown: methodBreakdown(paid),
    groups: groupIncomes,
    recentActivity,
  });
}

/**
 * Mode 1 with an explicit Cairo month window: same response shape as the
 * default mode, scoped to that month. collected = paid_at in [start, next);
 * outstanding = pending charges CREATED in the window (raw sum - the AR view
 * is all-time and cannot be sliced per month). recentActivity is not needed
 * by the month navigator, so it returns empty.
 */
async function monthWindowResponse(
  admin: SupabaseClient,
  userId: string,
  year: number,
  month: number,
): Promise<NextResponse> {
  const startIso = startOfCairoMonthIso(year, month);
  const next = nextYm(year, month);
  const endIso = startOfCairoMonthIso(next.y, next.m);

  const { data: groupRows, error: groupsErr } = await admin
    .from('student_groups')
    .select('id, name')
    .eq('teacher_id', userId)
    .eq('kind', 'private');
  if (groupsErr) {
    return serverError('window_private_groups', groupsErr);
  }
  const groups = (groupRows ?? []) as { id: string; name: string | null }[];

  const { data: paidRows, error: paidErr } = await admin
    .from('transactions')
    .select('group_id, amount_billed, method')
    .eq('teacher_id', userId)
    .eq('kind', 'lesson')
    .eq('status', 'paid')
    .eq('is_test', false)
    .gte('paid_at', startIso)
    .lt('paid_at', endIso);
  if (paidErr) {
    return serverError('window_collected', paidErr);
  }
  const paid = (paidRows ?? []) as MethodRow[];

  const { data: pendingRows, error: pendingErr } = await admin
    .from('transactions')
    .select('group_id, amount_billed')
    .eq('teacher_id', userId)
    .eq('kind', 'lesson')
    .eq('status', 'pending')
    .eq('is_test', false)
    .gte('created_at', startIso)
    .lt('created_at', endIso);
  if (pendingErr) {
    return serverError('window_outstanding', pendingErr);
  }
  const pending = (pendingRows ?? []) as TxnRow[];

  const byGroup = (rows: TxnRow[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (!r.group_id) continue;
      m.set(r.group_id, (m.get(r.group_id) ?? 0) + (Number(r.amount_billed) || 0));
    }
    return m;
  };
  const paidByGroup = byGroup(paid);
  const pendingByGroup = byGroup(pending);

  return NextResponse.json({
    collectedThisMonth: sumBilled(paid),
    outstanding: sumBilled(pending),
    methodBreakdown: methodBreakdown(paid),
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      collectedThisMonth: round2(paidByGroup.get(g.id) ?? 0),
      outstanding: round2(pendingByGroup.get(g.id) ?? 0),
    })),
    recentActivity: [] as ActivityItem[],
  });
}

/**
 * Mode 2 (?period=all): lifetime stats + monthly series. All reads CORE.
 */
async function allTimeResponse(admin: SupabaseClient, userId: string): Promise<NextResponse> {
  // Join month from users.created_at (the series spans the account lifetime).
  const { data: userRow, error: userErr } = await admin
    .from('users')
    .select('created_at')
    .eq('id', userId)
    .maybeSingle();
  if (userErr) {
    return serverError('all_user_created', userErr);
  }
  const createdAt = (userRow as { created_at?: string | null } | null)?.created_at ?? null;

  const { data: groupRows, error: groupsErr } = await admin
    .from('student_groups')
    .select('id')
    .eq('teacher_id', userId)
    .eq('kind', 'private');
  if (groupsErr) {
    return serverError('all_private_groups', groupsErr);
  }
  const privateGroupIds = new Set(((groupRows ?? []) as { id: string }[]).map((g) => g.id));

  type PaidLessonRow = { group_id: string | null; amount_billed: number | string | null; paid_at: string | null };
  const paidLessons = await fetchPaged<PaidLessonRow>((from, to) =>
    admin
      .from('transactions')
      .select('group_id, amount_billed, paid_at')
      .eq('teacher_id', userId)
      .eq('kind', 'lesson')
      .eq('status', 'paid')
      .eq('is_test', false)
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (paidLessons.error) {
    return serverError('all_paid_lessons', paidLessons.error);
  }

  type PaidCutRow = {
    amount_billed: number | string | null;
    paid_at: string | null;
  };
  const paidCuts = await fetchPaged<PaidCutRow>((from, to) =>
    admin
      .from('transactions')
      .select('amount_billed, paid_at')
      .eq('teacher_id', userId)
      .eq('kind', 'center_fee')
      .eq('status', 'paid')
      .eq('is_test', false)
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (paidCuts.error) {
    return serverError('all_paid_cuts', paidCuts.error);
  }

  type PendingRow = { group_id: string | null; amount_billed: number | string | null; created_at: string };
  const pendingLessons = await fetchPaged<PendingRow>((from, to) =>
    admin
      .from('transactions')
      .select('group_id, amount_billed, created_at')
      .eq('teacher_id', userId)
      .eq('kind', 'lesson')
      .eq('status', 'pending')
      .eq('is_test', false)
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (pendingLessons.error) {
    return serverError('all_pending_lessons', pendingLessons.error);
  }

  const { y: curY, m: curM } = currentCairoYm();
  const joined = createdAt ? cairoMonthOfIso(createdAt) : { y: curY, m: curM };
  const monthsSinceJoined = Math.max(1, (curY - joined.y) * 12 + (curM - joined.m) + 1);

  const hasAnyTransaction =
    paidLessons.rows.length > 0 || paidCuts.rows.length > 0 || pendingLessons.rows.length > 0;
  if (!hasAnyTransaction) {
    return NextResponse.json({
      lifetime_total: 0,
      best_month: null,
      monthly_average: 0,
      months_since_joined: monthsSinceJoined,
      monthly_series: [] as MonthEntry[],
    });
  }

  // Aggregate per Cairo month.
  const key = (y: number, m: number) => `${y}-${m}`;
  const privateByMonth = new Map<string, number>();
  const centerByMonth = new Map<string, number>();
  const outstandingByMonth = new Map<string, number>();
  let earliest: { y: number; m: number } | null = null;
  const noteMonth = (ym: { y: number; m: number }) => {
    if (!earliest || ym.y < earliest.y || (ym.y === earliest.y && ym.m < earliest.m)) {
      earliest = ym;
    }
  };

  for (const r of paidLessons.rows) {
    if (!r.paid_at) continue;
    if (!r.group_id || !privateGroupIds.has(r.group_id)) continue;
    const ym = cairoMonthOfIso(r.paid_at);
    noteMonth(ym);
    const k = key(ym.y, ym.m);
    privateByMonth.set(k, (privateByMonth.get(k) ?? 0) + (Number(r.amount_billed) || 0));
  }
  for (const r of paidCuts.rows) {
    if (!r.paid_at) continue;
    const ym = cairoMonthOfIso(r.paid_at);
    noteMonth(ym);
    const k = key(ym.y, ym.m);
    centerByMonth.set(k, (centerByMonth.get(k) ?? 0) + teacherTake(r));
  }
  for (const r of pendingLessons.rows) {
    if (!r.group_id || !privateGroupIds.has(r.group_id)) continue;
    const ym = cairoMonthOfIso(r.created_at);
    noteMonth(ym);
    const k = key(ym.y, ym.m);
    outstandingByMonth.set(k, (outstandingByMonth.get(k) ?? 0) + (Number(r.amount_billed) || 0));
  }

  // Series start: the join month, widened backwards if data predates it
  // (e.g. center work imported before the account row's created_at).
  let start = { ...joined };
  const e = earliest as { y: number; m: number } | null;
  if (e && (e.y < start.y || (e.y === start.y && e.m < start.m))) {
    start = { ...e };
  }

  const MAX_SERIES_MONTHS = 240;
  const series: MonthEntry[] = [];
  let cursor = { ...start };
  while (
    (cursor.y < curY || (cursor.y === curY && cursor.m <= curM)) &&
    series.length < MAX_SERIES_MONTHS
  ) {
    const k = key(cursor.y, cursor.m);
    const priv = round2(privateByMonth.get(k) ?? 0);
    const center = round2(centerByMonth.get(k) ?? 0);
    series.push({
      year: cursor.y,
      month: cursor.m,
      private_collected: priv,
      center_collected: center,
      total_collected: round2(priv + center),
      outstanding: round2(outstandingByMonth.get(k) ?? 0),
    });
    cursor = nextYm(cursor.y, cursor.m);
  }

  const lifetimeTotal = round2(series.reduce((acc, s) => acc + s.total_collected, 0));

  let best: MonthEntry | null = null;
  for (const s of series) {
    if (s.total_collected > 0 && (!best || s.total_collected > best.total_collected)) {
      best = s;
    }
  }

  return NextResponse.json({
    lifetime_total: lifetimeTotal,
    best_month: best
      ? { year: best.year, month: best.month, amount: best.total_collected }
      : null,
    monthly_average: round2(lifetimeTotal / monthsSinceJoined),
    months_since_joined: monthsSinceJoined,
    monthly_series: series,
  });
}
