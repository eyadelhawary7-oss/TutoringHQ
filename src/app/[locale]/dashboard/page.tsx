'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbCount } from '@/lib/db-proxy';
import { exportDashboardToExcel } from '@/lib/excel-export';
import { useUser } from '@/contexts/UserContext';
import { Link } from '@/i18n/routing';
import AttendanceCard from '@/components/dashboard/AttendanceCard';
import PaymentDonut from '@/components/dashboard/PaymentDonut';
import RevenueBar from '@/components/dashboard/RevenueBar';
import AttendanceTrend from '@/components/dashboard/AttendanceTrend';
import InactiveList, { type InactivePeriod, type InactiveStudent } from '@/components/dashboard/InactiveList';
import { toAr } from '@/lib/number-utils';

function isOwnerOrAdmin(role?: string): boolean {
  return role === 'owner' || role === 'admin';
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
  monthTotal: number;
  monthConfirmed: number;
  monthPending: number;
  monthLate: number;
  weeklyTrendPct: number;
  collectionRatePct: number;
  newStudentsCount: number;
  atRiskCount: number;
  inactiveStudents: InactiveStudent[];
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const { user, hasPermission } = useUser();
  const isOwnerOrAdminRole = isOwnerOrAdmin(user?.role);
  const canViewRevenue = user?.role === 'owner' || user?.role === 'admin' || user?.can_view_revenue === true;

  const [centerBilling, setCenterBilling] = useState<{ payment_due_date?: string; billing_status?: string; name?: string } | null>(null);
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
    monthTotal: 0,
    monthConfirmed: 0,
    monthPending: 0,
    monthLate: 0,
    weeklyTrendPct: 0,
    collectionRatePct: 0,
    newStudentsCount: 0,
    atRiskCount: 0,
    inactiveStudents: [],
  });
  const [inactivePeriod, setInactivePeriod] = useState<InactivePeriod>('7d');
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

  const loadDashboard = useCallback(async (cId: string, inactPeriod: InactivePeriod = '7d') => {
    try {
      // Today's attendance count
      const { count: attendanceCount } = await dbCount({
        table: 'attendance_scans',
        filters: [
          { column: 'center_id', op: 'eq', value: cId },
          { column: 'scanned_at', op: 'gte', value: startOfToday() },
        ],
      });

      // Student payment stats
      const { data: studentsRaw } = await dbSelect({
        table: 'students',
        select: 'id, name, subject, fee, payment_status',
        filters: [{ column: 'center_id', op: 'eq', value: cId }],
      });
      const students = (studentsRaw || []) as { id: string; name: string; subject: string; fee: number; payment_status: string }[];

      const paidCount = students.filter(s => s.payment_status === 'paid').length;
      const unpaidCount = students.filter(s => s.payment_status === 'unpaid').length;
      const pendingCount = students.filter(s => s.payment_status === 'pending').length;

      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      // Collected today: only CONFIRMED payments
      const { data: confirmedTodayPayments } = await dbSelect({
        table: 'payments',
        select: 'amount, method',
        filters: [
          { column: 'center_id', op: 'eq', value: cId },
          { column: 'confirmed', op: 'eq', value: true },
          { column: 'paid_at', op: 'gte', value: startOfToday() },
          { column: 'paid_at', op: 'lte', value: todayEnd.toISOString() },
        ],
      });

      const todayPayments = (confirmedTodayPayments || []) as { amount: number; method: string }[];
      const todayRevenue = todayPayments.reduce((sum, p) => sum + parseFloat(String(p.amount || 0)), 0);

      // Total pending (lifetime): unconfirmed payments with status pending
      const { data: allPendingPayments } = await dbSelect({
        table: 'payments',
        select: 'amount',
        filters: [
          { column: 'center_id', op: 'eq', value: cId },
          { column: 'confirmed', op: 'eq', value: false },
          { column: 'status', op: 'eq', value: 'pending' },
        ],
      });
      const totalPending = (allPendingPayments || []).reduce((sum: number, p: { amount?: number }) => sum + parseFloat(String(p.amount || 0)), 0);

      // Monthly revenue (current month)
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59).toISOString();
      const { data: monthPayments } = await dbSelect({
        table: 'payments',
        select: 'amount, confirmed, status, method',
        filters: [
          { column: 'center_id', op: 'eq', value: cId },
          { column: 'paid_at', op: 'gte', value: monthStart },
          { column: 'paid_at', op: 'lte', value: monthEnd },
        ],
      });
      const monthPmts = (monthPayments || []) as { amount: number; confirmed?: boolean; status?: string; method?: string }[];
      const monthTotal = monthPmts.reduce((sum, p) => sum + parseFloat(String(p.amount || 0)), 0);
      const monthConfirmed = monthPmts.filter(p => p.confirmed === true).reduce((sum, p) => sum + parseFloat(String(p.amount || 0)), 0);
      const monthPending = monthPmts.filter(p => p.confirmed === false && p.status === 'pending').reduce((sum, p) => sum + parseFloat(String(p.amount || 0)), 0);
      const monthLate = monthPmts.filter(p => p.status === 'late').reduce((sum, p) => sum + parseFloat(String(p.amount || 0)), 0);

      // Revenue by method (from this month's confirmed payments)
      const methodMap = new Map<string, number>();
      const confirmedMonth = monthPmts.filter(p => p.confirmed === true);
      confirmedMonth.forEach(p => {
        const method = p.method || 'cash';
        const current = methodMap.get(method) || 0;
        methodMap.set(method, current + parseFloat(String(p.amount || 0)));
      });
      const revenueByMethod = Array.from(methodMap.entries()).map(([method, amount]) => ({ method, amount }));

      // 7-day attendance trend
      const trendData: { date: string; count: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const day = new Date();
        day.setDate(day.getDate() - i);
        const dayStart = new Date(day);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(day);
        dayEnd.setHours(23, 59, 59, 999);

        const { count } = await dbCount({
          table: 'attendance_scans',
          filters: [
            { column: 'center_id', op: 'eq', value: cId },
            { column: 'scanned_at', op: 'gte', value: dayStart.toISOString() },
            { column: 'scanned_at', op: 'lte', value: dayEnd.toISOString() },
          ],
        });

        trendData.push({
          date: `${day.getDate()}/${day.getMonth() + 1}`,
          count: count || 0,
        });
      }

      // Weekly trend: this week vs last week attendance
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
      const lastWeekEnd = new Date(thisWeekStart);
      lastWeekEnd.setDate(thisWeekStart.getDate() - 1);
      lastWeekEnd.setHours(23, 59, 59, 999);

      const [{ count: thisWeekCount }, { count: lastWeekCount }] = await Promise.all([
        dbCount({
          table: 'attendance_scans',
          filters: [
            { column: 'center_id', op: 'eq', value: cId },
            { column: 'scanned_at', op: 'gte', value: thisWeekStart.toISOString() },
            { column: 'scanned_at', op: 'lte', value: thisWeekEnd.toISOString() },
          ],
        }),
        dbCount({
          table: 'attendance_scans',
          filters: [
            { column: 'center_id', op: 'eq', value: cId },
            { column: 'scanned_at', op: 'gte', value: lastWeekStart.toISOString() },
            { column: 'scanned_at', op: 'lte', value: lastWeekEnd.toISOString() },
          ],
        }),
      ]);
      const thisWeek = thisWeekCount || 0;
      const lastWeek = lastWeekCount || 0;
      const weeklyTrendPct = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : 0;

      // Collection rate
      const collectionRatePct = monthTotal > 0 ? Math.round((monthConfirmed / monthTotal) * 100) : 0;

      // New students (created in last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const { count: newStudentsCount } = await dbCount({
        table: 'students',
        filters: [
          { column: 'center_id', op: 'eq', value: cId },
          { column: 'created_at', op: 'gte', value: sevenDaysAgo.toISOString() },
        ],
      });

      // At risk: balance_due > 0 and no attendance in 14+ days
      const { data: allPayments } = await dbSelect({
        table: 'payments',
        select: 'student_id, amount, confirmed, status',
        filters: [{ column: 'center_id', op: 'eq', value: cId }],
      });
      const balanceByStudent: Record<string, number> = {};
      for (const p of (allPayments || []) as { student_id: string; amount: number; confirmed?: boolean; status?: string }[]) {
        if (p.confirmed === false && p.status !== 'late') {
          balanceByStudent[p.student_id] = (balanceByStudent[p.student_id] || 0) + parseFloat(String(p.amount || 0));
        }
      }
      const { data: allScans } = await dbSelect({
        table: 'attendance_scans',
        select: 'student_id, scanned_at',
        filters: [{ column: 'center_id', op: 'eq', value: cId }],
        order: { column: 'scanned_at', ascending: false },
      });
      const lastScanByStudent: Record<string, string> = {};
      for (const s of (allScans || []) as { student_id: string; scanned_at: string }[]) {
        if (!lastScanByStudent[s.student_id]) lastScanByStudent[s.student_id] = s.scanned_at;
      }
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
      let atRiskCount = 0;
      for (const sid of Object.keys(balanceByStudent)) {
        if ((balanceByStudent[sid] || 0) <= 0) continue;
        const lastScan = lastScanByStudent[sid];
        if (!lastScan || new Date(lastScan) < fourteenDaysAgo) atRiskCount++;
      }

      // Inactive students: no attendance in >= periodDays
      const periodD = periodDays[inactPeriod];
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - periodD);
      const { data: studentsFull } = await dbSelect({
        table: 'students',
        select: 'id, name, student_number, created_at',
        filters: [{ column: 'center_id', op: 'eq', value: cId }],
      });
      const studentList = (studentsFull || []) as { id: string; name: string; student_number?: string; created_at: string }[];
      const inactiveStudents: InactiveStudent[] = [];
      for (const st of studentList) {
        const lastScan = lastScanByStudent[st.id];
        const lastScannedAt = lastScan || null;
        const lastDate = lastScannedAt ? new Date(lastScannedAt) : null;
        const isInactive = !lastDate || lastDate < cutoffDate;
        if (isInactive) {
          const daysAbsent = lastDate
            ? Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
            : 0;
          inactiveStudents.push({
            id: st.id,
            name: st.name || '—',
            student_number: st.student_number || '—',
            last_scanned_at: lastScannedAt,
            days_absent: daysAbsent,
          });
        }
      }
      inactiveStudents.sort((a, b) => (b.days_absent || 0) - (a.days_absent || 0));

      setData({
        todayAttendance: attendanceCount || 0,
        totalStudents: students.length,
        paidCount,
        unpaidCount,
        pendingCount,
        todayRevenue,
        totalPending,
        revenueByMethod,
        trendData,
        monthTotal,
        monthConfirmed,
        monthPending,
        monthLate,
        weeklyTrendPct,
        collectionRatePct,
        newStudentsCount: newStudentsCount || 0,
        atRiskCount,
        inactiveStudents,
      });
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const meRes = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const meData = await meRes.json();

      if (meData?.user?.center_id) {
        setCenterId(meData.user.center_id);
        setCenterBilling(meData.user.center ? {
          payment_due_date: meData.user.center.payment_due_date,
          billing_status: meData.user.center.billing_status,
          name: meData.user.center.name,
        } : null);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (centerId) {
      loadDashboard(centerId, inactivePeriod);
    }
  }, [centerId, inactivePeriod, loadDashboard]);

  // Real-time updates
  useEffect(() => {
    if (!centerId) return;

    const channel = supabase
      .channel('dashboard-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_scans', filter: `center_id=eq.${centerId}` },
        () => loadDashboard(centerId)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments', filter: `center_id=eq.${centerId}` },
        () => loadDashboard(centerId)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [centerId, loadDashboard]);

  const handleExport = useCallback(async () => {
    if (!centerId) return;
    setIsExporting(true);
    try {
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
          filters: [{ column: 'center_id', op: 'eq', value: centerId }],
          order: { column: 'scanned_at', ascending: false },
          limit: 500,
        }),
        dbSelect({
          table: 'payments',
          select: 'student_id, amount, method, paid_at, recorded_by',
          filters: [{ column: 'center_id', op: 'eq', value: centerId }],
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
  }, [centerId]);

  // Assistant dashboard: scan CTA + payment quick actions
  if (user?.role === 'assistant' && !isLoading) {
    return (
      <div className="min-h-screen">
          <div className="max-w-7xl mx-auto p-6">
            <h1 className="text-2xl font-bold text-slate-100 mb-6">
              {t('title')}
            </h1>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <Link
                href="/scan"
                className="block p-8 bg-indigo-600 hover:bg-indigo-700 rounded-2xl shadow-lg text-center transition-colors"
              >
                <svg className="w-16 h-16 mx-auto text-white mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
                <h2 className="text-xl font-bold text-white">{t('scanNow')}</h2>
                <p className="text-indigo-100 text-sm mt-2">{t('scanSubtitle')}</p>
              </Link>
              <Link
                href="/payments"
                className="block p-8 glass hover:border-indigo-500/50 transition-all duration-200"
              >
                <p className="text-sm text-slate-400">{t('unpaidCount')}</p>
                <p className="text-3xl font-bold text-slate-100 mt-1">{data.unpaidCount}</p>
                <p className="text-indigo-400 text-sm mt-2">{t('goToPayments')}</p>
              </Link>
            </div>
            <div className="mt-6">
              <AttendanceCard count={data.todayAttendance} label={t('attendance')} />
            </div>
          </div>
        </div>
    );
  }

  const paymentDueBanner = (() => {
    if (!centerBilling?.payment_due_date || centerBilling.billing_status === 'paid') return null;
    const dueDate = new Date(centerBilling.payment_due_date);
    const now = new Date();
    const diffMs = dueDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
    const payNowUrl = `https://wa.me/201220601410?text=${encodeURIComponent(`أريد سداد اشتراك CenterHQ - اسم السنتر: ${centerBilling.name || ''}`)}`;
    if (diffDays > 0 && diffDays <= 5) {
      return (
        <div className="mb-6 p-4 bg-amber-900/30 border border-amber-600 rounded-xl flex flex-wrap items-center justify-between gap-4">
          <span className="text-amber-200 font-medium">
            {t('paymentDue', { days: diffDays, defaultValue: `Payment due in ${diffDays} days` })}
          </span>
          <a href={payNowUrl} target="_blank" rel="noopener noreferrer" className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg">
            {t('payNow', { defaultValue: 'Pay Now' })}
          </a>
        </div>
      );
    }
    if (diffDays <= 0) {
      return (
        <div className="mb-6 p-4 bg-red-900/30 border border-red-600 rounded-xl flex flex-wrap items-center justify-between gap-4">
          <span className="text-red-200 font-medium">
            {t('paymentOverdue', { hours: Math.abs(diffHours), defaultValue: `Payment overdue! Account will be suspended in ${Math.abs(diffHours)} hours` })}
          </span>
          <a href={payNowUrl} target="_blank" rel="noopener noreferrer" className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg">
            {t('payNow', { defaultValue: 'Pay Now' })}
          </a>
        </div>
      );
    }
    return null;
  })();

  return (
    <div className="min-h-screen">
        <div className="max-w-7xl mx-auto p-6">
          {paymentDueBanner}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-slate-100">
              {t('title')}
            </h1>
            <button
              onClick={handleExport}
              disabled={isExporting || isLoading}
              className="px-4 py-2 text-sm font-medium border border-indigo-500 text-indigo-400 rounded-lg hover:bg-indigo-500/10 disabled:opacity-50"
            >
              {isExporting ? t('exporting') : t('exportData')}
            </button>
          </div>

          {isLoading ? (
            <div className="text-center py-16">
              <svg className="animate-spin h-8 w-8 text-indigo-400 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Top Stats Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <AttendanceCard count={data.todayAttendance} label={t('attendance')} />
                <div className="glass p-6">
                  <p className="text-sm text-slate-400">{t('totalStudents')}</p>
                  <p className="text-3xl font-bold text-slate-100 mt-1" style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}>
                    {locale === 'ar' ? toAr(data.totalStudents) : data.totalStudents}
                  </p>
                </div>
                {canViewRevenue && (
                  <div className="glass p-6">
                    <p className="text-sm text-slate-400">{t('collectedToday')}</p>
                    <p className="text-3xl font-bold text-green-400 mt-1" style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}>
                      {locale === 'ar' ? toAr(Math.round(data.todayRevenue)) : Math.round(data.todayRevenue).toLocaleString()} <span className="text-lg">{t('currency')}</span>
                    </p>
                  </div>
                )}
                {canViewRevenue && (
                  <div className="glass p-6">
                    <p className="text-sm text-slate-400">{t('totalPending')}</p>
                    <p className="text-3xl font-bold text-orange-400 mt-1" style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}>
                      {locale === 'ar' ? toAr(Math.round(data.totalPending)) : data.totalPending.toLocaleString()} <span className="text-lg">{t('currency')}</span>
                    </p>
                  </div>
                )}
              </div>

              {/* Secondary KPIs Row */}
              {canViewRevenue && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="glass p-4">
                    <p className="text-xs text-slate-400">{t('weeklyTrend')}</p>
                    <p className={`text-xl font-bold mt-1 ${data.weeklyTrendPct >= 0 ? 'text-green-400' : 'text-red-400'}`} style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}>
                      {data.weeklyTrendPct >= 0 ? '↑' : '↓'}{locale === 'ar' ? toAr(Math.abs(data.weeklyTrendPct)) : Math.abs(data.weeklyTrendPct)}{t('pct')}
                    </p>
                  </div>
                  <div className="glass p-4">
                    <p className="text-xs text-slate-400">{t('collectionRate')}</p>
                    <p className="text-xl font-bold text-slate-100 mt-1" style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}>
                      {locale === 'ar' ? toAr(data.collectionRatePct) : data.collectionRatePct}{t('pct')}
                    </p>
                  </div>
                  <div className="glass p-4">
                    <p className="text-xs text-slate-400">{t('newStudents')}</p>
                    <p className="text-xl font-bold text-slate-100 mt-1" style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}>
                      {locale === 'ar' ? toAr(data.newStudentsCount) : data.newStudentsCount}
                    </p>
                  </div>
                  <div className="glass p-4">
                    <p className="text-xs text-slate-400">{t('atRisk')}</p>
                    <p className="text-xl font-bold text-red-400 mt-1" style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}>
                      {locale === 'ar' ? toAr(data.atRiskCount) : data.atRiskCount}
                    </p>
                  </div>
                </div>
              )}

              {/* Monthly Revenue Section */}
              {canViewRevenue && (
                <div className="glass p-6">
                  <h2 className="text-lg font-semibold text-slate-100 mb-4">
                    {t('monthlyRevenue')} — {new Date().toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US', { month: 'long', year: 'numeric' })}
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="p-4 bg-slate-800/50 rounded-lg">
                      <p className="text-sm text-slate-400">{t('totalRevenue')}</p>
                      <p className="text-xl font-bold text-slate-100 mt-1">{data.monthTotal} {t('currency')}</p>
                    </div>
                    <div className="p-4 bg-green-900/20 rounded-lg">
                      <p className="text-sm text-slate-400">{t('confirmedRevenue')}</p>
                      <p className="text-xl font-bold text-green-400 mt-1">{data.monthConfirmed} {t('currency')}</p>
                    </div>
                    <div className="p-4 bg-red-900/20 rounded-lg">
                      <p className="text-sm text-slate-400">{t('pendingRevenue')}</p>
                      <p className="text-xl font-bold text-red-400 mt-1">{data.monthPending} {t('currency')}</p>
                    </div>
                    {data.monthLate > 0 && (
                      <div className="p-4 bg-amber-900/20 rounded-lg sm:col-span-3">
                        <p className="text-sm text-slate-400">{t('lateRevenue')}</p>
                        <p className="text-xl font-bold text-amber-400 mt-1">{data.monthLate} {t('currency')}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Charts Row */}
              {canViewRevenue && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="glass p-6">
                    <h2 className="text-lg font-semibold text-slate-100 mb-4">
                      {t('paid')} / {t('unpaid')}
                    </h2>
                    <PaymentDonut paid={data.paidCount} unpaid={data.unpaidCount} pending={data.pendingCount} />
                  </div>
                  <div className="glass p-6">
                    <h2 className="text-lg font-semibold text-slate-100 mb-4">
                      {t('paymentBreakdown')}
                    </h2>
                    <RevenueBar data={data.revenueByMethod} />
                  </div>
                </div>
              )}

              {/* Trend Chart */}
                <div className="glass p-6">
                <h2 className="text-lg font-semibold text-slate-100 mb-4">
                  {t('trend')}
                </h2>
                <AttendanceTrend data={data.trendData} />
              </div>

              {/* Inactive Students Section */}
                <div className="glass p-6">
                <h2 className="text-lg font-semibold text-slate-100 mb-4">
                  {t('inactiveStudents')}
                </h2>
                <InactiveList
                  students={data.inactiveStudents}
                  period={inactivePeriod}
                  onPeriodChange={setInactivePeriod}
                />
              </div>
            </div>
          )}
        </div>
      </div>
  );
}
