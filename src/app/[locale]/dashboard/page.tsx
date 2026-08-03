'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect } from '@/lib/db-proxy';
import { getStudentBalances } from '@/lib/studentBalance';
import { exportDashboardToExcel } from '@/lib/excel-export';
import { hasPlanFeature } from '@/lib/plans';
import { useUser } from '@/contexts/UserContext';
import { Link } from '@/i18n/routing';
import PlanUsageCard from '@/components/dashboard/PlanUsageCard';
import { EmptyState, KpiCard, SectionHeader } from '@/components/shared';
import ListRow from '@/components/patterns/ListRow';

import { formatDate, formatNumber, formatPercent, formatCurrency, formatTime } from '@/lib/formatNumber';
import { getCairoWeekDayKeys, startOfCairoWeek, scheduleSlotsDayOfWeek } from '@/lib/cairo/week';
import { cairoDateKey, startOfCairoDay, getCurrentCairoClock } from '@/lib/cairo/day';
import { classifyTodaySchedule } from '@/lib/todayScheduleStatus';
import { type InactivePeriod, type InactiveStudent } from '@/components/dashboard/InactiveList';
import {
  readDashboardCache as readScopedDashboardCache,
  writeDashboardCache as writeScopedDashboardCache,
} from '@/lib/dashboardCache';
import {
  QrCode,
  X,
  MoreVertical,
  Calendar,
  AlertCircle,
} from 'lucide-react';

export interface RecentPaymentRow {
  id: string;
  student_name: string;
  student_number?: string;
  group_name?: string;
  amount: number;
  status: string;
  confirmed?: boolean;
}

interface DashboardData {
  todayAttendance: number;
  totalStudents: number;
  paidCount: number;
  unpaidCount: number;
  pendingCount: number;
  todayRevenue: number;
  totalPending: number;
  revenueByMethod: { method: string; amount: number }[];
  trendData: { dayKey: string; count: number }[];
  revenueChartData: {
    date: string;
    dayKey: string;
    cash: number;
    instapay: number;
    vodafone: number;
    orange: number;
    fawry: number;
    bank: number;
    other: number;
  }[];
  recentPayments: RecentPaymentRow[];
  monthTotal: number;
  monthConfirmed: number;
  monthPending: number;
  monthLate: number;
  weeklyTrendPct: number;
  /** Cairo-week scan totals for formatGrowth vs prior week. */
  thisWeekScanTotal: number;
  lastWeekScanTotal: number;
  collectionRatePct: number;
  newStudentsCount: number;
  inactiveStudents: InactiveStudent[];
  yesterdayAttendanceCount: number;
  yesterdayRevenueAmount: number;
  pendingInvoicesCount: number;
  latePaymentCount: number;
  studentSparkline7d: number[];
  /** ISO timestamp when dashboard aggregate was computed (client fetch). */
  generatedAt?: string;
  /** Merged-Center-Home §01 "Today": today's schedule_slots, Cairo day-of-week. */
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
  totalStudents: 0,
  paidCount: 0,
  unpaidCount: 0,
  pendingCount: 0,
  todayRevenue: 0,
  totalPending: 0,
  revenueByMethod: [],
  trendData: [],
  revenueChartData: [],
  recentPayments: [],
  monthTotal: 0,
  monthConfirmed: 0,
  monthPending: 0,
  monthLate: 0,
  weeklyTrendPct: 0,
  thisWeekScanTotal: 0,
  lastWeekScanTotal: 0,
  collectionRatePct: 0,
  newStudentsCount: 0,
  inactiveStudents: [],
  yesterdayAttendanceCount: 0,
  yesterdayRevenueAmount: 0,
  pendingInvoicesCount: 0,
  latePaymentCount: 0,
  studentSparkline7d: [],
  todaySchedule: [],
  todaySessionsTotal: 0,
  todaySessionsDone: 0,
  studentsExpectedToday: 0,
  unpaidLinksOldestDays: null,
};

function isDashboardCacheValid(p: unknown): p is DashboardData {
  if (!p || typeof p !== 'object') return false;
  const o = p as DashboardData;
  if (!Array.isArray(o.trendData)) return false;
  // Merged-Center-Home §01: reject a cache blob written before this field
  // existed, rather than render it with todaySchedule undefined.
  if (!Array.isArray(o.todaySchedule)) return false;
  if (o.trendData.length === 0) return true;
  const row = o.trendData[0];
  return (
    typeof row === 'object' &&
    row !== null &&
    'dayKey' in row &&
    typeof (row as { dayKey: unknown }).dayKey === 'string' &&
    typeof (row as { count: unknown }).count === 'number'
  );
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tSettings = useTranslations('settings');
  const tCommon = useTranslations('common');
  const tBilling = useTranslations('billing');
  const tEmpty = useTranslations('emptyStates');
  const locale = useLocale();
  const router = useRouter();
  const { user } = useUser();
  const [centerBilling, setCenterBilling] = useState<{ payment_due_date?: string; billing_status?: string; name?: string; plan?: string; export_access?: boolean } | null>(null);
  const [planUsage, setPlanUsage] = useState<{ plan: string; weeklyUniqueStudents: number; studentLimit: number } | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [dashboardDataFresh, setDashboardDataFresh] = useState(false);
  // No UI changes either of these today; the setters were already unreachable before
  // the Merged-Center-Home cleanup, so only the values are destructured.
  const [inactivePeriod] = useState<InactivePeriod>('7d');
  const [timeRange] = useState<'7' | '30'>('7');
  const [centerId, setCenterId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [statsData, setStatsData] = useState<{
    revenueToday: number;
    activeStudentsThisWeek: number;
    attendanceToday: number;
    pendingBalance: number;
    monthlyRevenue: { month: string; amount: number }[];
    recentActivity: { type: 'payment' | 'scan'; student: string; detail: string; time: string }[];
    enrollment_surge_active?: boolean;
    enrollment_surge_days?: number | null;
  } | null>(null);
  const [surgeDismissed, setSurgeDismissed] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);

  type DashboardGreetingKey = 'goodMorning' | 'goodAfternoon' | 'goodEvening';
  const [greetingKey, setGreetingKey] = useState<DashboardGreetingKey>('goodMorning');
  useEffect(() => {
    const hour = new Date().getHours();
    setGreetingKey(hour < 12 ? 'goodMorning' : hour < 17 ? 'goodAfternoon' : 'goodEvening');
  }, []);

  const greetingComma = locale === 'ar' ? '\u060C\u00A0' : ',\u00A0';

  const startOfToday = () => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  };

  const periodDays: Record<InactivePeriod, number> = {
    '7d': 7, '14d': 14, '30d': 30, '3mo': 90, '6mo': 180, '1yr': 365,
  };

  const loadDashboard = useCallback(async (cId: string, inactPeriod: InactivePeriod = '7d', range: 7 | 30 = 7) => {
    try {
      const todayStart = startOfToday();
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59).toISOString();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const todayCairoKey = cairoDateKey();
      const todayDow = scheduleSlotsDayOfWeek(todayCairoKey);

      // Batch 1: 6 parallel queries
      const [
        paymentsResult,
        attendanceResult,
        studentsResult,
        recentPaymentsResult,
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
        dbSelect({
          table: 'students',
          select: 'id, name, subject, fee, payment_status, student_number, created_at',
          filters: [{ column: 'center_id', op: 'eq', value: cId }],
        }),
        dbSelect({
          table: 'payments',
          select: 'id, student_id, amount, status, confirmed, group_id, paid_at, students(name, student_number), student_groups(name)',
          filters: [
            { column: 'center_id', op: 'eq', value: cId },
            { column: 'paid_at', op: 'gte', value: monthStart },
          ],
          order: { column: 'paid_at', ascending: false },
          limit: 10,
        }),
        // Real per-student balances (D3: students.payment_status is write-once-at-insert,
        // never updated after — paidCount/unpaidCount must come from here, not that column.
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
      const students = (studentsResult.data || []) as { id: string; name: string; subject: string; fee: number; payment_status: string; student_number?: string; created_at: string }[];
      const recentPaymentsRaw = (recentPaymentsResult.data || []) as { id: string; student_id: string; amount: number; status: string; confirmed?: boolean; group_id?: string; students?: { name?: string; student_number?: string } | null; student_groups?: { name?: string } | null }[];
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

      // Derive KPIs from payments
      const todayPayments = paymentsData.filter(p => {
        if (!p.paid_at) return false;
        const d = new Date(p.paid_at);
        return d >= new Date(todayStart) && d <= todayEnd;
      });
      const todayRevenue = todayPayments.filter(p => p.confirmed).reduce((sum, p) => sum + parseFloat(String(p.amount || 0)), 0);
      const allPending = paymentsData.filter(p => !p.confirmed && p.status === 'pending');
      const totalPending = allPending.reduce((sum, p) => sum + parseFloat(String(p.amount || 0)), 0);

      const monthPmts = paymentsData.filter(p => p.paid_at && p.paid_at >= monthStart && p.paid_at <= monthEnd);
      const monthTotal = monthPmts.reduce((sum, p) => sum + parseFloat(String(p.amount || 0)), 0);
      const monthConfirmed = monthPmts.filter(p => p.confirmed).reduce((sum, p) => sum + parseFloat(String(p.amount || 0)), 0);
      const monthPending = monthPmts.filter(p => !p.confirmed && p.status === 'pending').reduce((sum, p) => sum + parseFloat(String(p.amount || 0)), 0);
      const monthLate = monthPmts.filter(p => p.status === 'late').reduce((sum, p) => sum + parseFloat(String(p.amount || 0)), 0);

      const methodMap = new Map<string, number>();
      monthPmts.filter(p => p.confirmed).forEach(p => {
        const method = p.method || 'cash';
        methodMap.set(method, (methodMap.get(method) || 0) + parseFloat(String(p.amount || 0)));
      });
      const revenueByMethod = Array.from(methodMap.entries()).map(([method, amount]) => ({ method, amount }));

      const todayScans = scansData.filter(s => {
        const d = new Date(s.scanned_at);
        return d >= new Date(todayStart) && d <= todayEnd;
      });
      const attendanceCount = todayScans.length;

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStart = new Date(yesterday);
      yesterdayStart.setHours(0, 0, 0, 0);
      const yesterdayEnd = new Date(yesterday);
      yesterdayEnd.setHours(23, 59, 59, 999);
      const yesterdayScans = scansData.filter(s => {
        const d = new Date(s.scanned_at);
        return d >= yesterdayStart && d <= yesterdayEnd;
      });
      const yesterdayAttendance = yesterdayScans.length;
      const yesterdayRev = paymentsData.filter(p => {
        if (!p.paid_at || !p.confirmed) return false;
        const d = new Date(p.paid_at);
        return d >= yesterdayStart && d <= yesterdayEnd;
      }).reduce((sum, p) => sum + parseFloat(String(p.amount || 0)), 0);

      const balanceList = Array.from(studentBalances.values());
      const unpaidCount = balanceList.filter((b) => b.balance > 0).length;
      const paidCount = balanceList.filter((b) => b.balance <= 0).length;

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

      // Trend data: Cairo week (7d) or rolling N days
      const chartDayKeys: string[] =
        range === 7
          ? getCairoWeekDayKeys(new Date())
          : Array.from({ length: range }, (_, i) => {
              const day = new Date();
              day.setDate(day.getDate() - (range - 1 - i));
              return day.toISOString().slice(0, 10);
            });

      const scansByDate: Record<string, number> = {};
      chartDayKeys.forEach((k) => {
        scansByDate[k] = 0;
      });
      scansData.forEach(s => {
        const key = s.scanned_at?.slice(0, 10);
        if (key && key in scansByDate) scansByDate[key]++;
      });
      const trendData: { dayKey: string; count: number }[] = chartDayKeys.map((dayKey) => ({
        dayKey,
        count: scansByDate[dayKey] ?? 0,
      }));

      // Revenue chart: group payments by date and method (same day keys as attendance trend)
      const defaultMethods = { cash: 0, instapay: 0, vodafone: 0, orange: 0, fawry: 0, bank: 0, other: 0 };
      const revenueChartData: {
        date: string;
        dayKey: string;
        cash: number;
        instapay: number;
        vodafone: number;
        orange: number;
        fawry: number;
        bank: number;
        other: number;
      }[] = [];
      chartDayKeys.forEach((dayKey) => {
        const day = new Date(`${dayKey}T12:00:00`);
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
        revenueChartData.push({
          date: `${day.getDate()}/${day.getMonth() + 1}`,
          dayKey,
          ...byMethod,
        });
      });

      const recentPayments: RecentPaymentRow[] = recentPaymentsRaw.map(p => ({
        id: p.id,
        student_name: p.students?.name ?? tCommon('notAvailable'),
        student_number: p.students?.student_number,
        group_name: p.student_groups?.name,
        amount: parseFloat(String(p.amount || 0)),
        status: p.confirmed === true ? 'confirmed' : (p.status === 'late' ? 'late' : 'pending'),
        confirmed: p.confirmed,
      }));

      const now = new Date();
      const cairoWeekStart = startOfCairoWeek(now);
      const thisWeekEnd = new Date(cairoWeekStart);
      thisWeekEnd.setDate(cairoWeekStart.getDate() + 6);
      thisWeekEnd.setHours(23, 59, 59, 999);
      const lastWeekStart = new Date(cairoWeekStart);
      lastWeekStart.setDate(cairoWeekStart.getDate() - 7);
      const lastWeekEnd = new Date(lastWeekStart);
      lastWeekEnd.setDate(lastWeekStart.getDate() + 6);
      lastWeekEnd.setHours(23, 59, 59, 999);
      const thisWeekScans = scansData.filter(s => {
        const d = new Date(s.scanned_at);
        return d >= cairoWeekStart && d <= thisWeekEnd;
      });
      const lastWeekScans = scansData.filter(s => {
        const d = new Date(s.scanned_at);
        return d >= lastWeekStart && d <= lastWeekEnd;
      });
      const thisWeek = thisWeekScans.length;
      const lastWeek = lastWeekScans.length;
      const weeklyTrendPct = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : 0;
      const collectionRatePct = monthTotal > 0 ? Math.round((monthConfirmed / monthTotal) * 100) : 0;

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const newStudentsCount = students.filter(s => new Date(s.created_at) >= sevenDaysAgo).length;

      const lastScanByStudent: Record<string, string> = {};
      scansData.forEach(s => {
        if (!lastScanByStudent[s.student_id]) lastScanByStudent[s.student_id] = s.scanned_at;
      });

      const periodD = periodDays[inactPeriod];
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - periodD);
      const inactiveStudents: InactiveStudent[] = students
        .map(st => {
          const lastScannedAt = lastScanByStudent[st.id] || null;
          const lastDate = lastScannedAt ? new Date(lastScannedAt) : null;
          if (lastDate && lastDate >= cutoffDate) return null;
          const daysAbsent = lastDate ? Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
          return {
            id: st.id,
            name: st.name || tCommon('notAvailable'),
            student_number: st.student_number || tCommon('notSet'),
            last_scanned_at: lastScannedAt,
            days_absent: daysAbsent,
          };
        })
        .filter((s): s is InactiveStudent => s !== null);
      inactiveStudents.sort((a, b) => (b.days_absent || 0) - (a.days_absent || 0));

      const pendingInvoicesCount = allPending.length;
      const latePaymentCount = monthPmts.filter((p) => p.status === 'late').length;
      const studentSparkline7d: number[] = [];
      for (let i = 6; i >= 0; i--) {
        const end = new Date();
        end.setDate(end.getDate() - i);
        end.setHours(23, 59, 59, 999);
        studentSparkline7d.push(students.filter((s) => new Date(s.created_at) <= end).length);
      }

      const next: DashboardData = {
        todayAttendance: attendanceCount || 0,
        totalStudents: students.length,
        paidCount,
        unpaidCount,
        // Balance model has no per-student "pending" state (a pending payment already
        // counts toward `paid`, see studentBalance.ts) - reuse the payments-level
        // pending count the page already computes correctly, instead of the old
        // students.payment_status === 'pending' read (same dead column as above).
        pendingCount: pendingInvoicesCount,
        todayRevenue,
        totalPending,
        revenueByMethod,
        trendData,
        revenueChartData,
        recentPayments,
        monthTotal,
        monthConfirmed,
        monthPending,
        monthLate,
        weeklyTrendPct,
        thisWeekScanTotal: thisWeek,
        lastWeekScanTotal: lastWeek,
        collectionRatePct,
        newStudentsCount: newStudentsCount || 0,
        inactiveStudents,
        yesterdayAttendanceCount: yesterdayAttendance,
        yesterdayRevenueAmount: yesterdayRev,
        pendingInvoicesCount,
        latePaymentCount,
        studentSparkline7d,
        generatedAt: new Date().toISOString(),
        todaySchedule,
        todaySessionsTotal,
        todaySessionsDone,
        studentsExpectedToday,
        unpaidLinksOldestDays,
      };
      setData(next);
      if (user?.id) {
        writeScopedDashboardCache({
          scope: { userId: user.id, centerId: cId },
          data: next,
          storage: typeof window !== 'undefined' ? window.sessionStorage : null,
        });
      }
      setDashboardDataFresh(true);
    } catch (err) {
      console.error('Dashboard load error:', err);
    }
  }, [tCommon, user?.id]);

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
          payment_due_date: meData.user.center.payment_due_date,
          billing_status: meData.user.center.billing_status,
          name: meData.user.center.name,
          plan: meData.user.center.plan,
          export_access: meData.user.center.export_access,
        } : null);
        // Fetch plan usage in parallel (don't block dashboard load)
        fetch('/api/settings/limits', {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        })
          .then((res) => res.ok ? res.json() : null)
          .then((limitsData) => {
            if (limitsData) {
              setPlanUsage({
                plan: limitsData.plan || 'starter',
                weeklyUniqueStudents: limitsData.weeklyUniqueStudents ?? 0,
                studentLimit: limitsData.studentLimit ?? 150,
              });
            }
          })
          .catch(() => {});
      }
    };
    init();
  }, []);

  // Rehydrate from the scoped session cache once we know who the caller is.
  // Cache is scoped by user+center and TTL-bounded - see lib/dashboardCache.ts
  // for why an unscoped key caused per-session "ghost counts".
  useEffect(() => {
    if (!user?.id || !centerId) return;
    const cached = readScopedDashboardCache<DashboardData>({
      scope: { userId: user.id, centerId },
      now: Date.now(),
      storage: typeof window !== 'undefined' ? window.sessionStorage : null,
      validate: isDashboardCacheValid,
    });
    if (cached) setData(cached);
  }, [user?.id, centerId]);

  useEffect(() => {
    if (centerId) {
      loadDashboard(centerId, inactivePeriod, timeRange === '30' ? 30 : 7);
    }
  }, [centerId, inactivePeriod, timeRange, loadDashboard]);

  useEffect(() => {
    const key = centerId ? `surge-dismissed-${centerId}` : '';
    setSurgeDismissed(typeof window !== 'undefined' && key ? localStorage.getItem(key) === '1' : false);
  }, [centerId]);

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
          loadDashboard(centerId, inactivePeriod, timeRange === '30' ? 30 : 7);
          void refetchStats();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments', filter: `center_id=eq.${centerId}` },
        () => {
          loadDashboard(centerId, inactivePeriod, timeRange === '30' ? 30 : 7);
          void refetchStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [centerId, inactivePeriod, timeRange, loadDashboard]);

  const canExportExcel = hasPlanFeature(centerBilling?.plan, 'excel_export');
  // W4: CUSTOMER data export is paid-only during the free trial. Default to
  // allowed while /api/me is still loading (undefined) so we never flash a
  // wrongly-gated button; only an explicit `false` gates.
  const exportAccess = centerBilling?.export_access !== false;

  const handleExport = useCallback(async () => {
    if (!centerId) return;
    // Defense-in-depth: the button is hidden when gated, but never run the export
    // for a trial center that hasn't paid even if this handler is reached.
    if (!exportAccess) return;
    if (!canExportExcel) {
      setShowUpgradeModal(true);
      return;
    }
    setIsExporting(true);
    try {
      const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const [studentsRes, attendanceRes, paymentsRes, exportBalances] = await Promise.all([
        dbSelect({
          table: 'students',
          select: 'id, name, phone, parent_phone, subject, qr_code',
          filters: [{ column: 'center_id', op: 'eq', value: centerId }],
          order: { column: 'name' },
        }),
        dbSelect({
          table: 'attendance_scans',
          select: 'student_id, scanned_at',
          filters: [
            { column: 'center_id', op: 'eq', value: centerId },
            { column: 'scanned_at', op: 'gte', value: startOfMonth },
          ],
          order: { column: 'scanned_at', ascending: false },
          limit: 500,
        }),
        dbSelect({
          table: 'payments',
          select: 'student_id, amount, method, paid_at, recorded_by',
          filters: [
            { column: 'center_id', op: 'eq', value: centerId },
            { column: 'paid_at', op: 'gte', value: startOfMonth },
          ],
          order: { column: 'paid_at', ascending: false },
          limit: 500,
        }),
        // D3: students.payment_status never updates after insert - the exported
        // "الحالة" column must come from real balances, same as the KPI/pie fix above.
        getStudentBalances(supabase, { centerId }),
      ]);
      const students = (studentsRes.data || []) as { id: string; name: string; phone?: string; parent_phone?: string; subject?: string; qr_code?: string }[];
      const attendanceRaw = (attendanceRes.data || []) as { student_id: string; scanned_at: string }[];
      const paymentsRaw = (paymentsRes.data || []) as { student_id: string; amount: number; method: string; paid_at: string; recorded_by: string }[];
      const studentMap = new Map(students.map(s => [s.id, s]));
      const studentsWithBalance = students.map((s) => ({
        ...s,
        balance: exportBalances.get(s.id)?.balance ?? 0,
      }));
      await exportDashboardToExcel({
        students: studentsWithBalance,
        attendance: attendanceRaw.map(a => ({
          student_name: studentMap.get(a.student_id)?.name || '',
          scanned_at: a.scanned_at,
          payment_status_at_scan: '',
        })),
        payments: paymentsRaw.map(p => ({
          student_name: studentMap.get(p.student_id)?.name || '',
          amount: p.amount,
          method: p.method,
          paid_at: p.paid_at,
          recorded_by: '',
        })),
      });
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setIsExporting(false);
    }
  }, [centerId, canExportExcel, exportAccess]);

  const safeData = data ?? EMPTY_DASHBOARD_DATA;

  // Merged-Center-Home §01 "Digital share": revenueChartData is already a
  // Cairo-week series (range defaults to 7 and nothing in this file's UI ever
  // changes it) - bucket its 6 real payment methods into online vs cash rather
  // than fetch anything new.
  const digitalShare = useMemo(() => {
    let cash = 0;
    let online = 0;
    for (const d of safeData.revenueChartData) {
      cash += d.cash;
      online += d.instapay + d.vodafone + d.orange + d.fawry + d.bank + d.other;
    }
    const total = cash + online;
    if (total <= 0) return null;
    return { cash, online, total, pct: Math.round((online / total) * 100) };
  }, [safeData.revenueChartData]);

  const attendanceTodayCount = Number(statsData?.attendanceToday ?? safeData.todayAttendance ?? 0);
  // Merged-Center-Home §01 "Today" tile: the design's "Attendance 94%" is scanned-today
  // over EXPECTED today (todaySchedule's member count), not over the whole roster -
  // a different denominator than the pre-existing "At a glance" tile above, which is
  // intentionally left alone since it's already relied on and out of this pass's scope.
  const attendancePctOfExpectedToday =
    safeData.studentsExpectedToday > 0
      ? Math.min(100, Math.round((attendanceTodayCount / safeData.studentsExpectedToday) * 10000) / 100)
      : 0;

  const paymentDueBanner = (() => {
    if (!centerBilling?.payment_due_date || centerBilling.billing_status === 'paid') return null;
    const dueDate = new Date(centerBilling.payment_due_date);
    const now = Date.now();
    const diffMs = dueDate.getTime() - now;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays > 0 && diffDays <= 5) {
      return (
        <div className="mb-4 p-4 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-surface-2)] flex flex-wrap items-center justify-between gap-4" suppressHydrationWarning>
          <span className="text-[var(--color-warning)] font-medium text-sm">
            {t('paymentDue', { days: diffDays, defaultValue: `Payment due in ${diffDays} days` })}
          </span>
          <button
            type="button"
            onClick={() => router.push('/settings/billing')}
            className="px-4 py-2 rounded-lg font-medium text-primary-foreground bg-[var(--color-warning)] hover:opacity-90 transition-opacity btn-press chq-focus"
          >
            {t('payNow', { defaultValue: 'Pay Now' })}
          </button>
        </div>
      );
    }

    if (diffDays <= 0) {
      const suspendDate = new Date(centerBilling.payment_due_date);
      suspendDate.setDate(suspendDate.getDate() + 7);

      const hoursRemaining = Math.max(
        0,
        Math.floor((suspendDate.getTime() - now) / (1000 * 60 * 60))
      );

      if (hoursRemaining <= 0) {
        return (
          <div className="mb-4 p-4 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-surface-2)] flex flex-wrap items-center justify-between gap-4" suppressHydrationWarning>
            <span className="text-[var(--color-danger)] font-medium text-sm">
              {t('accountSuspended', { defaultValue: 'Account suspended due to overdue payment.' })}
            </span>
            <button
              type="button"
              onClick={() => router.push('/settings/billing')}
              className="px-4 py-2 rounded-lg font-medium text-primary-foreground bg-[var(--color-danger)] hover:opacity-90 transition-opacity btn-press chq-focus"
            >
              {t('payNow', { defaultValue: 'Pay Now' })}
            </button>
          </div>
        );
      }

      return (
        <div className="mb-4 p-4 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-surface-2)] flex flex-wrap items-center justify-between gap-4" suppressHydrationWarning>
          <span className="text-[var(--color-danger)] font-medium text-sm">
            {t('paymentOverdue', {
              hours: hoursRemaining,
              defaultValue: `Payment overdue! Account will be suspended in ${hoursRemaining} hours`,
            })}
          </span>
          <button
            type="button"
            onClick={() => router.push('/settings/billing')}
            className="px-4 py-2 rounded-lg font-medium text-primary-foreground bg-[var(--color-danger)] hover:opacity-90 transition-opacity btn-press chq-focus"
          >
            {t('payNow', { defaultValue: 'Pay Now' })}
          </button>
        </div>
      );
    }
    return null;
  })();

  const showSurgeAlert = statsData?.enrollment_surge_active && !surgeDismissed;
  const dismissSurge = () => {
    setSurgeDismissed(true);
    if (centerId && typeof window !== 'undefined') {
      localStorage.setItem(`surge-dismissed-${centerId}`, '1');
    }
  };

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
      {showSurgeAlert && statsData?.enrollment_surge_days != null && (
        <div
          className="card mb-4 p-4 border-[var(--color-border-brand)] flex items-center justify-between gap-4"
        >
          <span className="text-sm font-medium text-[var(--color-text-primary)]">
            {t('examSurgeAlert', { days: formatNumber(statsData.enrollment_surge_days, locale) })}
          </span>
          <button
            type="button"
            onClick={dismissSurge}
            className="p-2 rounded-lg text-brand-400 hover:bg-[var(--color-surface-3)] transition-colors btn-press chq-focus"
            aria-label={tCommon('cancel')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
      {paymentDueBanner}

      <header className="mb-6 flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 text-start">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">
              {t(greetingKey)}
              {greetingComma}
              <span className="whitespace-nowrap">
                <bdi dir="auto">{centerBilling?.name ?? 'TutoringHQ'}</bdi>
              </span>
            </h1>
            {/* .pill0 in Merged-Center-Home §01: mint fill, accent-deep ink.
                Was text-teal-300 on an inline rgba(13,148,136,.2) — the old
                brand-500 teal, which is not a §4 colour. */}
            <span className="inline-block rounded-pill bg-[var(--color-mint)] px-3 py-1 text-xs font-semibold text-[var(--color-accent-deep)]">
              {planLabel}
            </span>
          </div>
          {/* .ts in the design's topbar: 11px, muted. */}
          <p
            className="mt-1 text-xs text-[var(--color-text-muted)]"
            suppressHydrationWarning
          >
            {formatDate(new Date(), locale, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setShowActionsMenu((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={showActionsMenu}
            aria-label={t('moreActions')}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5 text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-3)] btn-press chq-focus"
          >
            <MoreVertical className="h-5 w-5" aria-hidden />
          </button>
          {showActionsMenu ? (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowActionsMenu(false)} />
              <div
                role="menu"
                className="absolute end-0 top-full z-20 mt-2 w-52 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-1.5 shadow-lg"
              >
                {exportAccess ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowActionsMenu(false);
                      void handleExport();
                    }}
                    disabled={isExporting || data === null}
                    className="flex w-full items-center rounded-lg px-3 py-2 text-start text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                  >
                    {isExporting ? t('exporting') : t('exportData')}
                  </button>
                ) : (
                  <Link
                    href="/settings/billing"
                    role="menuitem"
                    onClick={() => setShowActionsMenu(false)}
                    className="block rounded-lg px-3 py-2 transition-colors hover:bg-[var(--color-surface-2)]"
                  >
                    <span className="block text-sm font-medium text-[var(--color-text-muted)]">
                      {t('exportData')}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--color-teal-deep)]">
                      {tCommon('exportRequiresPaid')}
                    </span>
                  </Link>
                )}
              </div>
            </>
          ) : null}
        </div>
      </header>

      {planUsage && planUsage.studentLimit < 999999 && (
        <div className="mb-4 max-w-6xl">
          <PlanUsageCard
            plan={planUsage.plan}
            weeklyUniqueStudents={planUsage.weeklyUniqueStudents}
            studentLimit={planUsage.studentLimit}
          />
        </div>
      )}

      {data === null ? (
        <div className="max-w-6xl space-y-4" aria-busy="true">
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="relative min-h-[136px] rounded-md border border-[var(--color-line)] shadow-sm bg-[var(--color-panel)] p-4"
                aria-hidden
              >
                <div className="absolute top-4 end-4 h-4 w-4 rounded bg-[var(--color-surface-2)] animate-pulse" />
                <div className="pe-8 h-3 w-24 rounded bg-[var(--color-surface-2)] animate-pulse" />
                <div className="mt-2 h-8 w-20 rounded bg-[var(--color-surface-2)] animate-pulse" />
                <div className="mt-3 h-8 w-full rounded-md bg-[var(--color-surface-2)] animate-pulse" />
              </div>
            ))}
          </div>
          {/* Digital share placeholder: percentage line, split bar, legend pair. */}
          <div className="rounded-md border border-[var(--color-line)] shadow-sm bg-[var(--color-panel)] p-4">
            <div className="h-8 w-28 rounded bg-[var(--color-surface-2)] animate-pulse" />
            <div className="mt-3 h-2 w-full rounded-full bg-[var(--color-surface-2)] animate-pulse" />
            <div className="mt-3 flex gap-4">
              <div className="h-3 w-24 rounded bg-[var(--color-surface-2)] animate-pulse" />
              <div className="h-3 w-24 rounded bg-[var(--color-surface-2)] animate-pulse" />
            </div>
          </div>
          {/* Schedule placeholder: the design draws four session rows. */}
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2.5"
                aria-hidden
              >
                <div className="h-8 w-12 shrink-0 rounded bg-[var(--color-surface-2)] animate-pulse" />
                <div className="min-w-0 flex-1">
                  <div className="h-4 w-32 rounded bg-[var(--color-surface-2)] animate-pulse" />
                  <div className="mt-1.5 h-3 w-44 rounded bg-[var(--color-surface-2)] animate-pulse" />
                </div>
                <div className="h-6 w-14 shrink-0 rounded-pill bg-[var(--color-surface-2)] animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Merged-Center-Home §01, in the design's own order: alert row, Today
              KPIs, digital share, schedule. Two of the design's six blocks are
              deliberately absent and neither is an oversight:
              - The balance card (Available now / Pending / Unpaid / Processed) is
                BLOCKED. Tuition money has never transited the platform, so every
                one of those four figures would be invented. Eyad, 3 Aug: do not
                fake, do not approximate.
              - The "Verified" badge has nothing to read from. `centers` carries no
                verification column (checked in information_schema, zero matches for
                verif/valify/kyc/ident) and there is no Valify integration, env var
                or platform_config key anywhere in the repo. See R12 in
                design/BUILD-AFTER-REDESIGN.md. */}
          {safeData.unpaidCount > 0 && (
            <div className="mb-4 max-w-6xl">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-brass)]/40 bg-[var(--color-surface-2)] p-4">
                {/* The design's alert leads with a circle-exclamation glyph; without
                    it the row reads as a card rather than a warning. */}
                <AlertCircle className="h-5 w-5 shrink-0 text-[var(--color-brass)]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--color-brass)]">
                    {t('unpaidLinksTitle', { count: formatNumber(safeData.unpaidCount, locale) })}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
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
                  className="shrink-0 rounded-lg bg-[var(--color-brass)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 btn-press chq-focus"
                >
                  {t('reviewAction')}
                </Link>
              </div>
            </div>
          )}

          <div className="mb-4 max-w-6xl">
            <SectionHeader title={tCommon('sectionToday')} />
          </div>
          <div className="mb-6 grid max-w-6xl grid-cols-2 gap-3">
            <KpiCard
              label={t('sessionsLabel')}
              value={`${formatNumber(safeData.todaySessionsTotal, locale)} · ${t('sessionsDoneSuffix', { count: formatNumber(safeData.todaySessionsDone, locale) })}`}
            />
            <KpiCard label={t('studentsExpectedLabel')} value={formatNumber(safeData.studentsExpectedToday, locale)} />
            <KpiCard label={t('collected')} value={formatCurrency(safeData.todayRevenue, locale)} />
            <KpiCard label={t('attendanceShort')} value={formatPercent(attendancePctOfExpectedToday, locale)} />
          </div>

          {digitalShare && (
            <>
              <div className="mb-1 max-w-6xl">
                <SectionHeader title={t('digitalShareTitle')} sub={t('digitalShareSub')} />
              </div>
              <div className="mb-6 max-w-6xl rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-[var(--color-text-primary)]">
                    {formatPercent(digitalShare.pct, locale)}
                  </span>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {t('digitalShareTotal', { amount: formatCurrency(digitalShare.total, locale) })}
                  </span>
                </div>
                <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                  <div className="h-full bg-[var(--color-accent)]" style={{ width: `${digitalShare.pct}%` }} />
                  <div className="h-full bg-[var(--color-brass)]" style={{ width: `${100 - digitalShare.pct}%` }} />
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-xs">
                  <span className="flex items-center gap-1.5 text-[var(--color-text-secondary)]">
                    <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" aria-hidden />
                    {t('online')} {formatCurrency(digitalShare.online, locale)}
                  </span>
                  <span className="flex items-center gap-1.5 text-[var(--color-text-secondary)]">
                    <span className="h-2 w-2 rounded-full bg-[var(--color-brass)]" aria-hidden />
                    {t('methodCash')} {formatCurrency(digitalShare.cash, locale)}
                  </span>
                </div>
              </div>
            </>
          )}

          <div className="mb-3 max-w-6xl">
            <SectionHeader
              title={t('todaySchedule')}
              sub={formatDate(new Date(), locale, { weekday: 'long' })}
            />
          </div>
          {safeData.todaySchedule.length > 0 ? (
            <div className="mb-6 max-w-6xl space-y-2">
              {safeData.todaySchedule.map((s) => (
                <ListRow
                  key={s.id}
                  title={s.groupName}
                  meta={
                    <>
                      <span className="block font-semibold text-[var(--color-ink)]" dir="ltr">
                        {formatTime(s.startTime.slice(0, 5), locale)}
                      </span>
                      <span className="block">
                        {s.teacherName} · {s.roomName} · {formatNumber(s.memberCount, locale)}
                      </span>
                    </>
                  }
                  onOpen={s.groupId ? () => router.push(`/attendance?group=${s.groupId}&date=${cairoDateKey()}&tab=scan`) : undefined}
                  badge={
                    <span
                      className={`shrink-0 rounded-pill px-2.5 py-1 text-xs font-semibold ${
                        s.status === 'billed'
                          ? 'bg-[var(--color-mint)] text-[var(--color-accent-deep)]'
                          : s.status === 'next'
                            ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent-deep)]'
                            : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]'
                      }`}
                    >
                      {s.status === 'billed' ? t('chipBilled') : s.status === 'next' ? t('chipNext') : t('chipLater')}
                    </span>
                  }
                />
              ))}
            </div>
          ) : (
            <div className="mb-6 max-w-6xl rounded-md border border-[var(--color-line)] bg-[var(--color-panel)]">
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

      {showUpgradeModal && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setShowUpgradeModal(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowUpgradeModal(false)}
          role="presentation"
        >
          <div
            className="card rounded-2xl max-w-md w-full p-6 border-[var(--color-line)]"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
              {tSettings('upgradeToUnlockFeature')}
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">
              {t('exportExcelUpgrade', {
                defaultValue: 'Excel/CSV export is available on Pro plan and above.',
              })}
            </p>
            <Link
              href="/settings/billing"
              className="inline-block px-4 py-2 bg-brand-500 hover:opacity-90 text-primary-foreground text-sm font-medium rounded-lg"
            >
              {t('upgradePlan')}
            </Link>
            <button
              type="button"
              onClick={() => setShowUpgradeModal(false)}
              className="ms-2 px-4 py-2 rounded-lg text-sm text-[var(--color-text-primary)] bg-[var(--color-surface-3)] btn-press chq-focus"
            >
              {tCommon('cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
