'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
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
  payment_method: string;
  payment_date: string;
  status: string;
  confirmed?: boolean;
  created_by?: string | null;
  student_name?: string;
  subject?: string;
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
};

type StatusFilter = 'all' | 'confirmed' | 'pending';

export default function PaymentsPage() {
  const t = useTranslations('payments');
  const tCommon = useTranslations('common');
  const { user, hasPermission } = useUser();
  const canConfirmPayments = user?.role === 'owner' || user?.role === 'admin' || hasPermission('can_manage_payments');

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

    const { data: paymentsData } = await dbSelect({
      table: 'payments',
      select: 'id, student_id, center_id, amount, payment_method, payment_date, status, confirmed, created_by',
      filters: [{ column: 'center_id', op: 'eq', value: cid }],
      order: { column: 'payment_date', ascending: false },
    });

    const payments = (paymentsData || []) as (PaymentRecord & { student_id: string })[];
    const studentIds = [...new Set(payments.map(p => p.student_id))];

    let studentMap: Record<string, { name: string; subject: string }> = {};
    if (studentIds.length > 0) {
      const { data: studentsData } = await dbSelect({
        table: 'students',
        select: 'id, name, subject',
        filters: [{ column: 'id', op: 'in', value: studentIds }],
      });
      const students = (studentsData || []) as { id: string; name: string; subject: string }[];
      studentMap = Object.fromEntries(students.map(s => [s.id, { name: s.name || '', subject: s.subject || '' }]));
    }

    setRecords(payments.map(p => ({
      ...p,
      student_name: studentMap[p.student_id]?.name ?? '—',
      subject: studentMap[p.student_id]?.subject ?? '—',
    })));
    setIsLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      if (activeTab === 'pending' && (r.confirmed !== false && r.status === 'paid')) return false;
      if (activeTab === 'pending') return (r.confirmed === false || r.status === 'pending');
      if (statusFilter !== 'all') {
        if (statusFilter === 'confirmed' && (r.confirmed === false || r.status === 'pending')) return false;
        if (statusFilter === 'pending' && (r.confirmed !== false && r.status === 'paid')) return false;
      }
      if (methodFilter !== 'all' && r.payment_method !== methodFilter) return false;
      const payDate = r.payment_date ? r.payment_date.split('T')[0] : '';
      if (dateFrom && payDate < dateFrom) return false;
      if (dateTo && payDate > dateTo) return false;
      return true;
    });
  }, [records, statusFilter, methodFilter, dateFrom, dateTo, activeTab]);

  const groupedByDate = useMemo(() => {
    const groups: Record<string, PaymentRecord[]> = {};
    for (const r of filteredRecords) {
      const d = r.payment_date ? r.payment_date.split('T')[0] : '';
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
          status: 'paid',
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
    const set = new Set(records.map(r => r.payment_method).filter(Boolean));
    return Array.from(set);
  }, [records]);

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
            <button
              onClick={handleExport}
              className="px-4 py-2 text-sm font-medium border border-green-600 text-green-600 dark:text-green-400 rounded-lg hover:bg-green-50 dark:hover:bg-green-950"
            >
              {t('export')}
            </button>
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
                            <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('studentName')}</th>
                            <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('subject')}</th>
                            <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('amount')}</th>
                            <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('paymentMethod')}</th>
                            <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('status')}</th>
                            {canConfirmPayments && <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{tCommon('actions')}</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {dayRecords.map(r => (
                            <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                              <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{r.student_name}</td>
                              <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.subject}</td>
                              <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.amount}</td>
                              <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{formatMethod(r.payment_method)}</td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                  r.confirmed !== false && r.status === 'paid'
                                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                                    : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300'
                                }`}>
                                  {r.confirmed !== false && r.status === 'paid' ? t('filterPaid') : t('filterPending')}
                                </span>
                              </td>
                              {canConfirmPayments && (
                                <td className="px-4 py-3">
                                  {(r.confirmed === false || r.status === 'pending') && (
                                    <button
                                      onClick={() => handleConfirm(r.id)}
                                      disabled={confirmingId === r.id}
                                      className="px-3 py-1.5 text-sm font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-800 disabled:opacity-50"
                                    >
                                      ✓ {t('confirm')}
                                    </button>
                                  )}
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
                  {tCommon('noData')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
