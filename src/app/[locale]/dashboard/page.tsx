'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect } from '@/lib/db-proxy';
import { getStudentBalances } from '@/lib/studentBalance';
import { useUser } from '@/contexts/UserContext';
import { Link } from '@/i18n/routing';
import { EmptyState, KpiCard, SectionHeader } from '@/components/shared';
import ListRow from '@/components/patterns/ListRow';
import { formatDate, formatNumber, formatPercent, formatCurrency, formatTime } from '@/lib/formatNumber';
import { getCairoWeekDayKeys, scheduleSlotsDayOfWeek } from '@/lib/cairo/week';
import { cairoDateKey, startOfCairoDay, getCurrentCairoClock } from '@/lib/cairo/day';
import { classifyTodaySchedule } from '@/lib/todayScheduleStatus';
import {
  readDashboardCache as readScopedDashboardCache,
  writeDashboardCache as writeScopedDashboardCache,
} from '@/lib/dashboardCache';
import { AlertCircle, Calendar, QrCode } from 'lucide-react';

/**
 * Merged-Center-Home §01 `.kv span`: the trailing "%" renders at 11px/500 muted
 * inside the 17px/700 value, not as part of the same type run. The sign is
 * locale-dependent ("%" vs "٪") and `formatPercent` is the only place that
 * choice is made, so split its output rather than re-deriving the glyph here.
 */
function splitFormattedPercent(value: number, locale: string): { value: string; sign: string } {
  const formatted = formatPercent(value, locale);
  return { value: formatted.slice(0, -1), sign: formatted.slice(-1) };
}

interface DashboardData {
  /** Scans recorded today — the "Attendance" tile's numerator. */
  todayAttendance: number;
  /** Students whose real balance (studentBalance.ts) is > 0. */
  unpaidCount: number;
  /** Confirmed payments recorded today — the "Collected" tile. */
  todayRevenue: number;
  /** Cairo-week payments split by method; the sole input to the digital share meter. */
  revenueChartData: {
    dayKey: string;
    cash: number;
    instapay: number;
    vodafone: number;
    orange: number;
    fawry: number;
    bank: number;
    other: number;
  }[];
  /** §01 "Schedule": today's schedule_slots, Cairo day-of-week. */
  todaySchedule: TodayScheduleRow[];
  todaySessionsTotal: number;
  todaySessionsDone: number;
  /** Sum of member_count across today's schedule_slots (a student in 2 classes today counts twice, matching the design's per-seat framing). */
  studentsExpectedToday: number;
  /**
   * Oldest chargeable (non-absent, non-teacher-private) scan among students who
   * currently have balance > 0. Bounded by the 30-day attendance_scans window
   * this page already fetches - a genuinely older unpaid charge still reads as
   * "30 days" rather than its real age. Null when no such scan is in that window.
   */
  unpaidLinksOldestDays: number | null;
  /**
   * ISO timestamp when this snapshot was computed. Required, not decorative:
   * readDashboardCache() TTL-checks against it and returns null when it is
   * absent, so dropping it silently disables the session cache.
   */
  generatedAt?: string;
}

interface TodayScheduleRow {
  id: string;
  /** Raw "HH:MM:SS" from schedule_slots, formatted at render time. */
  startTime: string;
  /** Null for a slot with no group assigned - the row renders non-interactive (no ListRow onOpen/chevron) in that case. */
  groupId: string | null;
  groupName: string;
  roomName: string;
  teacherName: string;
  memberCount: number;
  /**
   * Derived, not stored: "billed" means this slot's end_time has already
   * passed today (schedule_slots has no per-occurrence completion/billing
   * flag) - not a claim that money was specifically confirmed collected.
   * "next" is the single soonest slot that has not yet ended; "later" is
   * everything else still to come today.
   */
  status: 'billed' | 'next' | 'later';
}

const EMPTY_DASHBOARD_DATA: DashboardData = {
  todayAttendance: 0,
  unpaidCount: 0,
  todayRevenue: 0,
  revenueChartData: [],
  todaySchedule: [],
  todaySessionsTotal: 0,
  todaySessionsDone: 0,
  studentsExpectedToday: 0,
  unpaidLinksOldestDays: null,
};

function isDashboardCacheValid(p: unknown): p is DashboardData {
  if (!p || typeof p !== 'object') return false;
  const o = p as DashboardData;
  // Reject a cache blob written by an earlier shape of this screen rather than
  // render it with the §01 fields undefined.
  if (!Array.isArray(o.todaySchedule)) return false;
  if (!Array.isArray(o.revenueChartData)) return false;
  return true;
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const tBilling = useTranslations('billing');
  const tEmpty = useTranslations('emptyStates');
  const locale = useLocale();
  const router = useRouter();
  const { user } = useUser();

  const [centerBilling, setCenterBilling] = useState<{ name?: string; plan?: string } | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [dashboardDataFresh, setDashboardDataFresh] = useState(false);
  const [centerId, setCenterId] = useState<string | null>(null);
  /**
   * /api/dashboard/stats is the authoritative "scanned today" count (it counts
   * server-side over the full day, not over this page's 30-day scan window), so
   * it stays even though the KPI tiles it used to back are gone. It is the
   * numerator of the design's "Attendance" tile.
   */
  const [statsData, setStatsData] = useState<{ attendanceToday: number } | null>(null);

  const startOfToday = () => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  };

  // Read the id out before the callback closes over it. Closing over `user`
  // itself makes React Compiler infer the whole context object as the
  // dependency, which no longer matches `user?.id` in the array below and
  // fails `react-hooks/preserve-manual-memoization`.
  const userId = user?.id;

  const loadDashboard = useCallback(async (cId: string) => {
    try {
      const todayStart = startOfToday();
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const todayCairoKey = cairoDateKey();
      const todayDow = scheduleSlotsDayOfWeek(todayCairoKey);

      const [
        paymentsResult,
        attendanceResult,
        studentBalances,
        scheduleSlotsResult,
      ] = await Promise.all([
        dbSelect({
          table: 'payments',
          select: 'amount, confirmed, status, method, paid_at, student_id',
          filters: [
            { column: 'center_id', op: 'eq', value: cId },
            { column: 'paid_at', op: 'gte', value: thirtyDaysAgo.toISOString() },
            { column: 'paid_at', op: 'lte', value: todayEnd.toISOString() },
          ],
        }),
        dbSelect({
          table: 'attendance_scans',
          select: 'student_id, scanned_at, status, billable',
          filters: [
            { column: 'center_id', op: 'eq', value: cId },
            { column: 'scanned_at', op: 'gte', value: thirtyDaysAgo.toISOString() },
          ],
          order: { column: 'scanned_at', ascending: false },
        }),
        // Real per-student balances (D3: students.payment_status is write-once-at-insert,
        // never updated after — unpaidCount must come from here, not that column.
        getStudentBalances(supabase, { centerId: cId }),
        // Merged-Center-Home §01 "Schedule": today's Cairo day-of-week only.
        // schedule_slots.day_of_week is the JS-weekday-as-text the slot editor writes;
        // scheduleSlotsDayOfWeek() is the one place that convention is decoded (cairo/day.ts).
        dbSelect({
          table: 'schedule_slots',
          select: 'id, room_id, group_id, teacher_id, start_time, end_time',
          filters: [
            { column: 'center_id', op: 'eq', value: cId },
            { column: 'day_of_week', op: 'eq', value: todayDow },
          ],
        }),
      ]);

      const paymentsData = (paymentsResult.data || []) as { amount: number; confirmed?: boolean; status?: string; method?: string; paid_at?: string; student_id?: string }[];
      const scansData = (attendanceResult.data || []) as { student_id: string; scanned_at: string; status?: string | null; billable?: boolean | null }[];
      const scheduleSlotsToday = (scheduleSlotsResult.data || []) as {
        id: string;
        room_id: string | null;
        group_id: string | null;
        teacher_id: string | null;
        start_time: string;
        end_time: string;
      }[];

      // Batch 2: resolve today's schedule_slots into display names + member
      // counts, same join pattern as /schedule (groups/page.tsx's groupToTeacher).
      const roomIdsToday = [...new Set(scheduleSlotsToday.map((s) => s.room_id).filter((v): v is string => Boolean(v)))];
      const groupIdsToday = [...new Set(scheduleSlotsToday.map((s) => s.group_id).filter((v): v is string => Boolean(v)))];
      const teacherIdsToday = [...new Set(scheduleSlotsToday.map((s) => s.teacher_id).filter((v): v is string => Boolean(v)))];

      const [roomsRes, groupsRes, teachersRes, membersRes] = await Promise.all([
        roomIdsToday.length > 0
          ? dbSelect({ table: 'rooms', select: 'id, name', filters: [{ column: 'id', op: 'in', value: roomIdsToday }] })
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        groupIdsToday.length > 0
          ? dbSelect({ table: 'student_groups', select: 'id, name', filters: [{ column: 'id', op: 'in', value: groupIdsToday }] })
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        teacherIdsToday.length > 0
          ? dbSelect({ table: 'users', select: 'id, name', filters: [{ column: 'id', op: 'in', value: teacherIdsToday }] })
          : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
        groupIdsToday.length > 0
          ? dbSelect({ table: 'student_group_members', select: 'group_id', filters: [{ column: 'group_id', op: 'in', value: groupIdsToday }] })
          : Promise.resolve({ data: [] as { group_id: string }[] }),
      ]);

      const roomNameById = new Map(((roomsRes.data || []) as { id: string; name: string }[]).map((r) => [r.id, r.name]));
      const groupNameById = new Map(((groupsRes.data || []) as { id: string; name: string }[]).map((g) => [g.id, g.name]));
      const teacherNameById = new Map(((teachersRes.data || []) as { id: string; name: string | null }[]).map((u) => [u.id, u.name]));
      const memberCountByGroup = new Map<string, number>();
      ((membersRes.data || []) as { group_id: string }[]).forEach((m) => {
        memberCountByGroup.set(m.group_id, (memberCountByGroup.get(m.group_id) ?? 0) + 1);
      });

      const { hour: cairoNowHour, minute: cairoNowMinute } = getCurrentCairoClock();
      const nowMinutes = cairoNowHour * 60 + cairoNowMinute;
      const statusById = classifyTodaySchedule(scheduleSlotsToday, nowMinutes);

      const todaySchedule: TodayScheduleRow[] = scheduleSlotsToday
        .slice()
        .sort((a, b) => a.start_time.localeCompare(b.start_time))
        .map((s) => ({
          id: s.id,
          startTime: s.start_time,
          groupId: s.group_id,
          groupName: (s.group_id && groupNameById.get(s.group_id)) || tCommon('notAvailable'),
          roomName: (s.room_id && roomNameById.get(s.room_id)) || tCommon('notAvailable'),
          teacherName: (s.teacher_id && teacherNameById.get(s.teacher_id)) || '—',
          memberCount: (s.group_id && memberCountByGroup.get(s.group_id)) || 0,
          status: statusById.get(s.id) ?? 'later',
        }));
      const todaySessionsTotal = todaySchedule.length;
      const todaySessionsDone = todaySchedule.filter((s) => s.status === 'billed').length;
      const studentsExpectedToday = todaySchedule.reduce((sum, s) => sum + s.memberCount, 0);

      const todayPayments = paymentsData.filter(p => {
        if (!p.paid_at) return false;
        const d = new Date(p.paid_at);
        return d >= new Date(todayStart) && d <= todayEnd;
      });
      const todayRevenue = todayPayments.filter(p => p.confirmed).reduce((sum, p) => sum + parseFloat(String(p.amount || 0)), 0);

      const todayScans = scansData.filter(s => {
        const d = new Date(s.scanned_at);
        return d >= new Date(todayStart) && d <= todayEnd;
      });
      const attendanceCount = todayScans.length;

      const balanceList = Array.from(studentBalances.values());
      const unpaidCount = balanceList.filter((b) => b.balance > 0).length;

      // Merged-Center-Home §01 alert banner: oldest chargeable scan among
      // currently-unpaid students, same chargeability rule as studentBalance.ts
      // (not absent, not teacher-private billable) - bounded by the 30-day
      // scansData window already fetched above.
      const unpaidStudentIds = new Set(balanceList.filter((b) => b.balance > 0).map((b) => b.studentId));
      let oldestUnpaidMs: number | null = null;
      for (const s of scansData) {
        if (!unpaidStudentIds.has(s.student_id)) continue;
        if (s.status === 'absent') continue;
        if (s.billable === true) continue;
        const ms = new Date(s.scanned_at).getTime();
        if (Number.isNaN(ms)) continue;
        if (oldestUnpaidMs === null || ms < oldestUnpaidMs) oldestUnpaidMs = ms;
      }
      const unpaidLinksOldestDays =
        oldestUnpaidMs !== null
          ? Math.max(0, Math.round((startOfCairoDay(new Date()).getTime() - startOfCairoDay(new Date(oldestUnpaidMs)).getTime()) / 86400000))
          : null;

      // §01 "Digital share" is a Cairo-week figure, so the method split is
      // bucketed over the Cairo week's day keys and nothing else.
      const chartDayKeys: string[] = getCairoWeekDayKeys(new Date());
      const defaultMethods = { cash: 0, instapay: 0, vodafone: 0, orange: 0, fawry: 0, bank: 0, other: 0 };
      const revenueChartData: DashboardData['revenueChartData'] = chartDayKeys.map((dayKey) => {
        const byMethod = { ...defaultMethods };
        paymentsData.filter(p => p.confirmed && p.paid_at).forEach(p => {
          const d = new Date(p.paid_at!);
          if (d.toISOString().slice(0, 10) !== dayKey) return;
          const m = (p.method || 'cash').toLowerCase();
          const amt = parseFloat(String(p.amount || 0));
          if (m === 'cash') byMethod.cash += amt;
          else if (m === 'instapay') byMethod.instapay += amt;
          else if (m === 'vodafone_cash' || m === 'vodacash') byMethod.vodafone += amt;
          else if (m === 'orange' || m === 'orange_cash') byMethod.orange += amt;
          else if (m === 'fawry') byMethod.fawry += amt;
          else if (m === 'bank_transfer' || m === 'bank') byMethod.bank += amt;
          else byMethod.other += amt;
        });
        return { dayKey, ...byMethod };
      });

      const next: DashboardData = {
        todayAttendance: attendanceCount || 0,
        unpaidCount,
        todayRevenue,
        revenueChartData,
        todaySchedule,
        todaySessionsTotal,
        todaySessionsDone,
        studentsExpectedToday,
        unpaidLinksOldestDays,
        generatedAt: new Date().toISOString(),
      };
      setData(next);
      if (userId) {
        writeScopedDashboardCache({
          scope: { userId, centerId: cId },
          data: next,
          storage: typeof window !== 'undefined' ? window.sessionStorage : null,
        });
      }
      setDashboardDataFresh(true);
    } catch (err) {
      console.error('Dashboard load error:', err);
    }
  }, [tCommon, userId]);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const meRes = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const meData = await meRes.json();

      if (meData?.user && !meData.user.center_id) {
        const adminRes = await fetch('/api/admin/check', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const adminData = await adminRes.json();
        if (adminData?.isAdmin) {
          router.replace('/admin');
          return;
        }
      }

      if (meData?.user?.center_id) {
        // Center users must have can_view_dashboard to access dashboard
        const canView =
          meData.user.can_view_dashboard === true ||
          meData.user.role === 'owner' ||
          meData.user.role === 'admin' ||
          meData.user.role === 'super_admin';
        if (!canView) {
          router.replace('/attendance');
          return;
        }
        setCenterId(meData.user.center_id);
        setCenterBilling(meData.user.center ? {
          name: meData.user.center.name,
          plan: meData.user.center.plan,
        } : null);
      }
    };
    init();
  }, []);

  // Rehydrate from the scoped session cache once we know who the caller is.
  // Cache is scoped by user+center and TTL-bounded - see lib/dashboardCache.ts
  // for why an unscoped key caused per-session "ghost counts".
  useEffect(() => {
    if (!userId || !centerId) return;
    const cached = readScopedDashboardCache<DashboardData>({
      scope: { userId, centerId },
      now: Date.now(),
      storage: typeof window !== 'undefined' ? window.sessionStorage : null,
      validate: isDashboardCacheValid,
    });
    if (cached) setData(cached);
  }, [userId, centerId]);

  useEffect(() => {
    if (centerId) {
      loadDashboard(centerId);
    }
  }, [centerId, loadDashboard]);

  useEffect(() => {
    const fetchStats = async () => {
      if (!centerId) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      try {
        const res = await fetch('/api/dashboard/stats', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const json = await res.json();
          setStatsData(json);
        }
      } catch {
        // Non-fatal
      }
    };
    fetchStats();
  }, [centerId]);

  // Real-time updates
  useEffect(() => {
    if (!centerId) return;

    const refetchStats = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      try {
        const res = await fetch('/api/dashboard/stats', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) setStatsData(await res.json());
      } catch {
        // Non-fatal
      }
    };

    const channel = supabase
      .channel('dashboard-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_scans', filter: `center_id=eq.${centerId}` },
        () => {
          loadDashboard(centerId);
          void refetchStats();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments', filter: `center_id=eq.${centerId}` },
        () => {
          loadDashboard(centerId);
          void refetchStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [centerId, loadDashboard]);

  const safeData = data ?? EMPTY_DASHBOARD_DATA;

  // Merged-Center-Home §01 "Digital share": revenueChartData is already a
  // Cairo-week series - bucket its 6 real payment methods into online vs cash
  // rather than fetch anything new. §01 always draws this block, so a week with
  // nothing collected renders a real 0, not a hidden section.
  let digitalShareCash = 0;
  let digitalShareOnline = 0;
  for (const d of safeData.revenueChartData) {
    digitalShareCash += d.cash;
    digitalShareOnline += d.instapay + d.vodafone + d.orange + d.fawry + d.bank + d.other;
  }
  const digitalShareTotal = digitalShareCash + digitalShareOnline;
  const digitalSharePct = digitalShareTotal > 0 ? Math.round((digitalShareOnline / digitalShareTotal) * 100) : 0;

  const attendanceTodayCount = Number(statsData?.attendanceToday ?? safeData.todayAttendance ?? 0);
  // §01 "Attendance" tile: scanned-today over EXPECTED today (the sum of today's
  // schedule_slots member counts), not over the whole roster.
  const attendancePctOfExpectedToday =
    safeData.studentsExpectedToday > 0
      ? Math.min(100, Math.round((attendanceTodayCount / safeData.studentsExpectedToday) * 10000) / 100)
      : 0;
  const attendanceSplit = splitFormattedPercent(attendancePctOfExpectedToday, locale);

  const planKeyRaw = (centerBilling?.plan ?? 'starter').toLowerCase();
  const CENTER_PLAN_KEYS = ['solo', 'nano', 'starter', 'pro', 'business', 'enterprise'] as const;
  const planKeyForI18n = CENTER_PLAN_KEYS.includes(planKeyRaw as (typeof CENTER_PLAN_KEYS)[number])
    ? planKeyRaw
    : 'starter';
  const planLabel = tBilling(`planNames.${planKeyForI18n}` as 'billing.planNames.starter');

  const kpiStale = Boolean(data && !dashboardDataFresh);

  if (user?.role === 'assistant' && data !== null) {
    return (
      <div className="min-h-screen bg-[var(--color-surface-0)] p-4 pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:p-6 md:pb-6">
        <h1 className="mb-6 text-xl font-semibold text-[var(--color-text-primary)]">{t('title')}</h1>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link
            href="/attendance"
            className="rounded-md border border-[var(--color-line)] shadow-sm bg-[var(--color-panel)] p-6 text-center transition-colors hover:bg-[var(--color-surface-2)] btn-press chq-focus"
          >
            <QrCode className="mx-auto mb-3 h-14 w-14 text-teal-500" strokeWidth={1.5} />
            <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('action_scan')}</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('scanSubtitle')}</p>
          </Link>
          <Link
            href="/payments"
            className="rounded-md border border-[var(--color-line)] shadow-sm bg-[var(--color-panel)] p-6 transition-colors hover:bg-[var(--color-surface-2)] btn-press chq-focus"
          >
            <p className="text-xs font-medium text-[var(--color-text-muted)]">{t('unpaidCount')}</p>
            <p
              className={`mt-1 text-3xl font-bold text-[var(--color-text-primary)] tabular-nums transition-opacity duration-300 ${kpiStale ? 'opacity-70' : 'opacity-100'}`}
              style={{ fontFamily: 'Georgia, serif' }}
            >
              {formatNumber(Number(safeData.unpaidCount), locale)}
            </p>
            <p className="mt-2 text-sm text-teal-400">{t('goToPayments')}</p>
          </Link>
        </div>
        <div className="mt-4 rounded-md border border-[var(--color-line)] shadow-sm bg-[var(--color-panel)] p-4">
          <p className="text-xs font-medium text-[var(--color-text-muted)]">{t('stats.attendance_today')}</p>
          <p
            className={`mt-1 text-2xl font-bold text-[var(--color-text-primary)] tabular-nums transition-opacity duration-300 ${kpiStale ? 'opacity-70' : 'opacity-100'}`}
            style={{ fontFamily: 'Georgia, serif' }}
          >
            {formatNumber(Number(safeData.todayAttendance), locale)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-surface-0)] p-4 page-enter pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:p-6 md:pb-6">
      <div className="max-w-6xl">
        {/* §01 .topbar — centre name (.tt 17/700), Cairo date (.ts 11 muted),
            and the far-end pill (.vbadge). The design's pill reads "Verified";
            centre trust-verification state does not exist in the schema (no
            column on `centers`), so the slot keeps the plan name it already
            carried rather than fabricating a trust signal. */}
        <header className="mb-3 flex items-center gap-2">
          <div className="min-w-0 text-start">
            <h1 className="truncate text-lg font-bold leading-tight text-[var(--color-text-primary)]">
              <bdi dir="auto">{centerBilling?.name ?? 'TutoringHQ'}</bdi>
            </h1>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]" suppressHydrationWarning>
              {formatDate(new Date(), locale, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </p>
          </div>
          <span className="ms-auto shrink-0 rounded-pill border border-[var(--color-accent)]/[0.22] bg-[var(--color-mint)] px-3 py-1 text-xs font-bold text-[var(--color-accent-deep)]">
            {planLabel}
          </span>
        </header>

        {data === null ? (
          <div aria-busy="true">
            <div className="grid grid-cols-2 gap-2">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3"
                  aria-hidden
                >
                  <div className="h-3 w-24 rounded-xs bg-[var(--color-surface-2)] animate-pulse" />
                  <div className="mt-1 h-6 w-16 rounded-xs bg-[var(--color-surface-2)] animate-pulse" />
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-4" aria-hidden>
              <div className="h-6 w-20 rounded-xs bg-[var(--color-surface-2)] animate-pulse" />
              <div className="mt-2 h-[9px] w-full rounded-pill bg-[var(--color-surface-2)] animate-pulse" />
              <div className="mt-2 h-3 w-40 rounded-xs bg-[var(--color-surface-2)] animate-pulse" />
            </div>
            <div className="mt-3 space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-3"
                  aria-hidden
                >
                  <div className="h-8 w-[52px] shrink-0 rounded-xs bg-[var(--color-surface-2)] animate-pulse" />
                  <div className="min-w-0 flex-1">
                    <div className="h-3 w-28 rounded-xs bg-[var(--color-surface-2)] animate-pulse" />
                    <div className="mt-1 h-3 w-40 rounded-xs bg-[var(--color-surface-2)] animate-pulse" />
                  </div>
                  <div className="h-6 w-14 shrink-0 rounded-pill bg-[var(--color-surface-2)] animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* §01 .alert — sand fill, brass ink, 20px alert glyph, action pinned
                to the far end. The design's balance card (.bal) is deliberately
                absent: it shows money TutoringHQ would hold on the centre's
                behalf, which needs the payout system and online collection.
                Neither exists, so it is omitted rather than stubbed. */}
            {safeData.unpaidCount > 0 && (
              <div className="mb-3 flex items-center gap-2 rounded-md border border-[var(--color-brass)]/25 bg-[var(--color-sand)] px-4 py-3">
                <AlertCircle className="h-5 w-5 shrink-0 text-[var(--color-brass)]" aria-hidden />
                <div className="min-w-0">
                  <p className="text-base font-bold text-[var(--color-brass)]">
                    {t('unpaidLinksTitle', { count: formatNumber(safeData.unpaidCount, locale) })}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-brass)]/85">
                    {safeData.unpaidLinksOldestDays != null
                      ? t('unpaidLinksSub', {
                          students: formatNumber(safeData.unpaidCount, locale),
                          days: formatNumber(safeData.unpaidLinksOldestDays, locale),
                        })
                      : `${formatNumber(safeData.unpaidCount, locale)} ${tCommon('students')}`}
                  </p>
                </div>
                <Link
                  href="/students?filter=unpaid"
                  className="ms-auto shrink-0 rounded-sm bg-[var(--color-brass)] px-3 py-2 text-xs font-bold text-[var(--color-panel)] transition-opacity hover:opacity-90 btn-press chq-focus"
                >
                  {t('reviewAction')}
                </Link>
              </div>
            )}

            <SectionHeader title={tCommon('sectionToday')} />
            {/* §01 .kpis — gap 8, mb 4. The suffix runs ("· 1 done", "%") are a
                nested 11px/500 muted span inside the 17px/700 value (.kv span). */}
            <div className={`mb-1 grid grid-cols-2 gap-2 transition-opacity duration-300 ${kpiStale ? 'opacity-70' : 'opacity-100'}`}>
              <KpiCard
                label={t('sessionsLabel')}
                value={
                  <>
                    {formatNumber(safeData.todaySessionsTotal, locale)}{' '}
                    <span className="text-xs font-medium text-[var(--color-text-muted)]">
                      {'· '}
                      {t('sessionsDoneSuffix', { count: formatNumber(safeData.todaySessionsDone, locale) })}
                    </span>
                  </>
                }
              />
              <KpiCard label={t('studentsExpectedLabel')} value={formatNumber(safeData.studentsExpectedToday, locale)} />
              {/* §01 shows "Collected" as a bare number — the currency mark lives
                  on the share total only. */}
              <KpiCard label={t('collected')} value={formatNumber(safeData.todayRevenue, locale)} />
              <KpiCard
                label={t('attendanceShort')}
                value={
                  <>
                    {attendanceSplit.value}
                    <span className="text-xs font-medium text-[var(--color-text-muted)]">{attendanceSplit.sign}</span>
                  </>
                }
              />
            </div>

            <SectionHeader title={t('digitalShareTitle')} sub={t('digitalShareSub')} />
            {/* §01 .share — the percent at 22/700 at the start edge, the total
                pushed to the opposite edge; a 9px split track over paper. */}
            <div className="mb-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="num text-xl font-bold text-[var(--color-text-primary)]">
                  {formatPercent(digitalSharePct, locale)}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {t('digitalShareTotal', { amount: formatCurrency(digitalShareTotal, locale) })}
                </span>
              </div>
              <div className="flex h-[9px] w-full overflow-hidden rounded-pill bg-[var(--color-paper)]">
                <div className="h-full bg-[var(--color-accent)]" style={{ width: `${digitalSharePct}%` }} />
                <div
                  className="h-full bg-[var(--color-brass)]"
                  style={{ width: `${digitalShareTotal > 0 ? 100 - digitalSharePct : 0}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-3">
                <span className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]" aria-hidden />
                  {t('online')} {formatNumber(digitalShareOnline, locale)}
                </span>
                <span className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-brass)]" aria-hidden />
                  {t('methodCash')} {formatNumber(digitalShareCash, locale)}
                </span>
              </div>
            </div>

            <SectionHeader
              title={t('todaySchedule')}
              sub={formatDate(new Date(), locale, { weekday: 'long' })}
            />
            {safeData.todaySchedule.length > 0 ? (
              <div className="space-y-2">
                {safeData.todaySchedule.map((s) => (
                  <ListRow
                    key={s.id}
                    title={s.groupName}
                    meta={
                      <>
                        <span className="block font-bold text-[var(--color-ink)]" dir="ltr">
                          {formatTime(s.startTime.slice(0, 5), locale)}
                        </span>
                        <span className="block">
                          {s.teacherName} · {s.roomName} · {formatNumber(s.memberCount, locale)}
                        </span>
                      </>
                    }
                    onOpen={s.groupId ? () => router.push(`/attendance?group=${s.groupId}&date=${cairoDateKey()}&tab=scan`) : undefined}
                    badge={
                      /* §01 .schip — 11px/700, padding 4/12, pill.
                         .sdone mint + accent · .snext mint + accent-deep · .slater paper + muted */
                      <span
                        className={`shrink-0 rounded-pill px-3 py-1 text-xs font-bold ${
                          s.status === 'billed'
                            ? 'bg-[var(--color-mint)] text-[var(--color-accent)]'
                            : s.status === 'next'
                              ? 'bg-[var(--color-mint)] text-[var(--color-accent-deep)]'
                              : 'bg-[var(--color-paper)] text-[var(--color-text-muted)]'
                        }`}
                      >
                        {s.status === 'billed' ? t('chipBilled') : s.status === 'next' ? t('chipNext') : t('chipLater')}
                      </span>
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)]">
                <EmptyState
                  icon={Calendar}
                  title={tEmpty('todaySchedule.title')}
                  description={tEmpty('todaySchedule.description')}
                  action={
                    <Link
                      href="/schedule"
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white transition-all duration-150 hover:bg-teal-700"
                    >
                      {tEmpty('todaySchedule.action')}
                    </Link>
                  }
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
