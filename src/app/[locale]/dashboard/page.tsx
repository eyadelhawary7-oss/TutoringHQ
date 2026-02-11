'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import Navbar from '@/components/Navbar';
import AttendanceCard from '@/components/dashboard/AttendanceCard';
import PaymentDonut from '@/components/dashboard/PaymentDonut';
import RevenueBar from '@/components/dashboard/RevenueBar';
import AttendanceTrend from '@/components/dashboard/AttendanceTrend';
import UnpaidList from '@/components/dashboard/UnpaidList';

interface DashboardData {
  todayAttendance: number;
  totalStudents: number;
  paidCount: number;
  unpaidCount: number;
  todayRevenue: number;
  revenueByMethod: { method: string; amount: number }[];
  trendData: { date: string; count: number }[];
  unpaidStudents: { id: string; name: string; subject_name: string; monthly_fee: number }[];
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');

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

  const startOfToday = () => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  };

  const loadDashboard = useCallback(async (cId: string) => {
    try {
      // Today's attendance count
      const { count: attendanceCount } = await supabase
        .from('attendance_scans')
        .select('*', { count: 'exact', head: true })
        .eq('center_id', cId)
        .gte('scanned_at', startOfToday());

      // Student payment stats
      const { data: students } = await supabase
        .from('students')
        .select('id, name, subject_name, monthly_fee, payment_status')
        .eq('center_id', cId);

      const paidCount = students?.filter(s => s.payment_status === 'paid').length || 0;
      const unpaidCount = students?.filter(s => s.payment_status === 'unpaid').length || 0;
      const unpaidStudents = students?.filter(s => s.payment_status === 'unpaid') || [];

      // Today's revenue
      const { data: todayPayments } = await supabase
        .from('payments')
        .select('amount, payment_method')
        .eq('center_id', cId)
        .gte('payment_date', startOfToday());

      const todayRevenue = todayPayments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0;

      // Revenue by method
      const methodMap = new Map<string, number>();
      todayPayments?.forEach(p => {
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

        const { count } = await supabase
          .from('attendance_scans')
          .select('*', { count: 'exact', head: true })
          .eq('center_id', cId)
          .gte('scanned_at', dayStart.toISOString())
          .lte('scanned_at', dayEnd.toISOString());

        trendData.push({
          date: `${day.getDate()}/${day.getMonth() + 1}`,
          count: count || 0,
        });
      }

      setData({
        todayAttendance: attendanceCount || 0,
        totalStudents: students?.length || 0,
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: userRecord } = await supabase
        .from('users')
        .select('center_id')
        .eq('id', user.id)
        .single();

      if (userRecord?.center_id) {
        setCenterId(userRecord.center_id);
        await loadDashboard(userRecord.center_id);
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

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
            {t('title')}
          </h1>

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
                    {data.unpaidStudents.reduce((s, st) => s + (st.monthly_fee || 0), 0)} <span className="text-lg">{t('currency')}</span>
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
