'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbUpdate } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { exportPaymentsToExcel } from '@/lib/excel-export';
import Navbar from '@/components/Navbar';

interface PaymentRecord {
  id: string;
  student_id: string;
  center_id: string;
  amount: number;
  method: string;
  paid_at: string;
  status: string;
  confirmed?: boolean;
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
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
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

  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setUserId(session.user.id);

    const meRes = await fetch('/api/me', {
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    });
    const meData = await meRes.json();
    if (!meData?.user?.center_id) return;
    setCenterId(meData.user.center_id);
    const cid = meData.user.center_id;

    const { data: paymentsData, error: payErr } = await dbSelect({
      table: 'payments',
      select: 'id, student_id, center_id, amount, method, recorded_by, paid_at, status, confirmed, confirmed_by, confirmed_at, group_id, students(name, student_number, phone), student_groups(name)',
      filters: [{ column: 'center_id', op: 'eq', value: cid }],
      order: { column: 'paid_at', ascending: false },
    });

    console.log('Payments fetched:', paymentsData?.length, payErr);

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

    setRecords(payments.map(p => ({
      ...p,
      student_name: p.students?.name ?? studentMap[p.student_id]?.name ?? '—',
      student_number: p.students?.student_number ?? studentMap[p.student_id]?.student_number ?? '—',
      group_name: p.student_groups?.name ?? (p.group_id ? (groupMap[p.group_id] ?? '—') : '—'),
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
    setIsLoading(false);
  }, []);

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
      const payDate = r.paid_at ? r.paid_at.split('T')[0] : '';
      if (dateFrom && payDate < dateFrom) return false;
      if (dateTo && payDate > dateTo) return false;
      return true;
    });
  }, [records, statusFilter, methodFilter, dateFrom, dateTo, activeTab]);

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
    if (!userId || !canConfirmPayments) return;
    setConfirmingId(paymentId);
    try {
      await dbUpdate({
        table: 'payments',
        data: {
          confirmed: true,
          confirmed_by: userId,
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

  const handleExport = () => {
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
    <div dir={isRTL ? 'rtl' : 'ltr'}>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
            <div className="flex items-center gap-3">
              <div className="flex bg-white dark:bg-gray-800 rounded-lg shadow p-1">
                <button
                  onClick={() => setViewMode('transactionLog')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    viewMode === 'transactionLog' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {t('transactionLog')}
                </button>
                <button
                  onClick={() => setViewMode('studentSummary')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    viewMode === 'studentSummary' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {t('studentSummary')}
                </button>
              </div>
              {viewMode === 'transactionLog' && (
                <button
                  onClick={handleExport}
                  className="px-4 py-2 text-sm font-medium border border-green-600 text-green-600 dark:text-green-400 rounded-lg hover:bg-green-50 dark:hover:bg-green-950"
                >
                  {t('exportExcel')}
                </button>
              )}
            </div>
          </div>

          {successMessage && (
            <div className="mb-4 p-3 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-sm text-center">
              {successMessage}
            </div>
          )}

          <div className="flex flex-wrap gap-3 mb-6">
            <div className="flex bg-white dark:bg-gray-800 rounded-lg shadow p-1">
              <button
                onClick={() => setActiveTab('all')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'all' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {t('filterAll')}
              </button>
              <button
                onClick={() => setActiveTab('pending')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'pending' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
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
                  className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm shadow"
                >
                  <option value="all">{t('filterAll')}</option>
                  <option value="confirmed">{t('filterPaid')}</option>
                  <option value="pending">{t('filterPending')}</option>
                </select>
                <select
                  value={methodFilter}
                  onChange={e => setMethodFilter(e.target.value)}
                  className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm shadow"
                >
                  <option value="all">{t('paymentMethod')} — {t('filterAll')}</option>
                  {methods.map(m => (
                    <option key={m} value={m}>{formatMethod(m)}</option>
                  ))}
                </select>
              </>
            )}
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm shadow"
            />
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm shadow"
            />
          </div>

          {isLoading ? (
            <div className="text-center py-16">
              <svg className="animate-spin h-8 w-8 text-indigo-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : viewMode === 'studentSummary' ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex justify-end">
                <button
                  onClick={() => setSortOrder(prev => prev === 'high' ? 'low' : 'high')}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
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
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('studentName')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('studentId')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('totalLessons')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('paidLessons')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('balanceDue')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{tCommon('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedStudents.map((row) => (
                      <React.Fragment key={row.student_id}>
                        <tr className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{row.student_name}</td>
                          <td className="px-4 py-3 font-mono text-gray-600 dark:text-gray-400" dir="ltr">{row.student_number}</td>
                          <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{row.total_lessons}</td>
                          <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{row.paid_lessons}</td>
                          <td className="px-4 py-3">
                            {row.balance_due > 0 ? (
                              <span className="font-medium text-red-600 dark:text-red-400">
                                {row.balance_due.toLocaleString('ar-EG')} EGP
                              </span>
                            ) : (
                              <span className="text-gray-500 dark:text-gray-400">0 EGP</span>
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
                          <tr key={`${row.student_id}-history`} className="bg-gray-50 dark:bg-gray-700/30">
                            <td colSpan={6} className="px-4 py-3">
                              <div className="text-xs space-y-1 max-h-40 overflow-y-auto">
                                {records.filter(r => r.student_id === row.student_id).map(r => (
                                  <div key={r.id} className="flex justify-between py-1">
                                    <span>{r.paid_at ? new Date(r.paid_at).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                                    <span>{r.amount} EGP</span>
                                    <span>{formatMethod(r.method)}</span>
                                    <span className={r.status === 'late' ? 'text-amber-600 font-medium' : ''}>{r.status === 'late' ? t('lateEntry') : r.confirmed !== false && r.status !== 'pending' ? t('filterPaid') : t('filterPending')}</span>
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
                  <p className="p-8 text-center text-gray-500 dark:text-gray-400">{t('noPaymentsYet')}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {groupedByDate.map(([date, dayRecords]) => {
                const dayTotal = dayRecords.reduce((s, r) => s + r.amount, 0);
                return (
                  <div key={date} className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
                    <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {new Date(date).toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                      </span>
                      <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                        {dayTotal.toLocaleString('ar-EG')} EGP
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-gray-700">
                            <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('date')}</th>
                            <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('studentName')}</th>
                            <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('studentId')}</th>
                            <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('amount')}</th>
                            <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('paymentMethod')}</th>
                            <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('status')}</th>
                            <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('group')}</th>
                            {canConfirmPayments && <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{tCommon('actions')}</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {dayRecords.map(r => (
                            <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                              <td className="px-4 py-3 text-gray-600 dark:text-gray-400" dir="ltr">
                                {r.paid_at ? new Date(r.paid_at).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                              </td>
                              <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{r.student_name}</td>
                              <td className="px-4 py-3 font-mono text-gray-600 dark:text-gray-400" dir="ltr">{r.student_number ?? '—'}</td>
                              <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.amount} EGP</td>
                              <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{formatMethod(r.method)}</td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                  r.confirmed !== false && r.status === 'confirmed'
                                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                                    : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300'
                                }`}>
                                  {r.confirmed !== false && r.status === 'confirmed' ? t('confirmedStatus') : t('filterPending')}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.group_name ?? '—'}</td>
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
                <div className="text-center py-16 text-gray-500 dark:text-gray-400">
                  {t('noPaymentsYet')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
