'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { dbSelect } from '@/lib/db-proxy';
import { exportDashboardToExcel } from '@/lib/excel-export';
import { hasPlanFeature } from '@/lib/plans';
import { useUser } from '@/contexts/UserContext';
import { Link } from '@/i18n/routing';
import PlanUsageCard from '@/components/dashboard/PlanUsageCard';
import { RevenueSparkline } from '@/components/dashboard/RevenueSparkline';
import { AttendanceRing } from '@/components/dashboard/AttendanceRing';
import { PaymentBar } from '@/components/dashboard/PaymentBar';
import { type InactivePeriod, type InactiveStudent } from '@/components/dashboard/InactiveList';
import {
  SkeletonStat,
  SkeletonText,
  SkeletonBlock,
  SkeletonChart,
  SkeletonPageHeader,
  SkeletonCircle,
  SkeletonRow,
} from '@/components/ui/skeleton';
import { QrCode, TrendingUp, Users, CreditCard, UserPlus, Printer, X } from 'lucide-react';

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatMonthLabel(monthStr: string, locale: string): string {
  const [y, m] = monthStr.split('-').map(Number);
  if (locale === 'ar') return AR_MONTHS[(m || 1) - 1] ?? monthStr;
  return EN_MONTHS[(m || 1) - 1] ?? monthStr;
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
  trendData: { date: string; count: number }[];
  revenueChartData: { date: string; day: string; cash: number; instapay: number; vodafone: number; orange: number; fawry: number; bank: number; other: number }[];
  recentPayments: RecentPaymentRow[];
  monthTotal: number;
  monthConfirmed: number;
  monthPending: number;
  monthLate: number;
  weeklyTrendPct: number;
  collectionRatePct: number;
  newStudentsCount: number;
  atRiskCount: number;
  inactiveStudents: InactiveStudent[];
  scanDeltaPct: number;
  revenueDeltaPct: number;
}

type AtRiskRow = {
  id: string;
  name: string;
  student_number?: string | null;
  days_since_last_scan: number;
};

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tSettings = useTranslations('settings');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { user } = useUser();
  const canViewRevenue = user?.role === 'owner' || user?.role === 'admin' || user?.can_view_revenue === true;

  const [centerBilling, setCenterBilling] = useState<{ payment_due_date?: string; billing_status?: string; name?: string; plan?: string } | null>(null);
  const [planUsage, setPlanUsage] = useState<{ plan: string; weeklyUniqueStudents: number; studentLimit: number } | null>(null);
  const [data, setData] = useState<DashboardData>({
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
    collectionRatePct: 0,
    newStudentsCount: 0,
    atRiskCount: 0,
    inactiveStudents: [],
    scanDeltaPct: 0,
    revenueDeltaPct: 0,
  });
  const [inactivePeriod, setInactivePeriod] = useState<InactivePeriod>('7d');
  const [timeRange, setTimeRange] = useState<'7' | '30'>('7');
  const [centerId, setCenterId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
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
      const dayLabels = locale === 'ar' ? ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
      const scanDeltaPct = yesterdayAttendance > 0 ? Math.round((attendanceCount - yesterdayAttendance) / yesterdayAttendance * 100) : 0;
      const revenueDeltaPct = yesterdayRev > 0 ? Math.round((todayRevenue - yesterdayRev) / yesterdayRev * 100) : 0;

      const paidCount = students.filter(s => s.payment_status === 'paid').length;
      const unpaidCount = students.filter(s => s.payment_status === 'unpaid').length;

      // Trend data: group scans by date
      const scansByDate: Record<string, number> = {};
      for (let i = range - 1; i >= 0; i--) {
        const day = new Date();
        day.setDate(day.getDate() - i);
        const dayKey = day.toISOString().slice(0, 10);
        scansByDate[dayKey] = 0;
      }
      scansData.forEach(s => {
        const key = s.scanned_at?.slice(0, 10);
        if (key && key in scansByDate) scansByDate[key]++;
      });
      const trendData: { date: string; count: number }[] = [];
      for (let i = range - 1; i >= 0; i--) {
        const day = new Date();
        day.setDate(day.getDate() - i);
        const dayKey = day.toISOString().slice(0, 10);
        const isToday = i === 0;
        trendData.push({
          date: isToday ? (locale === 'ar' ? 'اليوم' : 'Today') : dayLabels[day.getDay()],
          count: scansByDate[dayKey] ?? 0,
        });
      }

      // Revenue chart: group payments by date and method
      const defaultMethods = { cash: 0, instapay: 0, vodafone: 0, orange: 0, fawry: 0, bank: 0, other: 0 };
      const revenueChartData: { date: string; day: string; cash: number; instapay: number; vodafone: number; orange: number; fawry: number; bank: number; other: number }[] = [];
      for (let i = range - 1; i >= 0; i--) {
        const day = new Date();
        day.setDate(day.getDate() - i);
        const dayKey = `${day.getDate()}/${day.getMonth() + 1}`;
        const byMethod = { ...defaultMethods };
        paymentsData.filter(p => p.confirmed && p.paid_at).forEach(p => {
          const d = new Date(p.paid_at!);
          if (d.toDateString() !== day.toDateString()) return;
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
        const isToday = i === 0;
        revenueChartData.push({
          date: dayKey,
          day: isToday ? (locale === 'ar' ? 'اليوم' : 'Today') : dayLabels[day.getDay()],
          ...byMethod,
        });
      }

      const recentPayments: RecentPaymentRow[] = recentPaymentsRaw.map(p => ({
        id: p.id,
        student_name: p.students?.name ?? '—',
        student_number: p.students?.student_number,
        group_name: p.student_groups?.name,
        amount: parseFloat(String(p.amount || 0)),
        status: p.confirmed === true ? 'confirmed' : (p.status === 'late' ? 'late' : 'pending'),
        confirmed: p.confirmed,
      }));

      const now = new Date();
      const dayOfWeek = now.getDay();
      const diffToMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const thisWeekStart = new Date(now);
      thisWeekStart.setDate(now.getDate() - diffToMon);
      thisWeekStart.setHours(0, 0, 0, 0);
      const thisWeekEnd = new Date(thisWeekStart);
      thisWeekEnd.setDate(thisWeekStart.getDate() + 6);
      thisWeekEnd.setHours(23, 59, 59, 999);
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(thisWeekStart.getDate() - 7);
      const lastWeekEnd = new Date(lastWeekStart);
      lastWeekEnd.setDate(lastWeekStart.getDate() + 6);
      lastWeekEnd.setHours(23, 59, 59, 999);
      const thisWeekScans = scansData.filter(s => {
        const d = new Date(s.scanned_at);
        return d >= thisWeekStart && d <= thisWeekEnd;
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
      const balanceByStudent: Record<string, number> = {};
      paymentsData.filter(p => !p.confirmed && p.status !== 'late').forEach(p => {
        if (p.student_id) balanceByStudent[p.student_id] = (balanceByStudent[p.student_id] || 0) + parseFloat(String(p.amount || 0));
      });
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
      let atRiskCount = 0;
      for (const sid of Object.keys(balanceByStudent)) {
        if ((balanceByStudent[sid] || 0) <= 0) continue;
        if (!lastScanByStudent[sid] || new Date(lastScanByStudent[sid]) < fourteenDaysAgo) atRiskCount++;
      }

      const periodD = periodDays[inactPeriod];
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - periodD);
      const inactiveStudents: InactiveStudent[] = students
        .map(st => {
          const lastScannedAt = lastScanByStudent[st.id] || null;
          const lastDate = lastScannedAt ? new Date(lastScannedAt) : null;
          if (lastDate && lastDate >= cutoffDate) return null;
          const daysAbsent = lastDate ? Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
          return { id: st.id, name: st.name || '—', student_number: st.student_number || '—', last_scanned_at: lastScannedAt, days_absent: daysAbsent };
        })
        .filter((s): s is InactiveStudent => s !== null);
      inactiveStudents.sort((a, b) => (b.days_absent || 0) - (a.days_absent || 0));

      setData({
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
        collectionRatePct,
        newStudentsCount: newStudentsCount || 0,
        atRiskCount,
        inactiveStudents,
        scanDeltaPct,
        revenueDeltaPct,
      });
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [locale]);

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
        const canView = meData.user.can_view_dashboard === true || meData.user.role === 'owner' || meData.user.role === 'admin';
        if (!canView) {
          router.replace('/scan');
          return;
        }
        setCenterId(meData.user.center_id);
        setCenterBilling(meData.user.center ? {
          payment_due_date: meData.user.center.payment_due_date,
          billing_status: meData.user.center.billing_status,
          name: meData.user.center.name,
          plan: meData.user.center.plan,
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
          const json = (await res.json()) as { students?: AtRiskRow[] };
          setAtRiskStudents(json.students ?? []);
        }
      } catch {
        setAtRiskStudents([]);
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
          const json = (await res.json()) as { students?: AtRiskRow[] };
          setAtRiskStudents(json.students ?? []);
        }
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
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const handleExport = useCallback(async () => {
    if (!centerId) return;
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
      exportDashboardToExcel({
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
  }, [centerId, canExportExcel]);

  if (user?.role === 'assistant' && !isLoading) {
    return (
      <div
        className="bg-[var(--color-surface-0)] min-h-screen p-4 md:p-6 animate-fade-in
          pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-6"
      >
        <h1 className="text-2xl font-bold text-white mb-6">{t('title')}</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href="/scan"
            className="card p-8 text-center transition-all duration-fast ease-out
              hover:shadow-brand-sm hover:border-[var(--color-border-brand)] active:scale-[0.99]"
          >
            <QrCode className="w-16 h-16 mx-auto text-brand-400 mb-4" strokeWidth={1.5} />
            <h2 className="text-xl font-bold text-white">{t('action_scan')}</h2>
            <p className="text-[var(--color-text-secondary)] text-sm mt-2">{t('scanSubtitle')}</p>
          </Link>
          <Link
            href="/payments"
            className="card p-6 transition-all duration-fast ease-out
              hover:shadow-brand-sm hover:border-[var(--color-border-brand)]"
          >
            <p className="text-sm text-[var(--color-text-secondary)]">{t('unpaidCount')}</p>
            <p className="text-3xl font-bold text-white mt-1">
              {Number(data.unpaidCount).toLocaleString('en-US')}
            </p>
            <p className="text-brand-400 text-sm mt-2">{t('goToPayments')}</p>
          </Link>
        </div>
        <div className="card p-5 mt-6">
          <p className="text-sm text-[var(--color-text-secondary)] mb-1">{t('stats.attendance_today')}</p>
          <p className="text-2xl font-bold text-white">
            {Number(data.todayAttendance).toLocaleString('en-US')}
          </p>
        </div>
      </div>
    );
  }

  const paymentDueBanner = (() => {
    if (!centerBilling?.payment_due_date || centerBilling.billing_status === 'paid') return null;
    const dueDate = new Date(centerBilling.payment_due_date);
    const now = Date.now();
    const diffMs = dueDate.getTime() - now;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays > 0 && diffDays <= 5) {
      return (
        <div
          className="mb-4 p-4 rounded-xl border border-[var(--color-warning)]/40
            bg-[var(--color-surface-2)] flex flex-wrap items-center justify-between gap-4"
        >
          <span className="text-[var(--color-warning)] font-medium text-sm">
            {t('paymentDue', { days: diffDays, defaultValue: `Payment due in ${diffDays} days` })}
          </span>
          <button
            type="button"
            onClick={() => router.push('/settings/billing')}
            className="px-4 py-2 rounded-lg font-medium text-white
              bg-[var(--color-warning)] hover:opacity-90 transition-opacity"
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
          <div
            className="mb-4 p-4 rounded-xl border border-[var(--color-danger)]/40
              bg-[var(--color-surface-2)] flex flex-wrap items-center justify-between gap-4"
          >
            <span className="text-[var(--color-danger)] font-medium text-sm">
              {t('accountSuspended', { defaultValue: 'Account suspended due to overdue payment.' })}
            </span>
            <button
              type="button"
              onClick={() => router.push('/settings/billing')}
              className="px-4 py-2 rounded-lg font-medium text-white
                bg-[var(--color-danger)] hover:opacity-90 transition-opacity"
            >
              {t('payNow', { defaultValue: 'Pay Now' })}
            </button>
          </div>
        );
      }

      return (
        <div
          className="mb-4 p-4 rounded-xl border border-[var(--color-danger)]/40
            bg-[var(--color-surface-2)] flex flex-wrap items-center justify-between gap-4"
        >
          <span className="text-[var(--color-danger)] font-medium text-sm">
            {t('paymentOverdue', {
              hours: hoursRemaining,
              defaultValue: `Payment overdue! Account will be suspended in ${hoursRemaining} hours`,
            })}
          </span>
          <button
            type="button"
            onClick={() => router.push('/settings/billing')}
            className="px-4 py-2 rounded-lg font-medium text-white
              bg-[var(--color-danger)] hover:opacity-90 transition-opacity"
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

  const revenueTodayKpi = Number(statsData?.revenueToday ?? data.todayRevenue ?? 0);
  const activeStudentsThisWeek = Number(statsData?.activeStudentsThisWeek ?? 0);
  const attendanceTodayCount = Number(statsData?.attendanceToday ?? data.todayAttendance ?? 0);
  const pendingBalanceKpi = Number(statsData?.pendingBalance ?? data.totalPending ?? 0);
  const attendanceRate =
    activeStudentsThisWeek > 0
      ? Math.min(100, (attendanceTodayCount / activeStudentsThisWeek) * 100)
      : 0;
  const monthlyRevenueData = (statsData?.monthlyRevenue ?? []).map((r) => ({
    month: formatMonthLabel(r.month, locale),
    revenue: Number(r.amount) || 0,
  }));
  const collectionRate = Number(data.collectionRatePct ?? 0);
  const avgRevenue =
    data.totalStudents > 0
      ? Math.round(Number(data.monthConfirmed) / data.totalStudents)
      : 0;
  const unpaidBalance = Number(data.totalPending ?? 0);
  const confirmedPaymentsAmount = Number(data.monthConfirmed ?? 0);
  const pendingPaymentsAmount = Number(data.monthPending ?? 0);
  const topGroup: string | null = null;
  const egpSuffix = tCommon('egp');

  return (
    <div
      className="bg-[var(--color-surface-0)] min-h-screen p-4 md:p-6 animate-fade-in
        pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-6"
    >
      {showSurgeAlert && statsData?.surge_message && (
        <div
          className="card mb-4 p-4 border-[var(--color-border-brand)] flex items-center justify-between gap-4"
        >
          <span className="text-sm font-medium text-white">{statsData.surge_message}</span>
          <button
            type="button"
            onClick={dismissSurge}
            className="p-2 rounded-lg text-brand-400 hover:bg-[var(--color-surface-3)] transition-colors"
            aria-label={tCommon('cancel')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
      {paymentDueBanner}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('title')}</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex items-center gap-1 p-1 rounded-xl border border-[var(--color-border-subtle)]
              bg-[var(--color-surface-2)]"
          >
            {(['7', '30'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setTimeRange(r)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  timeRange === r
                    ? 'bg-[var(--color-surface-3)] text-white shadow-sm'
                    : 'text-[var(--color-text-secondary)]'
                }`}
              >
                {r === '7' ? t('last7Days') : t('last30Days')}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting || isLoading}
            className="px-4 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm font-semibold
              text-white bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)]
              transition-colors disabled:opacity-50"
          >
            {isExporting ? t('exporting') : t('exportData')}
          </button>
        </div>
      </div>

      {planUsage && planUsage.studentLimit < 999999 && (
        <div className="mb-4">
          <PlanUsageCard
            plan={planUsage.plan}
            weeklyUniqueStudents={planUsage.weeklyUniqueStudents}
            studentLimit={planUsage.studentLimit}
          />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4">
          <SkeletonPageHeader />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <SkeletonStat key={i} />
            ))}
          </div>
          {canViewRevenue && (
            <div className="card p-4">
              <SkeletonText className="w-32 h-5 mb-3" />
              <SkeletonBlock className="w-full h-14 rounded-lg" />
            </div>
          )}
          <div>
            <SkeletonText className="w-28 h-4 mb-3 uppercase" />
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="card p-4 flex flex-col items-center gap-2">
                  <SkeletonCircle className="w-10 h-10" />
                  <SkeletonText className="w-20 h-3" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card p-5">
              <SkeletonText className="w-36 h-5 mb-4" />
              <SkeletonBlock className="w-full h-28 rounded-lg" />
            </div>
            <div className="card p-5">
              <SkeletonText className="w-36 h-5 mb-4" />
              <SkeletonBlock className="w-full h-16 rounded-lg" />
            </div>
          </div>
          <SkeletonChart className="[&_.skeleton]:h-32" />
          <div className="card p-5">
            <SkeletonText className="w-40 h-5 mb-4" />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {canViewRevenue && (
              <div className="card p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--color-text-secondary)] font-medium">
                    {t('stats.revenue_today')}
                  </span>
                  <TrendingUp className="w-5 h-5 text-brand-400 shrink-0" strokeWidth={2} />
                </div>
                <span className="text-xl font-bold text-white">
                  {Number(revenueTodayKpi).toLocaleString('en-US')}
                  <span className="text-sm font-normal text-[var(--color-text-tertiary)] ms-1">
                    {egpSuffix}
                  </span>
                </span>
              </div>
            )}
            <div className="card p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--color-text-secondary)] font-medium">
                  {t('stats.active_students')}
                </span>
                <Users className="w-5 h-5 text-[var(--color-info)] shrink-0" strokeWidth={2} />
              </div>
              <span className="text-xl font-bold text-white">
                {Number(activeStudentsThisWeek).toLocaleString('en-US')}
              </span>
            </div>
            <div className="card p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--color-text-secondary)] font-medium">
                  {t('stats.attendance_today')}
                </span>
                <QrCode className="w-5 h-5 text-[var(--color-success)] shrink-0" strokeWidth={2} />
              </div>
              <span className="text-xl font-bold text-white">
                {Number(attendanceTodayCount).toLocaleString('en-US')}
              </span>
            </div>
            <div className="card p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--color-text-secondary)] font-medium">
                  {t('stats.pending_payments')}
                </span>
                <CreditCard className="w-5 h-5 text-[var(--color-warning)] shrink-0" strokeWidth={2} />
              </div>
              <span className="text-xl font-bold text-white">
                {Number(pendingBalanceKpi).toLocaleString('en-US')}
                <span className="text-sm font-normal text-[var(--color-text-tertiary)] ms-1">
                  {egpSuffix}
                </span>
              </span>
            </div>
          </div>

          {canViewRevenue && monthlyRevenueData.length > 0 && (
            <div className="card p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-white">{t('sparkline_title')}</span>
              </div>
              <RevenueSparkline data={monthlyRevenueData} currencySuffix={egpSuffix} />
            </div>
          )}

          <div className="mb-6">
            <h2
              className="text-sm font-semibold text-[var(--color-text-secondary)] mb-3 uppercase tracking-wide"
            >
              {t('quick_actions')}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <Link
                href="/scan"
                className="card p-4 flex flex-col items-center gap-2 text-center
                  hover:shadow-brand-sm hover:border-[var(--color-border-brand)]
                  transition-all duration-fast ease-out active:scale-[0.97]"
              >
                <span
                  className="w-10 h-10 rounded-lg flex items-center justify-center
                    bg-[rgba(13,148,136,0.12)] text-brand-400"
                >
                  <QrCode className="w-5 h-5" strokeWidth={2} />
                </span>
                <span className="text-xs font-medium text-white">{t('action_scan')}</span>
              </Link>
              <Link
                href="/students"
                className="card p-4 flex flex-col items-center gap-2 text-center
                  hover:shadow-brand-sm hover:border-[var(--color-border-brand)]
                  transition-all duration-fast ease-out active:scale-[0.97]"
              >
                <span
                  className="w-10 h-10 rounded-lg flex items-center justify-center
                    bg-[rgba(59,130,246,0.12)] text-[var(--color-info)]"
                >
                  <UserPlus className="w-5 h-5" strokeWidth={2} />
                </span>
                <span className="text-xs font-medium text-white">{t('action_add_student')}</span>
              </Link>
              <Link
                href="/payments"
                className="card p-4 flex flex-col items-center gap-2 text-center
                  hover:shadow-brand-sm hover:border-[var(--color-border-brand)]
                  transition-all duration-fast ease-out active:scale-[0.97]"
              >
                <span
                  className="w-10 h-10 rounded-lg flex items-center justify-center
                    bg-[rgba(245,158,11,0.12)] text-[var(--color-warning)]"
                >
                  <CreditCard className="w-5 h-5" strokeWidth={2} />
                </span>
                <span className="text-xs font-medium text-white">{t('action_payments')}</span>
              </Link>
              <Link
                href="/students/print"
                className="card p-4 flex flex-col items-center gap-2 text-center
                  hover:shadow-brand-sm hover:border-[var(--color-border-brand)]
                  transition-all duration-fast ease-out active:scale-[0.97]"
              >
                <span
                  className="w-10 h-10 rounded-lg flex items-center justify-center
                    bg-[rgba(16,185,129,0.12)] text-[var(--color-success)]"
                >
                  <Printer className="w-5 h-5" strokeWidth={2} />
                </span>
                <span className="text-xs font-medium text-white">{t('action_print')}</span>
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-white mb-4">{t('attendance_title')}</h2>
              <AttendanceRing
                rate={attendanceRate}
                todayCount={attendanceTodayCount}
                label={t('attendance_title')}
              />
            </div>
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-white mb-4">{t('payments_title')}</h2>
              <PaymentBar
                confirmed={confirmedPaymentsAmount}
                pending={pendingPaymentsAmount}
                confirmedLabel={t('confirmed')}
                pendingLabel={t('pending')}
                currencySuffix={egpSuffix}
              />
            </div>
          </div>

          <div className="card p-5 mb-4">
            <h2 className="text-sm font-semibold text-white mb-4">{t('performance_title')}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-[var(--color-text-secondary)]">{t('collection_rate')}</span>
                <span className="text-xl font-bold text-white">
                  {Number(collectionRate).toLocaleString('en-US')}%
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-[var(--color-text-secondary)]">{t('avg_revenue')}</span>
                <span className="text-xl font-bold text-white">
                  {Number(avgRevenue).toLocaleString('en-US')}
                  <span className="text-xs text-[var(--color-text-tertiary)] ms-1">{egpSuffix}</span>
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-[var(--color-text-secondary)]">{t('unpaid_balance')}</span>
                <span className="text-xl font-bold text-[var(--color-warning)]">
                  {Number(unpaidBalance).toLocaleString('en-US')}
                  <span className="text-xs ms-1">{egpSuffix}</span>
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-[var(--color-text-secondary)]">{t('top_group')}</span>
                <span className="text-base font-bold text-white truncate">
                  {topGroup ?? t('no_data')}
                </span>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">{t('at_risk_title')}</h2>
              <Link href="/students" className="text-xs text-brand-400 hover:text-brand-300">
                {t('view_all')}
              </Link>
            </div>

            {atRiskStudents.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)] text-center py-4">
                {t('at_risk_empty')}
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-[var(--color-border-subtle)]">
                {atRiskStudents.slice(0, 5).map((student) => (
                  <div
                    key={student.id}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div
                      className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center
                        bg-[rgba(239,68,68,0.12)] text-[var(--color-danger)] font-semibold text-sm"
                    >
                      {student.name?.charAt(0) ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{student.name}</p>
                      <p className="text-xs text-[var(--color-text-tertiary)]">
                        {student.student_number ?? ''}
                      </p>
                    </div>
                    <span className="badge badge-danger text-xs flex-shrink-0">
                      {Number(student.days_since_last_scan).toLocaleString('en-US')} {t('at_risk_days')}
                    </span>
                  </div>
                ))}
              </div>
            )}
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
            <h3 className="text-lg font-semibold text-white mb-2">
              {tSettings('upgradeToUnlockFeature')}
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">
              {t('exportExcelUpgrade', {
                defaultValue: 'Excel/CSV export is available on Pro plan and above.',
              })}
            </p>
            <Link
              href="/settings/billing"
              className="inline-block px-4 py-2 bg-brand-500 hover:opacity-90 text-white text-sm font-medium rounded-lg"
            >
              {t('upgradePlan')}
            </Link>
            <button
              type="button"
              onClick={() => setShowUpgradeModal(false)}
              className="ms-2 px-4 py-2 rounded-lg text-sm text-white bg-[var(--color-surface-3)]"
            >
              {tCommon('cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
