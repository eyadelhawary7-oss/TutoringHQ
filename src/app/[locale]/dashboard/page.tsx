'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect } from '@/lib/db-proxy';
import { colors } from '@/lib/tokens';
import { exportDashboardToExcel } from '@/lib/excel-export';
import { hasPlanFeature } from '@/lib/plans';
import { useUser } from '@/contexts/UserContext';
import { Link } from '@/i18n/routing';
import PlanUsageCard from '@/components/dashboard/PlanUsageCard';
import { ChartCard, SparklineChart } from '@/components/charts';
import { KpiCard, SectionHeader } from '@/components/shared';

const AreaChartComponent = dynamic(
  () => import('@/components/charts').then((m) => ({ default: m.AreaChartComponent })),
  { ssr: false, loading: () => <div className="chq-skeleton h-48 w-full rounded-xl" /> },
);
const DonutChart = dynamic(
  () => import('@/components/charts').then((m) => ({ default: m.DonutChart })),
  { ssr: false, loading: () => <div className="chq-skeleton h-48 w-full rounded-xl" /> },
);
import { useToast } from '@/components/ui/ToastProvider';
import { formatDate, formatGrowth, formatNumber, formatPercent, formatCurrency, formatRelativeMinutesAgo } from '@/lib/formatNumber';
import { getCairoWeekDayKeys, startOfCairoWeek } from '@/lib/cairo/week';
import { cairoDateKey } from '@/lib/cairo/day';
import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';
import { type InactivePeriod, type InactiveStudent } from '@/components/dashboard/InactiveList';
import { ClientOnly } from '@/components/ClientOnly';
import {
  readDashboardCache as readScopedDashboardCache,
  writeDashboardCache as writeScopedDashboardCache,
} from '@/lib/dashboardCache';
import {
  QrCode,
  TrendingUp,
  TrendingDown,
  CreditCard,
  UserPlus,
  X,
  ArrowUpRight,
  Send,
  MoreVertical,
  BarChart3,
  PieChart,
} from 'lucide-react';

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatMonthLabel(monthStr: string, locale: string): string {
  const [y, m] = monthStr.split('-').map(Number);
  if (locale === 'ar') return AR_MONTHS[(m || 1) - 1] ?? monthStr;
  return EN_MONTHS[(m || 1) - 1] ?? monthStr;
}

/** X-axis labels for attendance trend: short English weekdays, long Arabic; never cache localized strings. */
function formatAttendanceChartDayLabel(dayKey: string, locale: string, isToday: boolean): string {
  if (isToday) return locale === 'ar' ? 'اليوم' : 'Today';
  const d = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dayKey;
  if (locale === 'ar') {
    return d.toLocaleDateString('ar-EG', { weekday: 'long' });
  }
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

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
}

type AtRiskRow = {
  id: string;
  name: string;
  student_number?: string | null;
  days_since_last_scan: number;
  attendance_rate_pct?: number;
};

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
};

function isDashboardCacheValid(p: unknown): p is DashboardData {
  if (!p || typeof p !== 'object') return false;
  const o = p as DashboardData;
  if (!Array.isArray(o.trendData)) return false;
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

function atRiskAttendanceIndicator(daysSinceLastScan: number): number {
  return Math.max(5, Math.min(59, 100 - Math.min(30, daysSinceLastScan) * 3));
}

function KpiCommandCard({
  label,
  valueDisplay,
  subLabel,
  growth,
  delayMs,
  sparkline,
  staleMetrics,
  locale,
}: {
  label: string;
  valueDisplay: ReactNode;
  subLabel?: ReactNode;
  /** Uses formatGrowth; chip hidden when prior period had no baseline (null). */
  growth?: { current: number; prior: number } | null;
  delayMs: number;
  sparkline: { value: number }[];
  /** When true, main KPI value is dimmed until fresh data arrives (sessionStorage rehydrate). */
  staleMetrics?: boolean;
  locale: string;
}) {
  const growthLabel =
    growth != null && Number.isFinite(growth.prior) && Number.isFinite(growth.current)
      ? formatGrowth(growth.current, growth.prior, locale)
      : null;
  const showTrend = growthLabel != null;
  const negative =
    growth != null &&
    growth.prior > 0 &&
    growth.current < growth.prior;

  // Compose sublabel slot: optional subLabel text, growth chip, sparkline.
  const composedSub = (
    <div className="flex flex-col gap-2">
      {subLabel ? (
        <p className="text-[11px] text-[var(--color-text-muted)]">{subLabel}</p>
      ) : null}
      {showTrend ? (
        <span
          className={`inline-flex w-fit items-center gap-0.5 text-[11px] font-semibold ${
            negative ? 'text-red-500' : 'text-emerald-500'
          }`}
        >
          {!negative ? (
            <TrendingUp className="h-3 w-3" aria-hidden />
          ) : (
            <TrendingDown className="h-3 w-3" aria-hidden />
          )}
          <span>{growthLabel}</span>
        </span>
      ) : null}
      <div className="h-8 w-full opacity-95" aria-hidden suppressHydrationWarning>
        {sparkline.length >= 2 ? (
          <ClientOnly fallback={<div className="h-8 w-full" />}>
            <SparklineChart data={sparkline} color="teal" height={32} />
          </ClientOnly>
        ) : (
          <div className="h-8" />
        )}
      </div>
    </div>
  );

  return (
    <div className={`chq-fade-in transition-opacity duration-300 ${staleMetrics ? 'opacity-70' : 'opacity-100'}`} style={{ animationDelay: `${delayMs}ms` }}>
      <KpiCard
        label={label}
        value={<span className="tabular-nums">{valueDisplay}</span>}
        subLabel={composedSub}
      />
    </div>
  );
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tSettings = useTranslations('settings');
  const tCommon = useTranslations('common');
  const tBilling = useTranslations('billing');
  const tToast = useTranslations('toasts');
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useUser();
  const canViewRevenue =
    user?.role === 'owner' || user?.role === 'admin' || user?.role === 'super_admin' || user?.can_view_revenue === true;

  const [centerBilling, setCenterBilling] = useState<{ payment_due_date?: string; billing_status?: string; name?: string; plan?: string; export_access?: boolean } | null>(null);
  const [planUsage, setPlanUsage] = useState<{ plan: string; weeklyUniqueStudents: number; studentLimit: number } | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [dashboardDataFresh, setDashboardDataFresh] = useState(false);
  const [inactivePeriod, setInactivePeriod] = useState<InactivePeriod>('7d');
  const [timeRange, setTimeRange] = useState<'7' | '30'>('7');
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
    surge_message?: string | null;
  } | null>(null);
  const [surgeDismissed, setSurgeDismissed] = useState(false);
  const [atRiskStudents, setAtRiskStudents] = useState<AtRiskRow[]>([]);
  const [atRiskMeta, setAtRiskMeta] = useState<{
    totalActive: number;
    avgAttendancePct: number;
    atRiskCount: number;
  } | null>(null);
  const [sendingReport, setSendingReport] = useState(false);
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

      // Batch 1: 4 parallel queries
      const [
        paymentsResult,
        attendanceResult,
        studentsResult,
        recentPaymentsResult,
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
          select: 'student_id, scanned_at',
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
      ]);

      const paymentsData = (paymentsResult.data || []) as { amount: number; confirmed?: boolean; status?: string; method?: string; paid_at?: string; student_id?: string }[];
      const scansData = (attendanceResult.data || []) as { student_id: string; scanned_at: string }[];
      const students = (studentsResult.data || []) as { id: string; name: string; subject: string; fee: number; payment_status: string; student_number?: string; created_at: string }[];
      const recentPaymentsRaw = (recentPaymentsResult.data || []) as { id: string; student_id: string; amount: number; status: string; confirmed?: boolean; group_id?: string; students?: { name?: string; student_number?: string } | null; student_groups?: { name?: string } | null }[];

      // Derive KPIs from payments
      const todayPayments = paymentsData.filter(p => {
        if (!p.paid_at) return false;
        const d = new Date(p.paid_at);
        return d >= new Date(todayStart) && d <= todayEnd;
      });
      const todayRevenue = todayPayments.filter(p => p.confirmed).reduce((sum, p) => sum + parseFloat(String(p.amount || 0)), 0);
      const studentPendingCount = students.filter(s => s.payment_status === 'pending').length;
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

      const paidCount = students.filter(s => s.payment_status === 'paid').length;
      const unpaidCount = students.filter(s => s.payment_status === 'unpaid').length;

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
        pendingCount: studentPendingCount,
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

  useEffect(() => {
    const fetchAtRisk = async () => {
      if (!centerId) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      try {
        const res = await fetch('/api/students/at-risk', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const json = (await res.json()) as {
            students?: AtRiskRow[];
            meta?: { totalActive: number; avgAttendancePct: number; atRiskCount: number };
          };
          setAtRiskStudents(json.students ?? []);
          setAtRiskMeta(json.meta ?? null);
        }
      } catch {
        setAtRiskStudents([]);
        setAtRiskMeta(null);
      }
    };
    void fetchAtRisk();
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

    const refetchAtRisk = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      try {
        const res = await fetch('/api/students/at-risk', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const json = (await res.json()) as {
            students?: AtRiskRow[];
            meta?: { totalActive: number; avgAttendancePct: number; atRiskCount: number };
          };
          setAtRiskStudents(json.students ?? []);
          setAtRiskMeta(json.meta ?? null);
        }
      } catch {
        /* Non-fatal */
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
          void refetchAtRisk();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments', filter: `center_id=eq.${centerId}` },
        () => {
          loadDashboard(centerId, inactivePeriod, timeRange === '30' ? 30 : 7);
          void refetchStats();
          void refetchAtRisk();
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
      const [studentsRes, attendanceRes, paymentsRes] = await Promise.all([
        dbSelect({
          table: 'students',
          select: 'id, name, phone, parent_phone, subject, payment_status, qr_code',
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
      ]);
      const students = (studentsRes.data || []) as { id: string; name: string; phone?: string; parent_phone?: string; subject?: string; payment_status: string; qr_code?: string }[];
      const attendanceRaw = (attendanceRes.data || []) as { student_id: string; scanned_at: string }[];
      const paymentsRaw = (paymentsRes.data || []) as { student_id: string; amount: number; method: string; paid_at: string; recorded_by: string }[];
      const studentMap = new Map(students.map(s => [s.id, s]));
      await exportDashboardToExcel({
        students,
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

  const monthlyRevenueRaw = statsData?.monthlyRevenue ?? [];
  const monthlyRevenueData = useMemo(
    () =>
      monthlyRevenueRaw.map((r) => ({
        month: formatMonthLabel(r.month, locale),
        revenue: Number(r.amount) || 0,
      })),
    [monthlyRevenueRaw, locale],
  );

  const attendanceChart7 = useMemo(() => {
    const td = safeData.trendData;
    const slice = td.length <= 7 ? td : td.slice(-7);
    const todayKey = cairoDateKey(new Date());
    return slice.map((d) => {
      const isToday = d.dayKey === todayKey;
      return {
        date: formatAttendanceChartDayLabel(d.dayKey, locale, isToday),
        count: d.count,
      };
    });
  }, [safeData.trendData, locale]);

  const attendanceWeekTotal = useMemo(
    () => attendanceChart7.reduce((s, d) => s + d.count, 0),
    [attendanceChart7],
  );

  const studentSparklinePoints = useMemo(
    () => safeData.studentSparkline7d.map((n) => ({ value: n })),
    [safeData.studentSparkline7d],
  );

  const attendanceSparklinePoints = useMemo(
    () => attendanceChart7.map((d) => ({ value: d.count })),
    [attendanceChart7],
  );

  const revenueMonthlySpark7 = useMemo(() => {
    const slice = monthlyRevenueData.slice(-7);
    return slice.map((r) => ({ value: r.revenue }));
  }, [monthlyRevenueData]);

  const pendingInvoicesSpark7 = useMemo(() => {
    const c = safeData.pendingInvoicesCount;
    return Array.from({ length: 7 }, () => ({ value: c }));
  }, [safeData.pendingInvoicesCount]);

  const hasAttendanceChartData = attendanceWeekTotal > 0;
  const hasPaymentStatusData =
    safeData.paidCount + safeData.pendingCount + safeData.latePaymentCount > 0;

  const onSendReport = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error(tToast('error'), tCommon('error'));
        return;
      }
      setSendingReport(true);
      const res = await fetch('/api/dashboard/send-daily-summary', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const code = j.error ?? '';
        if (code === 'daily_summary_disabled') toast.error(tToast('error'), t('dailySummaryDisabled'));
        else if (code === 'no_center_phone') toast.error(tToast('error'), t('dailySummaryNoPhone'));
        else if (code === 'no_activity_yesterday') toast.info(t('dailySummaryNoActivity'));
        else toast.error(tToast('error'), code || tCommon('error'));
        return;
      }
      toast.success(t('dailySummarySent'));
    } catch {
      toast.error(tToast('error'), tCommon('error'));
    } finally {
      setSendingReport(false);
    }
  }, [toast, t, tToast, tCommon]);

  const attendanceTodayCount = Number(statsData?.attendanceToday ?? safeData.todayAttendance ?? 0);
  const attendancePctOfTotal =
    safeData.totalStudents > 0
      ? Math.min(100, Math.round((attendanceTodayCount / safeData.totalStudents) * 10000) / 100)
      : 0;

  const paymentDueBanner = (() => {
    if (!centerBilling?.payment_due_date || centerBilling.billing_status === 'paid') return null;
    const dueDate = new Date(centerBilling.payment_due_date);
    const now = Date.now();
    const diffMs = dueDate.getTime() - now;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays > 0 && diffDays <= 5) {
      return (
        <div className="mb-4 p-4 rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-surface-2)] flex flex-wrap items-center justify-between gap-4" suppressHydrationWarning>
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
          <div className="mb-4 p-4 rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-surface-2)] flex flex-wrap items-center justify-between gap-4" suppressHydrationWarning>
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
        <div className="mb-4 p-4 rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-surface-2)] flex flex-wrap items-center justify-between gap-4" suppressHydrationWarning>
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
            className="rounded-xl border border-[var(--color-border-subtle)] shadow-sm bg-[var(--color-surface-1)] p-6 text-center transition-colors hover:bg-[var(--color-surface-2)] btn-press chq-focus"
          >
            <QrCode className="mx-auto mb-3 h-14 w-14 text-teal-500" strokeWidth={1.5} />
            <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('action_scan')}</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('scanSubtitle')}</p>
          </Link>
          <Link
            href="/payments"
            className="rounded-xl border border-[var(--color-border-subtle)] shadow-sm bg-[var(--color-surface-1)] p-6 transition-colors hover:bg-[var(--color-surface-2)] btn-press chq-focus"
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
        <div className="mt-4 rounded-xl border border-[var(--color-border-subtle)] shadow-sm bg-[var(--color-surface-1)] p-4">
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
      {showSurgeAlert && statsData?.surge_message && (
        <div
          className="card mb-4 p-4 border-[var(--color-border-brand)] flex items-center justify-between gap-4"
        >
          <span className="text-sm font-medium text-[var(--color-text-primary)]">{statsData.surge_message}</span>
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
            <span
              className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium text-teal-300"
              style={{ backgroundColor: 'rgba(13,148,136,0.2)' }}
            >
              {planLabel}
            </span>
          </div>
          <p
            className="mt-1 text-sm text-[var(--color-text-secondary)]"
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
                className="absolute end-0 top-full z-20 mt-2 w-52 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-1.5 shadow-lg"
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

      <div className="mb-6 max-w-6xl">
        <div className="mb-3">
          <SectionHeader title={t('quickActions')} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Link
            href="/students?action=add"
            className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-4 text-center shadow-sm transition-colors hover:bg-[var(--color-surface-2)] btn-press chq-focus"
          >
            <UserPlus className="h-6 w-6 text-teal-500" aria-hidden />
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">{t('addStudent')}</span>
          </Link>
          <Link
            href="/attendance"
            className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-4 text-center shadow-sm transition-colors hover:bg-[var(--color-surface-2)] btn-press chq-focus"
          >
            <QrCode className="h-6 w-6 text-teal-500" aria-hidden />
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">{t('recordAttendance')}</span>
          </Link>
          <Link
            href="/payments?action=collect"
            className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-4 text-center shadow-sm transition-colors hover:bg-[var(--color-surface-2)] btn-press chq-focus"
          >
            <CreditCard className="h-6 w-6 text-teal-500" aria-hidden />
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">{t('collectPayment')}</span>
          </Link>
          <button
            type="button"
            onClick={() => void onSendReport()}
            disabled={sendingReport}
            className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-4 text-center shadow-sm transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50 btn-press chq-focus"
          >
            <Send className="h-6 w-6 text-teal-500" aria-hidden />
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">{t('sendReport')}</span>
          </button>
        </div>
      </div>

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
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="relative min-h-[136px] rounded-xl border border-[var(--color-border-subtle)] shadow-sm bg-[var(--color-surface-1)] p-4"
                aria-hidden
              >
                <div className="absolute top-4 end-4 h-4 w-4 rounded bg-[var(--color-surface-2)] animate-pulse" />
                <div className="pe-8 h-3 w-24 rounded bg-[var(--color-surface-2)] animate-pulse" />
                <div className="mt-2 h-8 w-20 rounded bg-[var(--color-surface-2)] animate-pulse" />
                <div className="mt-3 h-8 w-full rounded-md bg-[var(--color-surface-2)] animate-pulse" />
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-[var(--color-border-subtle)] shadow-sm bg-[var(--color-surface-1)] p-4">
            <div className="mb-3 h-4 w-32 rounded bg-[var(--color-surface-2)] animate-pulse" />
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="mb-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5"
              >
                <div className="flex justify-between gap-2">
                  <div className="h-4 w-36 rounded bg-[var(--color-surface-3)] animate-pulse" />
                  <div className="h-3 w-10 rounded bg-[var(--color-surface-3)] animate-pulse" />
                </div>
                <div className="mt-2 h-1 w-full rounded-full bg-[var(--color-surface-3)]" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            <div className="md:col-span-3">
              <div className="flex min-h-[200px] flex-col rounded-xl border border-[var(--color-border-subtle)] shadow-sm bg-[var(--color-surface-1)] p-4">
                <div className="mb-3 h-4 w-40 rounded bg-[var(--color-surface-2)] animate-pulse" />
                <div className="h-[168px] w-full rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
              </div>
            </div>
            <div className="flex flex-col md:col-span-2">
              <div className="flex min-h-[240px] flex-col rounded-xl border border-[var(--color-border-subtle)] shadow-sm bg-[var(--color-surface-1)] p-4">
                <div className="mb-2 h-3 w-28 rounded bg-[var(--color-surface-2)] animate-pulse" />
                <div className="min-h-0 flex-1 rounded-xl bg-[var(--color-surface-2)] animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-4 max-w-6xl">
            <SectionHeader title={tCommon('sectionAtAGlance')} />
          </div>
          <div className="mb-6 grid max-w-6xl grid-cols-2 gap-3">
            <KpiCommandCard
              label={t('activeStudents.label')}
              subLabel={t('activeStudents.timeWindow', {
                count: formatNumber(Number(safeData.totalStudents), locale),
              })}
              valueDisplay={formatNumber(Number(statsData?.activeStudentsThisWeek ?? 0), locale)}
              growth={
                safeData.studentSparkline7d.length >= 2
                  ? {
                      current: safeData.studentSparkline7d[safeData.studentSparkline7d.length - 1] ?? 0,
                      prior: safeData.studentSparkline7d[0] ?? 0,
                    }
                  : null
              }
              delayMs={0}
              sparkline={studentSparklinePoints}
              staleMetrics={kpiStale}
              locale={locale}
            />
            <KpiCommandCard
              label={t('todayAttendance')}
              valueDisplay={formatNumber(Number(attendanceTodayCount), locale)}
              subLabel={
                <>
                  {formatPercent(Number(attendancePctOfTotal), locale)}
                  <span className="mx-1 opacity-80">·</span>
                  <span>{t('todayAttendanceSub')}</span>
                </>
              }
              growth={{
                current: attendanceTodayCount,
                prior: safeData.yesterdayAttendanceCount,
              }}
              delayMs={100}
              sparkline={attendanceSparklinePoints}
              staleMetrics={kpiStale}
              locale={locale}
            />
            {canViewRevenue ? (
              <KpiCommandCard
                label={t('monthlyRevenue')}
                valueDisplay={formatCurrency(Number(safeData.monthConfirmed), locale)}
                subLabel={t('monthlyRevenueSub')}
                growth={
                  monthlyRevenueRaw.length >= 2
                    ? {
                        current: Number(monthlyRevenueRaw[monthlyRevenueRaw.length - 1]?.amount) || 0,
                        prior: Number(monthlyRevenueRaw[monthlyRevenueRaw.length - 2]?.amount) || 0,
                      }
                    : null
                }
                delayMs={200}
                sparkline={revenueMonthlySpark7}
                staleMetrics={kpiStale}
                locale={locale}
              />
            ) : (
              <KpiCommandCard
                label={t('monthlyRevenue')}
                valueDisplay={
                  <span className="text-[var(--color-text-muted)] text-xs" aria-hidden>
                    -
                  </span>
                }
                delayMs={200}
                sparkline={[]}
                staleMetrics={kpiStale}
                locale={locale}
              />
            )}
            <KpiCommandCard
              label={t('pendingPayments.label')}
              subLabel={t('pendingPayments.unit')}
              valueDisplay={formatNumber(Number(safeData.pendingInvoicesCount), locale)}
              delayMs={300}
              sparkline={pendingInvoicesSpark7}
              staleMetrics={kpiStale}
              locale={locale}
            />
          </div>

          <div className="mb-6 max-w-6xl rounded-xl border border-[var(--color-border-subtle)] shadow-sm bg-[var(--color-surface-1)] p-4">
            <div className="mb-1 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('atRisk')}</h2>
                <p className="text-xs text-[var(--color-text-muted)]">{t('atRiskDesc')}</p>
              </div>
              <Link
                href="/students?filter=atrisk"
                className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-teal-400 hover:text-teal-300 btn-press chq-focus"
              >
                {t('viewAll')}
                <ArrowUpRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
              </Link>
            </div>
            {atRiskStudents.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--color-text-secondary)] space-y-2">
                {!atRiskMeta ? (
                  <p className="text-teal-400">{t('allGood')}</p>
                ) : atRiskMeta.totalActive === 0 ? (
                  <p>{t('atRiskNoStudentsYet')}</p>
                ) : atRiskMeta.avgAttendancePct > 80 ? (
                  <p className="text-teal-400">{t('allGood')}</p>
                ) : (
                  <p className="text-[var(--color-text-muted)]">{t('atRiskStable')}</p>
                )}
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {atRiskStudents.slice(0, 6).map((student) => {
                  const rawPct =
                    student.attendance_rate_pct ??
                    atRiskAttendanceIndicator(student.days_since_last_scan);
                  const pct = Math.min(100, Math.round(rawPct * 10) / 10);
                  const barColor = pct < 40 ? 'bg-red-500' : 'bg-amber-500';
                  return (
                    <li
                      key={student.id}
                      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1 text-end">
                          <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">{student.name}</p>
                          <p className="truncate font-mono text-xs text-[var(--color-text-secondary)]" dir="ltr">
                            {student.student_number ? (
                              formatStudentNumberForDisplay(student.student_number)
                            ) : (
                              <span className="text-[var(--color-text-muted)] text-xs">-</span>
                            )}
                          </p>
                        </div>
                        <span
                          className="shrink-0 tabular-nums text-xs font-semibold text-[var(--color-text-secondary)]"
                          style={{
                            fontFamily:
                              'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                          }}
                        >
                          {formatPercent(pct, locale)}
                        </span>
                      </div>
                      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--color-surface-3)]">
                        <div
                          className={`h-full rounded-full transition-all ${barColor}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="mb-4 max-w-6xl">
            <SectionHeader title={tCommon('sectionTrends')} />
          </div>
          <div className="mb-6 grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-5">
            <div className="md:col-span-3">
              <ChartCard
                title={t('attendanceChart')}
                value={hasAttendanceChartData ? formatNumber(Number(attendanceWeekTotal), locale) : undefined}
                growthPair={hasAttendanceChartData ? {
                  current: safeData.thisWeekScanTotal,
                  prior: safeData.lastWeekScanTotal,
                } : undefined}
                trendLabel={hasAttendanceChartData ? t('vsLastWeek') : undefined}
                minHeight={200}
                footer={
                  hasAttendanceChartData && safeData.generatedAt
                    ? t('chartLastUpdated', {
                        time: formatRelativeMinutesAgo(safeData.generatedAt, locale),
                      })
                    : undefined
                }
              >
                {hasAttendanceChartData ? (
                  <AreaChartComponent
                    data={attendanceChart7 as Record<string, string | number>[]}
                    dataKey="count"
                    xKey="date"
                    color="teal"
                    height={200}
                    integerYAxis
                    dedupYAxisTicks
                  />
                ) : (
                  <div className="flex h-[168px] flex-col items-center justify-center gap-2 text-center">
                    <BarChart3 className="h-8 w-8 text-[var(--color-text-muted)]" aria-hidden />
                    <p className="text-sm text-[var(--color-text-muted)]">{t('noDataForChart')}</p>
                  </div>
                )}
              </ChartCard>
            </div>
            <div className="flex flex-col md:col-span-2">
              <div className="flex h-full min-h-[240px] flex-col rounded-xl border border-[var(--color-border-subtle)] shadow-sm bg-[var(--color-surface-1)] p-4">
                <p className="text-xs font-medium text-[var(--color-text-muted)]">{t('paymentStatus')}</p>
                <div className="min-h-0 flex-1">
                  {hasPaymentStatusData ? (
                    <DonutChart
                      data={[
                        { name: t('paid'), value: safeData.paidCount, color: colors.brand[500] },
                        { name: t('pending'), value: safeData.pendingCount, color: colors.gold[500] },
                        { name: t('overdue'), value: safeData.latePaymentCount, color: '#EF4444' },
                      ]}
                      height={200}
                      centerLabel={t('collected')}
                      centerValue={
                        canViewRevenue
                          ? formatCurrency(Number(safeData.monthConfirmed), locale)
                          : tCommon('noData')
                      }
                      suffix=""
                      tooltipValueFormatter={(v) => formatNumber(Number(v), locale)}
                      centerValueFill="var(--color-text-primary)"
                      centerLabelFill="var(--color-text-secondary)"
                    />
                  ) : (
                    <div className="flex h-[168px] flex-col items-center justify-center gap-2 text-center">
                      <PieChart className="h-8 w-8 text-[var(--color-text-muted)]" aria-hidden />
                      <p className="text-sm text-[var(--color-text-muted)]">{t('noDataForChart')}</p>
                    </div>
                  )}
                </div>
                {hasPaymentStatusData && safeData.generatedAt ? (
                  <p className="mt-2 border-t border-[var(--color-border-subtle)] pt-2 text-xs text-[var(--color-text-muted)]">
                    {t('chartLastUpdated', {
                      time: formatRelativeMinutesAgo(safeData.generatedAt, locale),
                    })}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
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
            className="card rounded-2xl max-w-md w-full p-6 border-[var(--color-border-subtle)]"
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
