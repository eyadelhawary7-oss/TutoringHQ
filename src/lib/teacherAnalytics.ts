/**
 * Pro teacher analytics (Pile A). Computed LIVE per authenticated teacher from
 * existing data — there is no teacher metrics table, and one teacher's dataset
 * is small, so every query here is scoped to teacher_id = the caller and to
 * that teacher's own groups. Never a full-table scan.
 *
 * Definitions are kept in lock-step with the rest of the private engine:
 *   - Revenue is the teacher's KEPT earnings: transactions.teacher_net, only
 *     paid + non-test + kind='lesson'. NOT amount_billed / lesson_fee.
 *   - Per-class fee is student_groups.fee_per_class (NOT the legacy `fee`).
 *   - "Active private group" and "enrolled" mirror src/lib/teacherCap.ts
 *     countActiveNonGuestStudents: kind='private', status='active', distinct
 *     active non-guest enrollments (students.is_guest=false).
 *   - "Sessions taught" = sessions.status='finished'.
 *   - All month/day windows are Cairo-anchored (src/lib/cairo/*).
 *
 * The compute functions below are PURE (they take already-fetched rows) so they
 * are unit-tested directly; buildTeacherAnalytics is the thin orchestrator that
 * runs the teacher-scoped queries and feeds them in.
 */
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cairoDateKey, parseCairoYmd } from '@/lib/cairo/day';
import { cairoYmdToJsWeekday, getCairoWeekColumnOrder } from '@/lib/cairo/week';

/** Days that the Standard "not seen" flag fires after (3+ weeks). */
export const NOT_SEEN_DAYS = 21;
/** How many trailing Cairo months the revenue trend chart covers. */
export const REVENUE_TREND_MONTHS = 6;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysInGregorianMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function currentCairoYm(now: Date = new Date()): { y: number; m: number } {
  const { y, m } = parseCairoYmd(cairoDateKey(now));
  return { y, m };
}

export function nextYm(y: number, m: number): { y: number; m: number } {
  return m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
}

function prevYm(y: number, m: number): { y: number; m: number } {
  return m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
}

function ymKey(y: number, m: number): string {
  return `${y}-${m}`;
}

/** Cairo calendar {y,m} of an ISO instant (paid_at / scheduled_at buckets). */
export function cairoYmOfIso(iso: string): { y: number; m: number } {
  const { y, m } = parseCairoYmd(cairoDateKey(new Date(iso)));
  return { y, m };
}

// ---------------------------------------------------------------------------
// #1 Projection — scheduled sessions next month from the recurring template
// ---------------------------------------------------------------------------

export type ScheduleSlotRow = { group_id: string; day_of_week: number };
export type ExceptionRow = {
  group_id: string;
  exception_date: string; // YYYY-MM-DD
  kind: string; // 'cancelled' | 'rescheduled'
  new_date: string | null; // YYYY-MM-DD
};

/**
 * Count scheduled occurrences for ONE group in a Cairo calendar month by
 * expanding its recurring weekly template (group_schedule.day_of_week is a JS
 * weekday, 0=Sun…6=Sat) across that month's dates, then reconciling
 * schedule_exceptions: a cancelled/rescheduled occurrence is removed and a
 * rescheduled occurrence landing inside the window is added back. Sessions are
 * never pre-materialised, so this is a forecast — the UI labels it an estimate.
 */
export function countScheduledSessionsInMonth(
  slots: ScheduleSlotRow[],
  exceptions: ExceptionRow[],
  year: number,
  month: number,
): number {
  const weekdays = new Set(slots.map((s) => s.day_of_week));
  if (weekdays.size === 0) return 0;

  const monthPrefix = `${year}-${pad2(month)}-`;
  const scheduledDates = new Set<string>();
  const days = daysInGregorianMonth(year, month);
  for (let d = 1; d <= days; d++) {
    const key = `${monthPrefix}${pad2(d)}`;
    // One slot per weekday (the schedule collapses duplicates), so a date
    // carries at most one occurrence.
    if (weekdays.has(cairoYmdToJsWeekday(key))) scheduledDates.add(key);
  }

  let count = scheduledDates.size;
  const inWindow = (date: string | null): boolean =>
    !!date && date >= `${monthPrefix}01` && date <= `${monthPrefix}${pad2(days)}`;

  for (const ex of exceptions) {
    // Removing the original occurrence: only if the template actually had one
    // on that date (guards against subtracting a phantom).
    if (inWindow(ex.exception_date) && scheduledDates.has(ex.exception_date)) {
      count -= 1;
    }
    // A reschedule that moves the class INTO this window adds one back.
    if (ex.kind === 'rescheduled' && inWindow(ex.new_date)) {
      count += 1;
    }
  }
  return Math.max(0, count);
}

export type ProjectionGroupInput = {
  groupId: string;
  name: string | null;
  feePerClass: number;
  enrolled: number;
  scheduledSessions: number;
};

export type ProjectionGroup = ProjectionGroupInput & { estimate: number };
export type ProjectionResult = { total: number; groups: ProjectionGroup[] };

/** Projected next-month income = Σ enrolled × fee_per_class × scheduled sessions. */
export function projectNextMonthIncome(groups: ProjectionGroupInput[]): ProjectionResult {
  const out = groups.map((g) => ({
    ...g,
    estimate: round2(g.enrolled * g.feePerClass * g.scheduledSessions),
  }));
  return {
    total: round2(out.reduce((acc, g) => acc + g.estimate, 0)),
    groups: out,
  };
}

// ---------------------------------------------------------------------------
// #2 / #3 Revenue (teacher_net) by group and by month
// ---------------------------------------------------------------------------

export type PaidLessonRow = {
  group_id: string | null;
  teacher_net: number | string | null;
  paid_at: string | null;
};

export type GroupRef = { id: string; name: string | null };
export type GroupRevenue = { groupId: string; name: string | null; revenue: number };

export type RevenueResult = {
  byGroupThisMonth: GroupRevenue[];
  best: GroupRevenue | null;
  worst: GroupRevenue | null;
  trend: { year: number; month: number; revenue: number }[];
};

/**
 * Revenue split for the analytics surface. `byGroupThisMonth` zero-fills every
 * active group (so the WORST group can legitimately be an idle EGP 0 group —
 * usually the signal a teacher wants). `trend` is the trailing-N-month total of
 * teacher_net, Cairo-bucketed by paid_at.
 */
export function computeRevenue(
  paidLessons: PaidLessonRow[],
  activeGroups: GroupRef[],
  now: Date = new Date(),
): RevenueResult {
  const cur = currentCairoYm(now);
  const curKey = ymKey(cur.y, cur.m);

  const thisMonthByGroup = new Map<string, number>();
  const totalByMonth = new Map<string, number>();
  for (const r of paidLessons) {
    if (!r.paid_at) continue;
    const net = Number(r.teacher_net) || 0;
    const { y, m } = cairoYmOfIso(r.paid_at);
    const mk = ymKey(y, m);
    totalByMonth.set(mk, (totalByMonth.get(mk) ?? 0) + net);
    if (mk === curKey && r.group_id) {
      thisMonthByGroup.set(r.group_id, (thisMonthByGroup.get(r.group_id) ?? 0) + net);
    }
  }

  const byGroupThisMonth: GroupRevenue[] = activeGroups.map((g) => ({
    groupId: g.id,
    name: g.name,
    revenue: round2(thisMonthByGroup.get(g.id) ?? 0),
  }));

  let best: GroupRevenue | null = null;
  let worst: GroupRevenue | null = null;
  for (const g of byGroupThisMonth) {
    if (!best || g.revenue > best.revenue) best = g;
    if (!worst || g.revenue < worst.revenue) worst = g;
  }

  // Trailing N Cairo months, oldest → newest, zero-filled.
  const trend: { year: number; month: number; revenue: number }[] = [];
  let cursor = cur;
  const window: { y: number; m: number }[] = [];
  for (let i = 0; i < REVENUE_TREND_MONTHS; i++) {
    window.unshift(cursor);
    cursor = prevYm(cursor.y, cursor.m);
  }
  for (const w of window) {
    trend.push({
      year: w.y,
      month: w.m,
      revenue: round2(totalByMonth.get(ymKey(w.y, w.m)) ?? 0),
    });
  }

  return { byGroupThisMonth, best, worst, trend };
}

// ---------------------------------------------------------------------------
// #4 / #5 Attendance
// ---------------------------------------------------------------------------

export type FinishedSessionRow = {
  id: string;
  group_id: string | null;
  scheduled_at: string | null;
};
export type ScanRow = {
  session_id: string | null;
  student_id: string | null;
  scanned_at: string | null;
};

export type GroupAttendance = {
  groupId: string;
  name: string | null;
  finishedSessions: number;
  enrolled: number;
  /** 0..1 average fill, or null when there is nothing to measure yet. */
  rate: number | null;
};

/** Distinct attendees per finished session (the attendance_scans unique key is
 *  (session_id, student_id), but we de-dupe defensively). */
function distinctAttendeesBySession(scans: ScanRow[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const s of scans) {
    if (!s.session_id || !s.student_id) continue;
    let set = m.get(s.session_id);
    if (!set) {
      set = new Set();
      m.set(s.session_id, set);
    }
    set.add(s.student_id);
  }
  return m;
}

/**
 * #4 Average attendance rate per group: Σ distinct attendees over finished
 * sessions ÷ (enrolled × finished sessions), capped at 1. `null` when the group
 * has no finished sessions or no enrolled students (nothing to measure).
 */
export function attendanceRatePerGroup(
  activeGroups: GroupRef[],
  finishedSessions: FinishedSessionRow[],
  scans: ScanRow[],
  enrolledByGroup: Map<string, number>,
): GroupAttendance[] {
  const attendeesBySession = distinctAttendeesBySession(scans);
  const finishedByGroup = new Map<string, number>();
  const attendancesByGroup = new Map<string, number>();
  for (const sess of finishedSessions) {
    if (!sess.group_id) continue;
    finishedByGroup.set(sess.group_id, (finishedByGroup.get(sess.group_id) ?? 0) + 1);
    const attendees = attendeesBySession.get(sess.id)?.size ?? 0;
    attendancesByGroup.set(sess.group_id, (attendancesByGroup.get(sess.group_id) ?? 0) + attendees);
  }

  return activeGroups.map((g) => {
    const finished = finishedByGroup.get(g.id) ?? 0;
    const enrolled = enrolledByGroup.get(g.id) ?? 0;
    const totalAttendances = attendancesByGroup.get(g.id) ?? 0;
    const denom = enrolled * finished;
    const rate = denom > 0 ? Math.min(1, totalAttendances / denom) : null;
    return {
      groupId: g.id,
      name: g.name,
      finishedSessions: finished,
      enrolled,
      rate: rate === null ? null : round2(rate),
    };
  });
}

export type DayOfWeekAttendance = {
  jsWeekday: number;
  sessions: number;
  avgAttendance: number;
};

/**
 * #5 Attendance by Cairo day of week: average distinct attendees per finished
 * session, bucketed by the session's scheduled_at weekday. Returned in Cairo
 * operating-week order (Sat→Fri); only weekdays that actually held a finished
 * session appear. `highest`/`lowest` pick the busiest/quietest day.
 */
export function attendanceByDayOfWeek(
  finishedSessions: FinishedSessionRow[],
  scans: ScanRow[],
): { days: DayOfWeekAttendance[]; highest: DayOfWeekAttendance | null; lowest: DayOfWeekAttendance | null } {
  const attendeesBySession = distinctAttendeesBySession(scans);
  const sessionsByDow = new Map<number, number>();
  const attendancesByDow = new Map<number, number>();
  for (const sess of finishedSessions) {
    if (!sess.scheduled_at) continue;
    const dow = cairoYmdToJsWeekday(cairoDateKey(new Date(sess.scheduled_at)));
    sessionsByDow.set(dow, (sessionsByDow.get(dow) ?? 0) + 1);
    const attendees = attendeesBySession.get(sess.id)?.size ?? 0;
    attendancesByDow.set(dow, (attendancesByDow.get(dow) ?? 0) + attendees);
  }

  const days: DayOfWeekAttendance[] = [];
  for (const dow of getCairoWeekColumnOrder()) {
    const sessions = sessionsByDow.get(dow) ?? 0;
    if (sessions === 0) continue;
    days.push({
      jsWeekday: dow,
      sessions,
      avgAttendance: round2((attendancesByDow.get(dow) ?? 0) / sessions),
    });
  }

  let highest: DayOfWeekAttendance | null = null;
  let lowest: DayOfWeekAttendance | null = null;
  for (const d of days) {
    if (!highest || d.avgAttendance > highest.avgAttendance) highest = d;
    if (!lowest || d.avgAttendance < lowest.avgAttendance) lowest = d;
  }
  return { days, highest, lowest };
}

// ---------------------------------------------------------------------------
// #6 Students not seen in 3+ weeks
// ---------------------------------------------------------------------------

export type RosterStudent = { studentId: string; name: string | null };
export type NotSeenStudent = {
  studentId: string;
  name: string | null;
  lastSeen: string | null; // ISO, or null = never recorded
  daysSince: number | null; // null = never recorded
};

/**
 * #6 Active non-guest students whose latest attendance scan is older than
 * NOT_SEEN_DAYS, plus those never recorded. Sorted longest-unseen first
 * (never-recorded float to the top).
 */
export function studentsNotSeen(
  roster: RosterStudent[],
  lastScanByStudent: Map<string, string>,
  now: Date = new Date(),
  thresholdDays: number = NOT_SEEN_DAYS,
): NotSeenStudent[] {
  const nowMs = now.getTime();
  const flagged: NotSeenStudent[] = [];
  for (const s of roster) {
    const lastSeen = lastScanByStudent.get(s.studentId) ?? null;
    if (!lastSeen) {
      flagged.push({ studentId: s.studentId, name: s.name, lastSeen: null, daysSince: null });
      continue;
    }
    const daysSince = Math.floor((nowMs - new Date(lastSeen).getTime()) / MS_PER_DAY);
    if (daysSince > thresholdDays) {
      flagged.push({ studentId: s.studentId, name: s.name, lastSeen, daysSince });
    }
  }
  flagged.sort((a, b) => {
    const av = a.daysSince ?? Number.POSITIVE_INFINITY;
    const bv = b.daysSince ?? Number.POSITIVE_INFINITY;
    return bv - av;
  });
  return flagged;
}

// ---------------------------------------------------------------------------
// #7 Payment risk (read from the ar_by_student view)
// ---------------------------------------------------------------------------

export type ArByStudentRow = {
  student_id: string | null;
  outstanding_amount: number | string | null;
  unpaid_amount: number | string | null;
  unpaid_count: number | string | null;
};

export type PaymentRiskStudent = {
  studentId: string;
  name: string | null;
  outstanding: number;
  unpaidCount: number;
};

/**
 * #7 Students carrying an outstanding balance, read straight from the canonical
 * credit-aware ar_by_student view (we never hand-roll outstanding math). Sorted
 * by outstanding desc; a higher unpaid_count is the "balance is growing" signal.
 */
export function paymentRisk(
  arRows: ArByStudentRow[],
  nameById: Map<string, string | null>,
): PaymentRiskStudent[] {
  const flagged: PaymentRiskStudent[] = [];
  for (const r of arRows) {
    if (!r.student_id) continue;
    const outstanding = round2(Number(r.outstanding_amount) || 0);
    if (outstanding <= 0) continue;
    flagged.push({
      studentId: r.student_id,
      name: nameById.get(r.student_id) ?? null,
      outstanding,
      unpaidCount: Math.trunc(Number(r.unpaid_count) || 0),
    });
  }
  flagged.sort((a, b) => b.outstanding - a.outstanding || b.unpaidCount - a.unpaidCount);
  return flagged;
}

// ---------------------------------------------------------------------------
// Pro gate — mirrors the notes/guests inline check exactly
// ---------------------------------------------------------------------------

export type ProGateResult = { ok: true } | { ok: false; response: NextResponse };

/**
 * Analytics is a Pro (teacher_699) surface. Mirrors the GUESTS/NOTES_PRO_ONLY
 * gate: plan_key comes from teacher_subscriptions (the authoritative source the
 * cap + status surfaces read; teacher_profiles.plan_key can drift), default
 * teacher_299. A DB error is a 500 (Rule 151: an error is not a state — never
 * mint a false "upgrade required" for a paying Pro teacher on a transient blip).
 */
export async function requireTeacherPro(
  admin: SupabaseClient,
  teacherId: string,
  routeTag: string,
): Promise<ProGateResult> {
  const { data, error } = await admin
    .from('teacher_subscriptions')
    .select('plan_key')
    .eq('teacher_id', teacherId)
    .maybeSingle();
  if (error) {
    Sentry.withScope((scope) => {
      scope.setTag('route', routeTag);
      scope.setTag('step', 'pro_gate');
      Sentry.captureException(error);
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Server error', code: 'server_error' },
        { status: 500 },
      ),
    };
  }
  const planKey = (data as { plan_key?: string } | null)?.plan_key ?? 'teacher_299';
  if (planKey !== 'teacher_699') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'ANALYTICS_PRO_ONLY', upgrade_required: true },
        { status: 403 },
      ),
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Orchestrator — live, teacher-scoped queries → analytics payload
// ---------------------------------------------------------------------------

export type TeacherAnalytics = {
  projection: ProjectionResult & { year: number; month: number };
  revenue: RevenueResult;
  attendanceByGroup: GroupAttendance[];
  attendanceByDayOfWeek: ReturnType<typeof attendanceByDayOfWeek>;
  notSeen: NotSeenStudent[];
  notSeenThresholdDays: number;
  paymentRisk: PaymentRiskStudent[];
  hasAnyActivity: boolean;
};

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

type PageResult = { data: unknown[] | null; error: { message: string } | null };

/** Drain a PostgREST query past the 1000-row cap (same shape as the income route). */
async function fetchPaged<T>(
  make: (from: number, to: number) => PromiseLike<PageResult>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await make(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

type EnrollmentEmbedRow = {
  group_id: string | null;
  student_id: string | null;
  // PostgREST embeds a to-one relation as an object but the generated types
  // widen it to an array — accept either shape.
  students:
    | { id: string; name: string | null; is_guest: boolean }
    | { id: string; name: string | null; is_guest: boolean }[]
    | null;
};

function embedOne<T>(v: T | T[] | null): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/**
 * Build the full Pro analytics payload for ONE teacher. Every query is scoped to
 * teacher_id = teacherId and to that teacher's own active private groups. Throws
 * on any query error so the route can answer 500 (+ Sentry).
 */
export async function buildTeacherAnalytics(
  admin: SupabaseClient,
  teacherId: string,
  now: Date = new Date(),
): Promise<TeacherAnalytics> {
  const cur = currentCairoYm(now);
  const next = nextYm(cur.y, cur.m);

  // 1. Active private groups (the cap definition's group set).
  const { data: groupRows, error: groupsErr } = await admin
    .from('student_groups')
    .select('id, name, fee_per_class')
    .eq('teacher_id', teacherId)
    .eq('kind', 'private')
    .eq('status', 'active');
  if (groupsErr) throw groupsErr;
  const groups = (groupRows ?? []) as { id: string; name: string | null; fee_per_class: number | string | null }[];
  const activeGroups: GroupRef[] = groups.map((g) => ({ id: g.id, name: g.name }));
  const feeByGroup = new Map(groups.map((g) => [g.id, Number(g.fee_per_class) || 0]));
  const groupIds = groups.map((g) => g.id);

  const empty: TeacherAnalytics = {
    projection: { total: 0, groups: [], year: next.y, month: next.m },
    revenue: { byGroupThisMonth: [], best: null, worst: null, trend: computeRevenue([], [], now).trend },
    attendanceByGroup: [],
    attendanceByDayOfWeek: { days: [], highest: null, lowest: null },
    notSeen: [],
    notSeenThresholdDays: NOT_SEEN_DAYS,
    paymentRisk: [],
    hasAnyActivity: false,
  };
  if (groupIds.length === 0) {
    // No active groups → nothing to compute, but payment risk may still exist
    // on the teacher's view (e.g. balances on archived groups). Read it anyway.
    const risk = await loadPaymentRisk(admin, teacherId);
    return { ...empty, paymentRisk: risk, hasAnyActivity: risk.length > 0 };
  }

  // 2. Active non-guest enrollments → per-group enrolled counts + the roster
  //    (distinct students with names) for the "not seen" list.
  const { data: enrollRows, error: enrollErr } = await admin
    .from('enrollments')
    .select('group_id, student_id, students!inner(id, name, is_guest)')
    .in('group_id', groupIds)
    .eq('status', 'active')
    .eq('students.is_guest', false);
  if (enrollErr) throw enrollErr;
  const enrolledByGroup = new Map<string, Set<string>>();
  const rosterById = new Map<string, string | null>();
  for (const row of (enrollRows ?? []) as EnrollmentEmbedRow[]) {
    const student = embedOne(row.students);
    if (!row.group_id || !student) continue;
    let set = enrolledByGroup.get(row.group_id);
    if (!set) {
      set = new Set();
      enrolledByGroup.set(row.group_id, set);
    }
    set.add(student.id);
    rosterById.set(student.id, student.name);
  }
  const enrolledCountByGroup = new Map<string, number>();
  for (const [gid, set] of enrolledByGroup) enrolledCountByGroup.set(gid, set.size);

  // 3. Recurring schedule template + 4. exceptions for next month.
  const { data: slotRows, error: slotErr } = await admin
    .from('group_schedule')
    .select('group_id, day_of_week')
    .in('group_id', groupIds);
  if (slotErr) throw slotErr;
  const slots = (slotRows ?? []) as ScheduleSlotRow[];

  const nextMonthStart = `${next.y}-${pad2(next.m)}-01`;
  const monthAfter = nextYm(next.y, next.m);
  const nextMonthEnd = `${monthAfter.y}-${pad2(monthAfter.m)}-01`;
  const { data: excRows, error: excErr } = await admin
    .from('schedule_exceptions')
    .select('group_id, exception_date, kind, new_date')
    .in('group_id', groupIds)
    .gte('exception_date', nextMonthStart)
    .lt('exception_date', nextMonthEnd);
  if (excErr) throw excErr;
  const exceptions = (excRows ?? []) as ExceptionRow[];

  const slotsByGroup = new Map<string, ScheduleSlotRow[]>();
  for (const s of slots) {
    const arr = slotsByGroup.get(s.group_id) ?? [];
    arr.push(s);
    slotsByGroup.set(s.group_id, arr);
  }
  const excByGroup = new Map<string, ExceptionRow[]>();
  for (const e of exceptions) {
    const arr = excByGroup.get(e.group_id) ?? [];
    arr.push(e);
    excByGroup.set(e.group_id, arr);
  }
  const projection = projectNextMonthIncome(
    groups.map((g) => ({
      groupId: g.id,
      name: g.name,
      feePerClass: feeByGroup.get(g.id) ?? 0,
      enrolled: enrolledCountByGroup.get(g.id) ?? 0,
      scheduledSessions: countScheduledSessionsInMonth(
        slotsByGroup.get(g.id) ?? [],
        excByGroup.get(g.id) ?? [],
        next.y,
        next.m,
      ),
    })),
  );

  // 5. Paid lesson revenue (teacher_net), paginated, bucketed in JS.
  const paidLessons = await fetchPaged<PaidLessonRow>((from, to) =>
    admin
      .from('transactions')
      .select('group_id, teacher_net, paid_at')
      .eq('teacher_id', teacherId)
      .eq('kind', 'lesson')
      .eq('status', 'paid')
      .eq('is_test', false)
      .order('id', { ascending: true })
      .range(from, to),
  );
  const revenue = computeRevenue(paidLessons, activeGroups, now);

  // 6. Finished sessions + 7. attendance scans for this teacher's groups.
  const sessions = await fetchPaged<{ id: string; group_id: string | null; scheduled_at: string | null; status: string | null }>(
    (from, to) =>
      admin
        .from('sessions')
        .select('id, group_id, scheduled_at, status')
        .in('group_id', groupIds)
        .order('id', { ascending: true })
        .range(from, to),
  );
  const finishedSessions: FinishedSessionRow[] = sessions
    .filter((s) => s.status === 'finished')
    .map((s) => ({ id: s.id, group_id: s.group_id, scheduled_at: s.scheduled_at }));
  const sessionIds = sessions.map((s) => s.id);

  let scans: ScanRow[] = [];
  if (sessionIds.length > 0) {
    scans = await fetchPaged<ScanRow>((from, to) =>
      admin
        .from('attendance_scans')
        .select('session_id, student_id, scanned_at')
        .in('session_id', sessionIds)
        .order('id', { ascending: true })
        .range(from, to),
    );
  }

  const attendanceGroups = attendanceRatePerGroup(
    activeGroups,
    finishedSessions,
    scans,
    enrolledCountByGroup,
  );
  const attendanceDow = attendanceByDayOfWeek(finishedSessions, scans);

  const lastScanByStudent = new Map<string, string>();
  for (const s of scans) {
    if (!s.student_id || !s.scanned_at) continue;
    const prev = lastScanByStudent.get(s.student_id);
    if (!prev || s.scanned_at > prev) lastScanByStudent.set(s.student_id, s.scanned_at);
  }
  const roster: RosterStudent[] = Array.from(rosterById.entries()).map(([studentId, name]) => ({
    studentId,
    name,
  }));
  const notSeen = studentsNotSeen(roster, lastScanByStudent, now);

  // 8. Payment risk from ar_by_student (names resolved from the roster, with a
  //    fallback lookup for any flagged student no longer on the active roster).
  const risk = await loadPaymentRisk(admin, teacherId, rosterById);

  const hasAnyActivity =
    finishedSessions.length > 0 ||
    paidLessons.length > 0 ||
    risk.length > 0 ||
    projection.total > 0;

  return {
    projection: { ...projection, year: next.y, month: next.m },
    revenue,
    attendanceByGroup: attendanceGroups,
    attendanceByDayOfWeek: attendanceDow,
    notSeen,
    notSeenThresholdDays: NOT_SEEN_DAYS,
    paymentRisk: risk,
    hasAnyActivity,
  };
}

/** ar_by_student is already teacher-scoped + credit-aware. Resolve names from
 *  the roster first, falling back to a names lookup for off-roster balances. */
async function loadPaymentRisk(
  admin: SupabaseClient,
  teacherId: string,
  rosterById?: Map<string, string | null>,
): Promise<PaymentRiskStudent[]> {
  const { data: arRows, error: arErr } = await admin
    .from('ar_by_student')
    .select('student_id, outstanding_amount, unpaid_amount, unpaid_count')
    .eq('teacher_id', teacherId);
  if (arErr) throw arErr;
  const rows = (arRows ?? []) as ArByStudentRow[];

  const nameById = new Map<string, string | null>(rosterById ?? []);
  const missing = rows
    .filter((r) => r.student_id && Number(r.outstanding_amount) > 0 && !nameById.has(r.student_id))
    .map((r) => r.student_id as string);
  if (missing.length > 0) {
    const { data: nameRows, error: nameErr } = await admin
      .from('students')
      .select('id, name')
      .in('id', Array.from(new Set(missing)));
    if (nameErr) throw nameErr;
    for (const n of (nameRows ?? []) as { id: string; name: string | null }[]) {
      nameById.set(n.id, n.name);
    }
  }
  return paymentRisk(rows, nameById);
}
