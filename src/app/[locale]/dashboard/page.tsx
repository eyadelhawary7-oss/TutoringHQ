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
import AttendanceCard from '@/components/dashboard/AttendanceCard';
import PlanUsageCard from '@/components/dashboard/PlanUsageCard';
import { Progress } from '@/components/ui/progress';
import AttendanceAreaChart from '@/components/dashboard/AttendanceAreaChart';
import RevenueStackedChart from '@/components/dashboard/RevenueStackedChart';
import PaymentMethodsDonut from '@/components/dashboard/PaymentMethodsDonut';
import InactiveList, { type InactivePeriod, type InactiveStudent } from '@/components/dashboard/InactiveList';
import { QrCode, TrendingUp, Users, CreditCard, Camera, UserPlus, DollarSign, FileSpreadsheet } from 'lucide-react';
import { toAr } from '@/lib/number-utils';

function isOwnerOrAdmin(role?: string): boolean {
  return role === 'owner' || role === 'admin';
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

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tPayments = useTranslations('payments');
  const tSettings = useTranslations('settings');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { user, hasPermission } = useUser();
  const isOwnerOrAdminRole = isOwnerOrAdmin(user?.role);
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

  // Real-time updates
  useEffect(() => {
    if (!centerId) return;

    const channel = supabase
      .channel('dashboard-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_scans', filter: `center_id=eq.${centerId}` },
        () => loadDashboard(centerId, inactivePeriod, timeRange === '30' ? 30 : 7)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments', filter: `center_id=eq.${centerId}` },
        () => loadDashboard(centerId, inactivePeriod, timeRange === '30' ? 30 : 7)
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

  // Assistant dashboard: scan CTA + payment quick actions
  if (user?.role === 'assistant' && !isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6 animate-fade-in">
            <h1 className="text-2xl font-bold text-foreground mb-6">
              {t('title')}
            </h1>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <Link
                href="/scan"
                className="block p-8 hover:opacity-90 rounded-2xl shadow-lg text-center transition-colors"
                style={{ background: 'hsl(var(--primary))' }}
              >
                <svg className="w-16 h-16 mx-auto text-white mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
                <h2 className="text-xl font-bold text-white">{t('scanNow')}</h2>
                <p className="text-white/60 text-sm mt-2">{t('scanSubtitle')}</p>
              </Link>
              <Link
                href="/payments"
                className="block bg-white rounded-xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-all duration-200"
              >
                <p className="text-sm text-muted-foreground">{t('unpaidCount')}</p>
                <p className="text-3xl font-bold text-foreground mt-1">{data.unpaidCount}</p>
                <p className="text-primary text-sm mt-2">{t('goToPayments')}</p>
              </Link>
            </div>
            <div className="mt-6">
              <AttendanceCard count={data.todayAttendance} label={t('attendance')} />
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

    // Due soon (up to 5 days before due date)
    if (diffDays > 0 && diffDays <= 5) {
      return (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-300 rounded-xl flex flex-wrap items-center justify-between gap-4">
          <span className="text-amber-800 font-medium">
            {t('paymentDue', { days: diffDays, defaultValue: `Payment due in ${diffDays} days` })}
          </span>
          <button
            onClick={() => router.push('/settings/billing')}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg"
          >
            {t('payNow', { defaultValue: 'Pay Now' })}
          </button>
        </div>
      );
    }

    // Overdue: countdown to suspension (7-day grace period)
    if (diffDays <= 0) {
      const suspendDate = new Date(centerBilling.payment_due_date);
      suspendDate.setDate(suspendDate.getDate() + 7); // 7 days grace period

      const hoursRemaining = Math.max(
        0,
        Math.floor((suspendDate.getTime() - now) / (1000 * 60 * 60))
      );

      if (hoursRemaining <= 0) {
        return (
          <div className="mb-6 p-4 bg-red-50 border border-red-300 rounded-xl flex flex-wrap items-center justify-between gap-4">
            <span className="text-red-800 font-medium">
              {t('accountSuspended', { defaultValue: 'Account suspended due to overdue payment.' })}
            </span>
            <button
              onClick={() => router.push('/settings/billing')}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg"
            >
              {t('payNow', { defaultValue: 'Pay Now' })}
            </button>
          </div>
        );
      }

      return (
        <div className="mb-6 p-4 bg-red-50 border border-red-300 rounded-xl flex flex-wrap items-center justify-between gap-4">
          <span className="text-red-800 font-medium">
            {t('paymentOverdue', { hours: hoursRemaining, defaultValue: `Payment overdue! Account will be suspended in ${hoursRemaining} hours` })}
          </span>
          <button
            onClick={() => router.push('/settings/billing')}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg"
          >
            {t('payNow', { defaultValue: 'Pay Now' })}
          </button>
        </div>
      );
    }
    return null;
  })();

  return (
    <div className="p-4 md:p-6 space-y-6 animate-fade-in">
          {paymentDueBanner}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
              <p className="text-sm text-slate-500 mt-0.5">{t('confirmedOnly')}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 p-1 rounded-xl border border-border bg-muted">
                {(['7', '30'] as const).map(r => (
                  <button
                    key={r}
                    onClick={() => setTimeRange(r)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${timeRange === r ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
                  >
                    {r === '7' ? t('last7Days') : t('last30Days')}
                  </button>
                ))}
              </div>
              <button
              onClick={handleExport}
              disabled={isExporting || isLoading}
              className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
            >
              {isExporting ? t('exporting') : t('exportData')}
            </button>
            {showUpgradeModal && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowUpgradeModal(false)}>
                <div className="bg-card rounded-2xl border border-border shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    {tSettings('upgradeToUnlockFeature')}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {t('exportExcelUpgrade', { defaultValue: 'Excel/CSV export is available on Pro plan and above.' })}
                  </p>
                  <Link
                    href="/settings/billing"
                    className="inline-block px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg"
                  >
                    {t('upgradePlan')}
                  </Link>
                  <button
                    onClick={() => setShowUpgradeModal(false)}
                    className="ms-2 px-4 py-2 bg-slate-100 rounded-lg text-sm text-slate-700"
                  >
                    {tCommon('cancel')}
                  </button>
                </div>
              </div>
            )}
            </div>
          </div>

          {planUsage && planUsage.studentLimit < 999999 && (
            <div className="mb-6">
              <PlanUsageCard
                plan={planUsage.plan}
                weeklyUniqueStudents={planUsage.weeklyUniqueStudents}
                studentLimit={planUsage.studentLimit}
              />
            </div>
          )}

          {isLoading ? (
            <div className="space-y-6">
              {/* KPI Cards skeleton */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                {canViewRevenue && (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-full bg-slate-200 animate-pulse" />
                      <div className="h-6 w-12 rounded-full bg-slate-200 animate-pulse" />
                    </div>
                    <div className="h-8 w-24 mt-3 rounded bg-slate-200 animate-pulse" />
                    <div className="h-4 w-20 mt-2 rounded bg-slate-200 animate-pulse" />
                  </div>
                )}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 rounded-full bg-slate-200 animate-pulse" />
                    <div className="h-6 w-12 rounded-full bg-slate-200 animate-pulse" />
                  </div>
                  <div className="h-8 w-16 mt-3 rounded bg-slate-200 animate-pulse" />
                  <div className="h-4 w-20 mt-2 rounded bg-slate-200 animate-pulse" />
                </div>
                {canViewRevenue && (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-full bg-slate-200 animate-pulse" />
                      <div className="h-6 w-8 rounded-full bg-slate-200 animate-pulse" />
                    </div>
                    <div className="h-8 w-12 mt-3 rounded bg-slate-200 animate-pulse" />
                    <div className="h-4 w-24 mt-2 rounded bg-slate-200 animate-pulse" />
                  </div>
                )}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 rounded-full bg-slate-200 animate-pulse" />
                    <div className="h-6 w-10 rounded-full bg-slate-200 animate-pulse" />
                  </div>
                  <div className="h-8 w-16 mt-3 rounded bg-slate-200 animate-pulse" />
                  <div className="h-4 w-24 mt-2 rounded bg-slate-200 animate-pulse" />
                </div>
              </div>
              {/* Weekly Performance skeleton */}
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-4 w-36 rounded bg-slate-200 animate-pulse" />
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col gap-2">
                      <div className="h-4 w-24 rounded bg-slate-200 animate-pulse" />
                      <div className="h-6 w-16 rounded bg-slate-200 animate-pulse" />
                      <div className="h-1.5 w-full rounded bg-slate-200 animate-pulse" />
                    </div>
                  ))}
                </div>
              </div>
              {/* Quick Actions skeleton */}
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-4 w-28 rounded bg-slate-200 animate-pulse" />
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-200 animate-pulse shrink-0" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-24 rounded bg-slate-200 animate-pulse" />
                        <div className="h-3 w-full rounded bg-slate-200 animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Charts skeleton */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <div className="h-5 w-32 mb-4 rounded bg-slate-200 animate-pulse" />
                  <div className="h-48 rounded bg-slate-200 animate-pulse" />
                </div>
                {canViewRevenue && (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <div className="h-5 w-32 mb-4 rounded bg-slate-200 animate-pulse" />
                    <div className="h-48 rounded bg-slate-200 animate-pulse" />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                {canViewRevenue && (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 animate-slide-up">
                    <div className="flex items-center justify-between">
                      <div className="p-3 rounded-full bg-teal-100 shrink-0">
                        <TrendingUp size={20} className="text-teal-600" />
                      </div>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-teal-100 text-teal-600">
                        {data.revenueDeltaPct >= 0 ? '+' : ''}{data.revenueDeltaPct}{t('pct')}
                      </span>
                    </div>
                    <p className="text-2xl font-black text-slate-900 font-mono mt-1">
                      {locale === 'ar' ? toAr(Math.round(data.todayRevenue)) : Math.round(data.todayRevenue).toLocaleString()} ج.م
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">{t('todayRevenue')}</p>
                  </div>
                )}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 animate-slide-up">
                  <div className="flex items-center justify-between">
                    <div className="p-3 rounded-full bg-blue-100 shrink-0">
                      <QrCode size={20} className="text-blue-600" />
                    </div>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-600">
                      {data.scanDeltaPct >= 0 ? '+' : ''}{data.scanDeltaPct}{t('pct')}
                    </span>
                  </div>
                  <p className="text-2xl font-black text-slate-900 font-mono mt-1">{locale === 'ar' ? toAr(data.todayAttendance) : data.todayAttendance}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{t('todayScans')}</p>
                </div>
                {canViewRevenue && (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 animate-slide-up">
                    <div className="flex items-center justify-between">
                      <div className="p-3 rounded-full bg-amber-100 shrink-0">
                        <CreditCard size={20} className="text-amber-600" />
                      </div>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-600">
                        {data.pendingCount}
                      </span>
                    </div>
                    <p className="text-2xl font-black text-slate-900 font-mono mt-1">{data.pendingCount}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{t('pendingPayments')}</p>
                  </div>
                )}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 animate-slide-up">
                  <div className="flex items-center justify-between">
                    <div className="p-3 rounded-full bg-green-100 shrink-0">
                      <Users size={20} className="text-green-600" />
                    </div>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-600">
                      +{locale === 'ar' ? toAr(data.newStudentsCount) : data.newStudentsCount}
                    </span>
                  </div>
                  <p className="text-2xl font-black text-slate-900 font-mono mt-1">{locale === 'ar' ? toAr(data.totalStudents) : data.totalStudents}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{t('activeStudents')}</p>
                </div>
              </div>

              {/* Weekly Performance */}
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-xs font-semibold tracking-widest text-slate-500 uppercase">{t('weeklyPerformance')}</span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col gap-2">
                    <p className="text-xs text-slate-500">{t('collectionRate')}</p>
                    <p className="text-xl font-bold text-slate-900">{data.collectionRatePct}%</p>
                    <Progress value={data.collectionRatePct} className="h-1.5" />
                  </div>
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col gap-2">
                    <p className="text-xs text-slate-500">{t('avgRevenueStudent')}</p>
                    <p className="text-xl font-bold text-slate-900 font-mono">
                      {locale === 'ar' ? toAr(Math.round(data.monthConfirmed / (data.totalStudents || 1))) : Math.round(data.monthConfirmed / (data.totalStudents || 1)).toLocaleString()} ج.م
                    </p>
                  </div>
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col gap-2">
                    <p className="text-xs text-slate-500">{t('totalUnpaidBalance')}</p>
                    <p className={`text-xl font-bold font-mono ${data.totalPending > 0 ? 'text-destructive' : 'text-slate-900'}`}>
                      {locale === 'ar' ? toAr(Math.round(data.totalPending)) : Math.round(data.totalPending).toLocaleString()} ج.م
                    </p>
                  </div>
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col gap-2">
                    <p className="text-xs text-slate-500">{t('topGroupWeek')}</p>
                    <p className="text-xl font-bold text-slate-900">—</p>
                    <p className="text-xs text-slate-500">{data.todayAttendance} {t('scans')}</p>
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-xs font-semibold tracking-widest text-slate-500 uppercase">{t('quickActions')}</span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <Link
                    href="/scan"
                    className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex items-start gap-3 hover:shadow-md transition-shadow group"
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-teal-100">
                      <Camera size={20} className="text-teal-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 group-hover:text-teal-600 transition-colors">{t('scanStudent')}</p>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{t('scanStudentDesc')}</p>
                    </div>
                  </Link>
                  <Link
                    href="/students"
                    className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex items-start gap-3 hover:shadow-md transition-shadow group"
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-green-100">
                      <UserPlus size={20} className="text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 group-hover:text-teal-600 transition-colors">{t('addStudent')}</p>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{t('addStudentDesc')}</p>
                    </div>
                  </Link>
                  <Link
                    href="/payments?filter=pending"
                    className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex items-start gap-3 hover:shadow-md transition-shadow group"
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-amber-100">
                      <DollarSign size={20} className="text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 group-hover:text-teal-600 transition-colors">{t('viewUnpaid')}</p>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{t('viewUnpaidDesc')}</p>
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={handleExport}
                    disabled={isExporting}
                    className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex items-start gap-3 hover:shadow-md transition-shadow group text-start w-full disabled:opacity-50"
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-blue-100">
                      <FileSpreadsheet size={20} className="text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 group-hover:text-teal-600 transition-colors">{t('exportReport')}</p>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{t('exportReportDesc')}</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <h3 className="font-semibold text-slate-900 mb-4">{t('attendanceChart')}</h3>
                  <AttendanceAreaChart data={data.trendData ?? []} />
                </div>
                {canViewRevenue && (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <h3 className="font-semibold text-slate-900 mb-4">{t('revenueChart')}</h3>
                    <RevenueStackedChart data={data.revenueChartData ?? []} />
                  </div>
                )}
              </div>

              {/* Payment Methods Donut */}
              {canViewRevenue && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <h3 className="font-semibold text-slate-900 mb-4">{t('paymentMethods')}</h3>
                  <PaymentMethodsDonut data={data.revenueByMethod ?? []} />
                </div>
              )}

              {/* Recent Payments */}
              {canViewRevenue && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <span className="text-xs font-semibold tracking-widest text-slate-500 uppercase">{t('recentPayments')}</span>
                      <div className="flex-1 h-px bg-slate-200" />
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="text-start py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{tPayments('studentName')}</th>
                          <th className="text-start py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden sm:table-cell">{tPayments('group')}</th>
                          <th className="text-start py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{tPayments('amount')}</th>
                          <th className="text-start py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{tCommon('status')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(data.recentPayments ?? []).slice(0, 5).map(p => (
                          <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                            <td className="py-3.5 px-4 text-sm text-slate-900">
                              <div className="font-medium">{p.student_name}</div>
                              {p.student_number && <div className="text-xs text-slate-500 font-mono">{p.student_number}</div>}
                            </td>
                            <td className="py-3.5 px-4 text-sm text-slate-500 hidden sm:table-cell">{p.group_name ?? '—'}</td>
                            <td className="py-3.5 px-4 text-sm font-bold text-slate-900 font-mono">{Math.round(p.amount).toLocaleString()} ج.م</td>
                            <td className="py-3.5 px-4 text-sm">
                              <span className={p.status === 'confirmed' ? 'badge-confirmed' : p.status === 'pending' ? 'badge-pending' : 'badge-late'}>
                                {p.status === 'confirmed' ? tPayments('confirmedStatus') : p.status === 'pending' ? tPayments('filterPending') : tPayments('lateEntry')}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {(data.recentPayments ?? []).length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-slate-500 text-sm">{tCommon('noData')}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Inactive Students Section */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-xs font-semibold tracking-widest text-slate-500 uppercase">{t('inactiveStudents')}</span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
                <InactiveList
                  students={data.inactiveStudents ?? []}
                  period={inactivePeriod}
                  onPeriodChange={setInactivePeriod}
                />
              </div>
            </div>
          )}
      </div>
  );
}
