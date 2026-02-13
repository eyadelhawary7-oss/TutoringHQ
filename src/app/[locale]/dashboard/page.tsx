'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbCount } from '@/lib/db-proxy';
import { exportDashboardToExcel } from '@/lib/excel-export';
import { useUser } from '@/contexts/UserContext';
import { Link } from '@/i18n/routing';
import Navbar from '@/components/Navbar';
import AttendanceCard from '@/components/dashboard/AttendanceCard';
import PaymentDonut from '@/components/dashboard/PaymentDonut';
import RevenueBar from '@/components/dashboard/RevenueBar';
import AttendanceTrend from '@/components/dashboard/AttendanceTrend';
import UnpaidList from '@/components/dashboard/UnpaidList';

function isOwnerOrAdmin(role?: string): boolean {
  return role === 'owner' || role === 'admin';
}

interface DashboardData {
  todayAttendance: number;
  totalStudents: number;
  paidCount: number;
  unpaidCount: number;
  todayRevenue: number;
  revenueByMethod: { method: string; amount: number }[];
  trendData: { date: string; count: number }[];
  unpaidStudents: { id: string; name: string; subject_name: string; fee: number }[];
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const { user, hasPermission } = useUser();
  const isOwnerOrAdminRole = isOwnerOrAdmin(user?.role);

  const [data, setData] = useState<DashboardData>({
    todayAttendance: 0,
    totalStudents: 0,
    paidCount: 0,
    unpaidCount: 0,
    todayRevenue: 0,
    revenueByMethod: [],
    trendData: [],
    unpaidStudents: [],
  });
  const [centerId, setCenterId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const startOfToday = () => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  };

  const loadDashboard = useCallback(async (cId: string) => {
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
        select: 'id, name, subject_name, fee, payment_status',
        filters: [{ column: 'center_id', op: 'eq', value: cId }],
      });
      const students = (studentsRaw || []) as { id: string; name: string; subject_name: string; fee: number; payment_status: string }[];

      const paidCount = students.filter(s => s.payment_status === 'paid').length;
      const unpaidCount = students.filter(s => s.payment_status === 'unpaid').length;
      const unpaidStudents = students.filter(s => s.payment_status === 'unpaid');

      // Today's revenue
      const { data: todayPayments } = await dbSelect({
        table: 'payments',
        select: 'amount, payment_method',
        filters: [
          { column: 'center_id', op: 'eq', value: cId },
          { column: 'payment_date', op: 'gte', value: startOfToday() },
        ],
      });

      const payments = (todayPayments || []) as { amount: number; payment_method: string }[];
      const todayRevenue = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

      // Revenue by method
      const methodMap = new Map<string, number>();
      payments.forEach(p => {
        const current = methodMap.get(p.payment_method) || 0;
        methodMap.set(p.payment_method, current + (p.amount || 0));
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

      setData({
        todayAttendance: attendanceCount || 0,
        totalStudents: students.length,
        paidCount,
        unpaidCount,
        todayRevenue,
        revenueByMethod,
        trendData,
        unpaidStudents: unpaidStudents.slice(0, 20),
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
        await loadDashboard(meData.user.center_id);
      }
    };
    init();
  }, [loadDashboard]);

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
          select: 'id, name, phone, parent_phone, subject_name, payment_status, qr_code',
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
          select: 'student_id, amount, payment_method, payment_date, created_by',
          filters: [{ column: 'center_id', op: 'eq', value: centerId }],
          order: { column: 'payment_date', ascending: false },
          limit: 500,
        }),
      ]);
      const students = (studentsRes.data || []) as { id: string; name: string; phone?: string; parent_phone?: string; subject_name?: string; payment_status: string; qr_code?: string }[];
      const attendanceRaw = (attendanceRes.data || []) as { student_id: string; scanned_at: string }[];
      const paymentsRaw = (paymentsRes.data || []) as { student_id: string; amount: number; payment_method: string; payment_date: string; created_by: string }[];
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
          method: p.payment_method,
          paid_at: p.payment_date,
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
      <>
        <Navbar />
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
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
                className="block p-8 bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 hover:border-indigo-500 transition-colors"
              >
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('unpaidCount')}</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{data.unpaidCount}</p>
                <p className="text-indigo-600 dark:text-indigo-400 text-sm mt-2">{t('goToPayments')}</p>
              </Link>
            </div>
            <div className="mt-6">
              <AttendanceCard count={data.todayAttendance} label={t('attendance')} />
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {t('title')}
            </h1>
            <button
              onClick={handleExport}
              disabled={isExporting || isLoading}
              className="px-4 py-2 text-sm font-medium border border-indigo-600 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/50 disabled:opacity-50"
            >
              {isExporting ? t('exporting') : t('exportData')}
            </button>
          </div>

          {isLoading ? (
            <div className="text-center py-16">
              <svg className="animate-spin h-8 w-8 text-indigo-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Top Stats Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <AttendanceCard count={data.todayAttendance} label={t('attendance')} />
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('totalStudents')}</p>
                  <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{data.totalStudents}</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('collectedToday')}</p>
                  <p className="text-3xl font-bold text-green-600 dark:text-green-400 mt-1">
                    {data.todayRevenue} <span className="text-lg">{t('currency')}</span>
                  </p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('pendingAmount')}</p>
                  <p className="text-3xl font-bold text-red-600 dark:text-red-400 mt-1">
                    {data.unpaidStudents.reduce((s, st) => s + (st.fee || 0), 0)} <span className="text-lg">{t('currency')}</span>
                  </p>
                </div>
              </div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
                  <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
                    {t('paid')} / {t('unpaid')}
                  </h2>
                  <PaymentDonut paid={data.paidCount} unpaid={data.unpaidCount} />
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
                  <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
                    {t('paymentBreakdown')}
                  </h2>
                  <RevenueBar data={data.revenueByMethod} />
                </div>
              </div>

              {/* Trend Chart */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
                <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
                  {t('trend')}
                </h2>
                <AttendanceTrend data={data.trendData} />
              </div>

              {/* Unpaid Students List */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
                <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
                  {t('unpaidStudents')}
                </h2>
                <UnpaidList students={data.unpaidStudents} />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
