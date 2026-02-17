'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbUpdate } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { exportPaymentsToExcel } from '@/lib/excel-export';
import { hasPlanFeature } from '@/lib/plans';

interface PaymentRecord {
  id: string;
  student_id: string;
  center_id: string;
  amount: number;
  method: string;
  paid_at: string;
  status: string;
  confirmed?: boolean;
  confirmed_by?: string | null;
  confirmed_at?: string | null;
  confirmed_by_name?: string | null;
  recorded_by?: string | null;
  group_id?: string | null;
  student_name?: string;
  student_number?: string;
  group_name?: string;
}

const METHOD_KEYS: Record<string, string> = {
  cash: 'cash',
  instapay: 'instapay',
  vodafone_cash: 'vodacash',
  vodacash: 'vodacash',
  orange: 'orange',
  fawry: 'fawry',
  bank_transfer: 'bank',
  bank: 'bank',
  late_entry: 'lateEntry',
};

type StatusFilter = 'all' | 'confirmed' | 'pending';

export default function PaymentsPage() {
  const t = useTranslations('payments');
  const tCommon = useTranslations('common');
  const tSettings = useTranslations('settings');
  const locale = useLocale();
  const { user, hasPermission } = useUser();
  const isRTL = locale === 'ar';
  const canConfirmPayments = user?.role === 'owner' || user?.role === 'admin' || hasPermission('can_record_payments');

  const [records, setRecords] = useState<PaymentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'pending'>('all');
  const [viewMode, setViewMode] = useState<'transactionLog' | 'studentSummary'>('transactionLog');
  const [studentSummary, setStudentSummary] = useState<{
    student_id: string;
    student_name: string;
    student_number: string;
    total_lessons: number;
    paid_lessons: number;
    balance_due: number;
  }[]>([]);
  const [sortOrder, setSortOrder] = useState<'default' | 'high' | 'low'>('high');
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const [showExportUpgradeModal, setShowExportUpgradeModal] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const DEBUG = typeof window !== 'undefined' && process.env.NODE_ENV === 'development';

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const loadDataInner = useCallback(async () => {
    setLoadError(null);
    const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);

      const meUrl = '/api/me';
      if (DEBUG) {
        console.log('[payments] Fetching /api/me', { url: meUrl, method: 'GET', hasToken: !!session.access_token });
      }
      let meRes: Response;
      try {
        meRes = await fetch(meUrl, { headers: { 'Authorization': `Bearer ${session.access_token}` } });
      } catch (fetchErr) {
        if (DEBUG) {
          console.error('[payments] /api/me fetch failed:', fetchErr);
          console.error('[payments] Stack:', (fetchErr as Error)?.stack);
        }
        throw fetchErr;
      }
      if (DEBUG) {
        console.log('[payments] /api/me response:', { status: meRes.status, statusText: meRes.statusText, ok: meRes.ok });
      }
      const meData = await meRes.json();
      if (DEBUG) {
        console.log('[payments] /api/me body:', { hasUser: !!meData?.user, centerId: meData?.user?.center_id });
      }
      if (!meData?.user?.center_id) return;
      setCenterId(meData.user.center_id);
      const cid = meData.user.center_id;

      if (DEBUG) {
        console.log('[payments] Fetching payments for center:', cid);
      }
      const { data: paymentsData, error: payErr } = await dbSelect({
      table: 'payments',
      select: 'id, student_id, center_id, amount, method, recorded_by, paid_at, status, confirmed, confirmed_by, confirmed_at, group_id, students(name, student_number, phone), student_groups(name)',
      filters: [{ column: 'center_id', op: 'eq', value: cid }],
      order: { column: 'paid_at', ascending: false },
    });

      if (DEBUG) {
        const count = Array.isArray(paymentsData) ? paymentsData.length : 0;
        console.log('[payments] Payments fetched:', { count, error: payErr?.message ?? null });
      }

    type PaymentRow = PaymentRecord & {
      student_id: string;
      group_id?: string | null;
      students?: { name?: string; student_number?: string; phone?: string } | null;
      student_groups?: { name?: string } | null;
    };
    const payments = (paymentsData || []) as PaymentRow[];
    const { data: scansDataPre } = await dbSelect({
      table: 'attendance_scans',
      select: 'student_id',
      filters: [{ column: 'center_id', op: 'eq', value: cid }],
    });
    const scanStudentIds = [...new Set(((scansDataPre || []) as { student_id: string }[]).map(s => s.student_id))];
    const studentIds = [...new Set([...payments.map(p => p.student_id), ...scanStudentIds])];
    const groupIds = [...new Set(payments.map(p => p.group_id).filter(Boolean))] as string[];

    let studentMap: Record<string, { name: string; student_number: string }> = {};
    let groupMap: Record<string, string> = {};
    if (studentIds.length > 0) {
      const { data: studentsData } = await dbSelect({
        table: 'students',
        select: 'id, name, student_number',
        filters: [{ column: 'id', op: 'in', value: studentIds }],
      });
      const students = (studentsData || []) as { id: string; name: string; student_number?: string }[];
      studentMap = Object.fromEntries(students.map(s => [s.id, { name: s.name || '', student_number: s.student_number || '—' }]));
    }
    if (groupIds.length > 0) {
      const { data: groupsData } = await dbSelect({
        table: 'student_groups',
        select: 'id, name',
        filters: [{ column: 'id', op: 'in', value: groupIds }],
      });
      const groups = (groupsData || []) as { id: string; name: string }[];
      groupMap = Object.fromEntries(groups.map(g => [g.id, g.name || '']));
    }

    const confirmedByIds = [...new Set(payments.map(p => p.confirmed_by).filter(Boolean))] as string[];
    let confirmedByMap: Record<string, string> = {};
    if (confirmedByIds.length > 0) {
      const { data: usersData } = await dbSelect({
        table: 'users',
        select: 'id, name',
        filters: [{ column: 'id', op: 'in', value: confirmedByIds }],
      });
      const users = (usersData || []) as { id: string; name: string | null }[];
      confirmedByMap = Object.fromEntries(users.map(u => [u.id, u.name || '—']));
    }

    setRecords(payments.map(p => ({
      ...p,
      student_name: p.students?.name ?? studentMap[p.student_id]?.name ?? '—',
      student_number: p.students?.student_number ?? studentMap[p.student_id]?.student_number ?? '—',
      group_name: p.student_groups?.name ?? (p.group_id ? (groupMap[p.group_id] ?? '—') : '—'),
      confirmed_by_name: p.confirmed_by ? (confirmedByMap[p.confirmed_by] ?? '—') : null,
    })));

    // Load student summary (attendance + payment aggregates)
    const scans = (scansDataPre || []) as { student_id: string }[];
    const totalLessonsByStudent: Record<string, number> = {};
    for (const s of scans) {
      totalLessonsByStudent[s.student_id] = (totalLessonsByStudent[s.student_id] ?? 0) + 1;
    }

    const paidCount: Record<string, number> = {};
    const balanceDueByStudent: Record<string, number> = {};
    for (const p of payments) {
      const amt = parseFloat(String(p.amount ?? 0));
      if (p.confirmed === true) {
        paidCount[p.student_id] = (paidCount[p.student_id] ?? 0) + 1;
      } else if (p.confirmed === false && p.status !== 'late') {
        balanceDueByStudent[p.student_id] = (balanceDueByStudent[p.student_id] ?? 0) + amt;
      }
    }

    const allStudentIds = [...new Set([...Object.keys(totalLessonsByStudent), ...Object.keys(paidCount), ...Object.keys(balanceDueByStudent)])];
    const summaryRows = allStudentIds.map(sid => ({
      student_id: sid,
      student_name: studentMap[sid]?.name ?? '—',
      student_number: studentMap[sid]?.student_number ?? '—',
      total_lessons: totalLessonsByStudent[sid] ?? 0,
      paid_lessons: paidCount[sid] ?? 0,
      balance_due: balanceDueByStudent[sid] ?? 0,
    })).filter(r => r.total_lessons > 0 || r.paid_lessons > 0 || r.balance_due > 0)
      .sort((a, b) => (b.balance_due - a.balance_due) || b.total_lessons - a.total_lessons);
    setStudentSummary(summaryRows);
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setIsOffline(true);
        setLoadError(t('offline', { defaultValue: 'You appear to be offline. Please check your connection.' }));
        setIsLoading(false);
        return;
      }
      setIsOffline(false);
      setLoadError(null);
      const maxRetries = 3;
      const delays = [1000, 2000, 4000];
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            if (DEBUG) console.log(`[payments] Retry ${attempt}/${maxRetries}, delay ${delays[attempt - 1]}ms`);
            setLoadError(t('retrying', { defaultValue: `Retrying... (${attempt}/${maxRetries})` }));
            await sleep(delays[attempt - 1]);
            setLoadError(null);
          }
          await loadDataInner();
          return;
        } catch (err) {
          if (DEBUG) {
            console.error('[payments] Attempt', attempt + 1, 'failed:', err);
            console.error('[payments] Stack:', (err as Error)?.stack);
          }
          if (attempt === maxRetries - 1) {
            setLoadError(err instanceof Error ? err.message : String(err));
          }
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [loadDataInner, DEBUG, t]);

  useEffect(() => {
    const onOnline = () => { setIsOffline(false); loadData(); };
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [loadData]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const onFocus = () => loadData();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadData]);

  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      if (activeTab === 'pending') return r.confirmed === false || r.status === 'pending';
      if (statusFilter !== 'all') {
        if (statusFilter === 'confirmed' && (r.confirmed === false || r.status === 'pending')) return false;
        if (statusFilter === 'pending' && (r.confirmed !== false && r.status === 'confirmed')) return false;
      }
      if (methodFilter !== 'all' && r.method !== methodFilter) return false;
      return true;
    });
  }, [records, statusFilter, methodFilter, activeTab]);

  const sortedStudents = useMemo(() => {
    if (!studentSummary.length) return [];
    if (sortOrder === 'high') return [...studentSummary].sort((a, b) => (b.balance_due ?? 0) - (a.balance_due ?? 0));
    if (sortOrder === 'low') return [...studentSummary].sort((a, b) => (a.balance_due ?? 0) - (b.balance_due ?? 0));
    return studentSummary;
  }, [studentSummary, sortOrder]);

  const groupedByDate = useMemo(() => {
    const groups: Record<string, PaymentRecord[]> = {};
    for (const r of filteredRecords) {
      const d = r.paid_at ? r.paid_at.split('T')[0] : '';
      if (!groups[d]) groups[d] = [];
      groups[d].push(r);
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [filteredRecords]);

  const handleConfirm = async (paymentId: string) => {
    if (!canConfirmPayments) return;
    setConfirmingId(paymentId);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await dbUpdate({
        table: 'payments',
        data: {
          confirmed: true,
          confirmed_by: user?.id ?? userId,
          confirmed_at: new Date().toISOString(),
          status: 'confirmed',
        },
        filters: [{ column: 'id', op: 'eq', value: paymentId }],
      });
      await loadData();
      setSuccessMessage(t('confirmed', { count: 1 }));
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err) {
      console.error('Confirm error:', err);
    } finally {
      setConfirmingId(null);
    }
  };

  const canExportExcel = hasPlanFeature(user?.center?.plan, 'excel_export');
  const tDashboard = useTranslations('dashboard');
  const handleExport = () => {
    if (!canExportExcel) {
      setShowExportUpgradeModal(true);
      return;
    }
    exportPaymentsToExcel(filteredRecords);
  };

  const formatMethod = (method: string) => {
    const key = METHOD_KEYS[method] || method;
    return t(String(key) as Parameters<typeof t>[0]) || method;
  };

  const methods = useMemo(() => {
    const set = new Set(records.map(r => r.method).filter(Boolean));
    return Array.from(set);
  }, [records]);

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-text-primary">{t('title')}</h1>
            <div className="flex items-center gap-3">
              <div className="flex bg-bg-primary rounded-lg shadow p-1">
                <button
                  onClick={() => setViewMode('transactionLog')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    viewMode === 'transactionLog' ? 'bg-indigo-600 text-white' : 'text-text-secondary hover:bg-bg-secondary'
                  }`}
                >
                  {t('transactionLog')}
                </button>
                <button
                  onClick={() => setViewMode('studentSummary')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    viewMode === 'studentSummary' ? 'bg-indigo-600 text-white' : 'text-text-secondary hover:bg-bg-secondary'
                  }`}
                >
                  {t('studentSummary')}
                </button>
              </div>
              {viewMode === 'transactionLog' && (
                <>
                  <button
                    onClick={handleExport}
                    className="px-4 py-2 text-sm font-medium border border-green-600 text-green-600 dark:text-green-400 rounded-lg hover:bg-green-50 dark:hover:bg-green-950"
                  >
                    {t('exportExcel')}
                  </button>
                  {showExportUpgradeModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowExportUpgradeModal(false)}>
                      <div className="bg-bg-primary rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold text-text-primary mb-2">{tSettings('upgradeToUnlockFeature')}</h3>
                        <p className="text-sm text-text-secondary mb-4">{tDashboard('exportExcelUpgrade')}</p>
                        <a href="/settings/billing" className="inline-block px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg">
                          {tDashboard('upgradePlan')}
                        </a>
                        <button onClick={() => setShowExportUpgradeModal(false)} className="ml-2 px-4 py-2 bg-bg-tertiary rounded-lg text-sm">
                          {tCommon('cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {successMessage && (
            <div className="mb-4 p-3 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-sm text-center">
              {successMessage}
            </div>
          )}

          {(loadError || isOffline) && (
            <div className="mb-4 p-4 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm">
              <p className="font-medium">{loadError || t('offline', { defaultValue: 'Offline' })}</p>
              <button
                onClick={() => loadData()}
                className="mt-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg"
              >
                {t('retry', { defaultValue: 'Retry' })}
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-3 mb-6">
            <div className="flex bg-bg-primary rounded-lg shadow p-1">
              <button
                onClick={() => setActiveTab('all')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'all' ? 'bg-indigo-600 text-white' : 'text-text-secondary hover:bg-bg-secondary'
                }`}
              >
                {t('filterAll')}
              </button>
              <button
                onClick={() => setActiveTab('pending')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'pending' ? 'bg-indigo-600 text-white' : 'text-text-secondary hover:bg-bg-secondary'
                }`}
              >
                {t('filterPending')}
              </button>
            </div>
            {activeTab === 'all' && (
              <>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                  className="px-3 py-2 bg-bg-primary border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-text-primary shadow"
                >
                  <option value="all">{t('filterAll')}</option>
                  <option value="confirmed">{t('filterPaid')}</option>
                  <option value="pending">{t('filterPending')}</option>
                </select>
                <select
                  value={methodFilter}
                  onChange={e => setMethodFilter(e.target.value)}
                  className="px-3 py-2 bg-bg-primary border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-text-primary shadow"
                >
                  <option value="all">{t('paymentMethod')} — {t('filterAll')}</option>
                  {methods.map(m => (
                    <option key={m} value={m}>{formatMethod(m)}</option>
                  ))}
                </select>
              </>
            )}
          </div>

          {isLoading ? (
            <div className="text-center py-16">
              <svg className="animate-spin h-8 w-8 text-indigo-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : viewMode === 'studentSummary' ? (
            <div className="bg-bg-primary rounded-xl shadow overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex justify-end">
                <button
                  onClick={() => setSortOrder(prev => prev === 'high' ? 'low' : 'high')}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-bg-secondary text-text-primary transition-colors"
                >
                  {sortOrder === 'high'
                    ? t('sortHighToLow', { defaultValue: 'Balance: High → Low' })
                    : t('sortLowToHigh', { defaultValue: 'Balance: Low → High' })}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-text-secondary">{t('studentName')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-text-secondary">{t('studentId')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-text-secondary">{t('totalLessons')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-text-secondary">{t('paidLessons')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-text-secondary">{t('balanceDue')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-text-secondary">{tCommon('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedStudents.map((row) => (
                      <React.Fragment key={row.student_id}>
                        <tr className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-bg-secondary/30">
                          <td className="px-4 py-3 font-medium text-text-primary">{row.student_name}</td>
                          <td className="px-4 py-3 font-mono italic text-text-secondary" dir="ltr">{row.student_number}</td>
                          <td className="px-4 py-3 text-text-secondary">{row.total_lessons}</td>
                          <td className="px-4 py-3 text-text-secondary">{row.paid_lessons}</td>
                          <td className="px-4 py-3">
                            {row.balance_due > 0 ? (
                              <span className="font-mono italic font-medium text-red-600 dark:text-red-400">
                                {row.balance_due.toLocaleString('ar-EG')} EGP
                              </span>
                            ) : (
                              <span className="font-mono italic text-text-secondary">0 EGP</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => setExpandedStudentId(expandedStudentId === row.student_id ? null : row.student_id)}
                              className="text-indigo-600 dark:text-indigo-400 hover:underline text-sm"
                            >
                              {t('viewHistory')}
                            </button>
                          </td>
                        </tr>
                        {expandedStudentId === row.student_id && (
                          <tr key={`${row.student_id}-history`} className="bg-bg-secondary">
                            <td colSpan={6} className="px-4 py-3">
                              <div className="text-xs space-y-1 max-h-40 overflow-y-auto">
                                {records.filter(r => r.student_id === row.student_id).map(r => (
                                  <div key={r.id} className="flex flex-wrap justify-between items-center gap-x-2 py-1 border-b border-gray-100 dark:border-gray-700/30 last:border-0">
                                    <span>{r.paid_at ? new Date(r.paid_at).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                                    <span className="font-mono italic">{r.amount} EGP</span>
                                    <span>{formatMethod(r.method)}</span>
                                    <span className={`italic ${r.status === 'late' ? 'text-amber-600 font-medium' : ''}`}>{r.status === 'late' ? t('lateEntry') : r.confirmed !== false && r.status !== 'pending' ? t('filterPaid') : t('filterPending')}</span>
                                    {r.confirmed_by_name && r.confirmed_at && (
                                      <span className="text-text-tertiary text-[10px] w-full mt-0.5" title={new Date(r.confirmed_at).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })}>
                                        {t('confirmedBy', { defaultValue: 'Confirmed by' })}: {r.confirmed_by_name}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
                {sortedStudents.length === 0 && (
                  <p className="p-8 text-center text-text-secondary">{t('noPaymentsYet')}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {groupedByDate.map(([date, dayRecords]) => {
                const dayTotal = dayRecords.reduce((s, r) => s + r.amount, 0);
                return (
                  <div key={date} className="bg-bg-primary rounded-xl shadow overflow-hidden">
                    <div className="px-4 py-2 bg-bg-secondary border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                      <span className="font-medium text-text-primary">
                        {new Date(date).toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                      </span>
                      <span className="text-sm font-mono italic font-semibold text-indigo-600 dark:text-indigo-400">
                        {dayTotal.toLocaleString('ar-EG')} EGP
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-gray-700">
                            <th className="px-4 py-3 text-start text-sm font-medium italic text-text-secondary">{t('date')}</th>
                            <th className="px-4 py-3 text-start text-sm font-medium italic text-text-secondary">{t('studentName')}</th>
                            <th className="px-4 py-3 text-start text-sm font-medium italic text-text-secondary">{t('studentId')}</th>
                            <th className="px-4 py-3 text-start text-sm font-medium italic text-text-secondary">{t('amount')}</th>
                            <th className="px-4 py-3 text-start text-sm font-medium italic text-text-secondary">{t('paymentMethod')}</th>
                            <th className="px-4 py-3 text-start text-sm font-medium italic text-text-secondary">{t('status')}</th>
                            <th className="px-4 py-3 text-start text-sm font-medium italic text-text-secondary">{t('confirmedBy', { defaultValue: 'Confirmed by' })}</th>
                            <th className="px-4 py-3 text-start text-sm font-medium italic text-text-secondary">{t('group')}</th>
                            {canConfirmPayments && <th className="px-4 py-3 text-start text-sm font-medium italic text-text-secondary">{tCommon('actions')}</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {dayRecords.map(r => (
                            <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-bg-secondary/30">
                              <td className="px-4 py-3 text-text-secondary" dir="ltr">
                                {r.paid_at ? new Date(r.paid_at).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                              </td>
                              <td className="px-4 py-3 font-medium text-text-primary">{r.student_name}</td>
                              <td className="px-4 py-3 font-mono italic text-text-secondary" dir="ltr">{r.student_number ?? '—'}</td>
                              <td className="px-4 py-3 font-mono italic text-text-secondary">{r.amount} EGP</td>
                              <td className="px-4 py-3 text-text-secondary">{formatMethod(r.method)}</td>
                              <td className="px-4 py-3">
                                <span
                                  title={r.confirmed_by_name && r.confirmed_at
                                    ? `${t('confirmedBy', { defaultValue: 'Confirmed by' })}: ${r.confirmed_by_name} — ${new Date(r.confirmed_at).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                                    : undefined}
                                  className={`px-2 py-1 text-xs font-medium italic rounded-full ${
                                    r.confirmed !== false && r.status === 'confirmed'
                                      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                                      : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300'
                                  }`}
                                >
                                  {r.confirmed !== false && r.status === 'confirmed' ? t('confirmedStatus') : t('filterPending')}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-text-secondary text-xs">
                                {r.confirmed_by_name && r.confirmed_at ? (
                                  <span title={new Date(r.confirmed_at).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })}>
                                    {r.confirmed_by_name}
                                  </span>
                                ) : '—'}
                              </td>
                              <td className="px-4 py-3 text-text-secondary">{r.group_name ?? '—'}</td>
                              {canConfirmPayments && (
                                <td className="px-4 py-3">
                                  {(r.confirmed === false || r.status === 'pending') ? (
                                    <button
                                      onClick={() => handleConfirm(r.id)}
                                      disabled={confirmingId === r.id}
                                      className="px-3 py-1.5 text-sm font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-800 disabled:opacity-50"
                                    >
                                      ✓ {t('confirm')}
                                    </button>
                                  ) : null}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
              {groupedByDate.length === 0 && (
                <div className="text-center py-16 text-text-secondary">
                  {t('noPaymentsYet')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
  );
}
