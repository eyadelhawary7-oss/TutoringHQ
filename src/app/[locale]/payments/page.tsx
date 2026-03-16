'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, type Filter } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { Download, Search, Check, Clock, CreditCard, Receipt, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import EmptyState from '@/components/empty-states/EmptyState';

interface PaymentRecord {
  id: string;
  student_id: string;
  center_id: string;
  amount: number;
  method: string;
  paid_at: string;
  status: string;
  recorded_by?: string | null;
  student_name?: string;
  student_number?: string;
  recorded_by_name?: string | null;
}

const METHOD_OPTIONS: { value: string; labelAr: string; labelEn: string }[] = [
  { value: 'all', labelAr: 'الكل', labelEn: 'All' },
  { value: 'cash', labelAr: 'نقدي', labelEn: 'Cash' },
  { value: 'instapay', labelAr: 'إنستاباي', labelEn: 'InstaPay' },
  { value: 'vodacash', labelAr: 'فودافون كاش', labelEn: 'Vodafone Cash' },
  { value: 'vodafone_cash', labelAr: 'فودافون كاش', labelEn: 'Vodafone Cash' },
  { value: 'orange', labelAr: 'أورانج كاش', labelEn: 'Orange Cash' },
  { value: 'orange_cash', labelAr: 'أورانج كاش', labelEn: 'Orange Cash' },
  { value: 'fawry', labelAr: 'فوري', labelEn: 'Fawry' },
  { value: 'bank', labelAr: 'تحويل بنكي', labelEn: 'Bank Transfer' },
  { value: 'bank_transfer', labelAr: 'تحويل بنكي', labelEn: 'Bank Transfer' },
];

const METHOD_BADGE_CLASS: Record<string, string> = {
  cash: 'bg-green-100 text-green-700',
  instapay: 'bg-blue-100 text-blue-700',
  vodafone_cash: 'bg-red-100 text-red-700',
  vodacash: 'bg-red-100 text-red-700',
  orange: 'bg-orange-100 text-orange-700',
  orange_cash: 'bg-orange-100 text-orange-700',
  fawry: 'bg-purple-100 text-purple-700',
  bank: 'bg-slate-100 text-slate-700',
  bank_transfer: 'bg-slate-100 text-slate-700',
};

const METHOD_LABEL_AR: Record<string, string> = {
  cash: 'نقدي', instapay: 'إنستاباي', vodacash: 'فودافون كاش', vodafone_cash: 'فودافون كاش',
  orange: 'أورانج كاش', orange_cash: 'أورانج كاش', fawry: 'فوري', bank: 'تحويل بنكي', bank_transfer: 'تحويل بنكي',
};

function getTodayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function getMonthStartEnd() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export default function PaymentsPage() {
  const t = useTranslations('payments');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { user, hasPermission } = useUser();
  const isRTL = locale === 'ar';
  const canViewPayments = user?.role === 'owner' || user?.role === 'admin' || hasPermission('can_view_payments');

  const [records, setRecords] = useState<PaymentRecord[]>([]);
  const [studentsBalanceDue, setStudentsBalanceDue] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [methodFilter, setMethodFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'confirmed' | 'pending'>('all');
  const [dateFrom, setDateFrom] = useState(getTodayISO());
  const [dateTo, setDateTo] = useState(getTodayISO());
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<PaymentRecord | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const meRes = await fetch('/api/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
    const meData = await meRes.json();
    if (!meData?.user?.center_id) return;
    setCenterId(meData.user.center_id);
    const cid = meData.user.center_id;

    setLoadError(null);
    setIsLoading(true);

    try {
      const filters: Filter[] = [{ column: 'center_id', op: 'eq', value: cid }];
      filters.push({ column: 'paid_at', op: 'gte', value: `${dateFrom}T00:00:00.000Z` });
      filters.push({ column: 'paid_at', op: 'lte', value: `${dateTo}T23:59:59.999Z` });
      if (methodFilter !== 'all') {
        if (methodFilter === 'bank') {
          filters.push({ column: 'method', op: 'in', value: ['bank', 'bank_transfer'] });
        } else if (methodFilter === 'vodacash') {
          filters.push({ column: 'method', op: 'in', value: ['vodacash', 'vodafone_cash'] });
        } else if (methodFilter === 'orange') {
          filters.push({ column: 'method', op: 'in', value: ['orange', 'orange_cash'] });
        } else {
          filters.push({ column: 'method', op: 'eq', value: methodFilter });
        }
      }
      if (statusFilter !== 'all') {
        filters.push({ column: 'status', op: 'eq', value: statusFilter });
      }

      const { data: paymentsData, error: payErr } = await dbSelect({
        table: 'payments',
        select: 'id, student_id, center_id, amount, method, recorded_by, paid_at, status, students(name, student_number)',
        filters,
        order: { column: 'paid_at', ascending: false },
      });

      if (payErr) throw payErr;

      type PaymentRow = PaymentRecord & { students?: { name?: string; student_number?: string } | null };
      const payments = (paymentsData || []) as PaymentRow[];

      const studentIds = [...new Set(payments.map(p => p.student_id))];
      const userIds = [...new Set(payments.map(p => p.recorded_by).filter(Boolean))] as string[];

      let studentMap: Record<string, { name: string; student_number: string }> = {};
      let userMap: Record<string, string> = {};

      const { data: allStudentsData } = await dbSelect({
        table: 'students',
        select: 'id, name, student_number, balance_due',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
      });
      const allStudents = (allStudentsData || []) as { id: string; name: string; student_number?: string; balance_due?: number }[];
      const totalBalance = allStudents.reduce((sum, s) => sum + (Number(s.balance_due) || 0), 0);
      setStudentsBalanceDue(totalBalance);

      if (studentIds.length > 0) {
        studentMap = Object.fromEntries(
          allStudents.filter(s => studentIds.includes(s.id)).map(s => [s.id, { name: s.name || '—', student_number: s.student_number || '—' }])
        );
      }

      if (userIds.length > 0) {
        const { data: usersData } = await dbSelect({
          table: 'users',
          select: 'id, name',
          filters: [{ column: 'id', op: 'in', value: userIds }],
        });
        const users = (usersData || []) as { id: string; name: string | null }[];
        userMap = Object.fromEntries(users.map(u => [u.id, u.name || '—']));
      }

      setRecords(payments.map(p => ({
        ...p,
        student_name: p.students?.name ?? studentMap[p.student_id]?.name ?? allStudents.find(s => s.id === p.student_id)?.name ?? '—',
        student_number: p.students?.student_number ?? studentMap[p.student_id]?.student_number ?? allStudents.find(s => s.id === p.student_id)?.student_number ?? '—',
        recorded_by_name: p.recorded_by ? (userMap[p.recorded_by] ?? '—') : null,
      })));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [dateFrom, dateTo, methodFilter, statusFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = useMemo(() => {
    return records.filter(r => {
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const name = (r.student_name ?? '').toLowerCase();
        const num = (r.student_number ?? '').toLowerCase();
        if (!name.includes(q) && !num.includes(q)) return false;
      }
      return true;
    });
  }, [records, searchQuery]);

  const stats = useMemo(() => {
    const today = getTodayISO();
    const { start: monthStart, end: monthEnd } = getMonthStartEnd();

    const totalToday = records
      .filter(r => r.status === 'confirmed' && r.paid_at?.startsWith(today))
      .reduce((s, r) => s + (r.amount ?? 0), 0);

    const pendingPayments = records.filter(r => r.status === 'pending');
    const pendingCount = pendingPayments.length;
    const pendingAmount = pendingPayments.reduce((s, r) => s + (r.amount ?? 0), 0);

    const totalMonth = records
      .filter(r => r.status === 'confirmed' && r.paid_at >= `${monthStart}T00:00:00` && r.paid_at <= `${monthEnd}T23:59:59`)
      .reduce((s, r) => s + (r.amount ?? 0), 0);

    return {
      totalToday,
      pendingCount,
      pendingAmount,
      balanceDue: studentsBalanceDue,
      totalMonth,
    };
  }, [records, studentsBalanceDue]);

  const handleConfirm = async (paymentId: string) => {
    if (!canViewPayments) return;
    setConfirmingId(paymentId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const headers = await getCsrfHeaders(session.access_token);
      const res = await fetch('/api/payments/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...headers,
        },
        body: JSON.stringify({ payment_id: paymentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed');
      setConfirmModal(null);
      await loadData();
      setSuccessMessage(t('confirmed', { count: 1 }));
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    } finally {
      setConfirmingId(null);
    }
  };

  const handleExportCSV = () => {
    const cols = ['Date', 'Student Name', 'Amount (EGP)', 'Method', 'Status', 'Recorded By'];
    const methodLabels: Record<string, string> = {
      cash: 'نقدي',
      instapay: 'InstaPay',
      vodacash: 'Vodafone Cash',
      vodafone_cash: 'Vodafone Cash',
      orange: 'Orange Cash',
      orange_cash: 'Orange Cash',
      fawry: 'Fawry',
      bank: 'تحويل بنكي',
      bank_transfer: 'تحويل بنكي',
    };
    const statusLabels: Record<string, string> = { confirmed: 'مؤكد', pending: 'معلق' };
    const rows = filtered.map(r => [
      r.paid_at ? new Date(r.paid_at).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB') : '',
      r.student_name ?? '',
      String(r.amount ?? 0),
      methodLabels[r.method] ?? r.method,
      statusLabels[r.status] ?? r.status,
      r.recorded_by_name ?? '',
    ]);
    const csvContent = '\uFEFF' + [cols.join(','), ...rows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payments-${getTodayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatMethod = (method: string) => {
    const key = method?.toLowerCase() ?? 'cash';
    const cls = METHOD_BADGE_CLASS[key] ?? 'bg-slate-100 text-slate-700';
    const labels: Record<string, string> = {
      cash: 'نقدي',
      instapay: 'InstaPay',
      vodacash: 'Vodafone Cash',
      vodafone_cash: 'Vodafone Cash',
      orange: 'Orange Cash',
      orange_cash: 'Orange Cash',
      fawry: 'Fawry',
      bank: 'تحويل بنكي',
      bank_transfer: 'تحويل بنكي',
    };
    return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{labels[key] ?? method ?? '—'}</span>;
  };

  const formatStatus = (status: string) => {
    if (status === 'confirmed') {
      return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">{t('confirmedStatus')}</span>;
    }
    return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">{t('filterPending')}</span>;
  };

  const methodOptionsForFilter = [
    { value: 'all', labelAr: 'الكل', labelEn: 'All' },
    { value: 'cash', labelAr: 'نقدي', labelEn: 'Cash' },
    { value: 'instapay', labelAr: 'إنستاباي', labelEn: 'InstaPay' },
    { value: 'vodacash', labelAr: 'فودافون كاش', labelEn: 'Vodafone Cash' },
    { value: 'orange', labelAr: 'أورانج كاش', labelEn: 'Orange Cash' },
    { value: 'fawry', labelAr: 'فوري', labelEn: 'Fawry' },
    { value: 'bank', labelAr: 'تحويل بنكي', labelEn: 'Bank Transfer' },
  ];

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="p-4 md:p-6 space-y-5 animate-fade-in min-h-screen bg-background">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('transactionLog')}</p>
        </div>
      </div>

      {successMessage && (
        <div className="p-3 bg-green-50 border border-green-200 text-green-700 rounded-xl text-sm text-center">
          {successMessage}
        </div>
      )}

      {loadError && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
          <p className="font-medium">{loadError}</p>
          <button onClick={() => loadData()} className="mt-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg">
            {t('retry')}
          </button>
        </div>
      )}

      {/* Stats Row - 4 cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-center gap-3">
          <div className="p-3 rounded-full shrink-0 bg-green-100"><CreditCard size={18} className="text-green-600" /></div>
          <div className="min-w-0">
            <div className="font-black text-lg md:text-xl font-mono text-slate-900">{stats.totalToday.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')} {tCommon('egp')}</div>
            <div className="text-xs text-slate-500">{t('collectedToday')}</div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-center gap-3">
          <div className="p-3 rounded-full shrink-0 bg-amber-100"><Clock size={18} className="text-amber-600" /></div>
          <div className="min-w-0">
            <div className="font-black text-lg md:text-xl font-mono text-slate-900">{stats.pendingCount} — {stats.pendingAmount.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')} {tCommon('egp')}</div>
            <div className="text-xs text-slate-500">{t('pendingDigital')}</div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-center gap-3">
          <div className="p-3 rounded-full shrink-0 bg-red-100"><Receipt size={18} className="text-red-600" /></div>
          <div className="min-w-0">
            <div className="font-black text-lg md:text-xl font-mono text-slate-900">{stats.balanceDue.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')} {tCommon('egp')}</div>
            <div className="text-xs text-slate-500">{t('totalBalanceDue')}</div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-center gap-3">
          <div className="p-3 rounded-full shrink-0 bg-teal-100"><Check size={18} className="text-teal-600" /></div>
          <div className="min-w-0">
            <div className="font-black text-lg md:text-xl font-mono text-slate-900">{stats.totalMonth.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')} {tCommon('egp')}</div>
            <div className="text-xs text-slate-500">{t('collectedThisMonth')}</div>
          </div>
        </div>
      </div>

      {/* Filter Bar - full width, RTL */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row flex-wrap gap-3 items-stretch sm:items-center">
        <select
          value={methodFilter}
          onChange={e => setMethodFilter(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white text-slate-900 min-w-[140px]"
        >
          {methodOptionsForFilter.map(m => (
            <option key={m.value} value={m.value}>{isRTL ? m.labelAr : m.labelEn}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
          className="px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white text-slate-900 min-w-[120px]"
        >
          <option value="all">{tCommon('all')}</option>
          <option value="confirmed">{t('confirmedStatus')}</option>
          <option value="pending">{t('filterPending')}</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white text-slate-900"
        />
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white text-slate-900"
        />
        <div className="relative flex-1 min-w-[160px]">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('searchStudent')}
            className="w-full ps-9 pe-4 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400"
          />
        </div>
        <button
          onClick={handleExportCSV}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors shrink-0"
        >
          <Download size={14} /> {t('exportCSV')}
        </button>
      </div>

      {/* Payments Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin h-8 w-8 border-2 border-teal-500 border-t-transparent rounded-full" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Receipt />}
            titleKey="payments.title"
            descriptionKey="payments.description"
            namespace="emptyStates"
            actionLabel="payments.action"
            onAction={() => router.push(`/${locale}/scan`)}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-end py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('date')}</th>
                  <th className="text-end py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('student')}</th>
                  <th className="text-end py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('amount')}</th>
                  <th className="text-end py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('paymentMethod')}</th>
                  <th className="text-end py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{tCommon('status')}</th>
                  <th className="text-end py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('recordedBy')}</th>
                  <th className="text-end py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">{tCommon('actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-4 text-sm text-slate-600 text-end" dir="ltr">
                      {p.paid_at ? new Date(p.paid_at).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-sm text-slate-900 text-end">
                      <div className="font-medium">{p.student_name}</div>
                      <div className="text-xs text-slate-500 font-mono" dir="ltr">{p.student_number}</div>
                    </td>
                    <td className="py-3.5 px-4 text-sm font-bold font-mono text-slate-900 text-end">{p.amount} {tCommon('egp')}</td>
                    <td className="py-3.5 px-4 text-sm text-end">{formatMethod(p.method)}</td>
                    <td className="py-3.5 px-4 text-sm text-end">{formatStatus(p.status)}</td>
                    <td className="py-3.5 px-4 text-sm text-slate-500 text-end">{p.recorded_by_name ?? '—'}</td>
                    <td className="py-3.5 px-4 text-sm text-end">
                      {p.status === 'confirmed' ? (
                        <Check size={18} className="text-green-600 inline" />
                      ) : p.status === 'pending' && canViewPayments ? (
                        <button
                          onClick={() => setConfirmModal(p)}
                          className="px-3 py-1.5 border border-teal-500 text-teal-600 hover:bg-teal-50 text-xs font-semibold rounded-lg transition-colors"
                        >
                          {t('confirmPayment')}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirm Payment Modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setConfirmModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">{t('confirmPayment')}</h3>
              <button onClick={() => setConfirmModal(null)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-slate-600 mb-6">
              {locale === 'ar'
                ? `تأكيد استلام ${confirmModal.amount} جنيه بـ ${METHOD_LABEL_AR[confirmModal.method] ?? confirmModal.method} من ${confirmModal.student_name}؟`
                : `Confirm receipt of ${confirmModal.amount} EGP via ${confirmModal.method} from ${confirmModal.student_name}?`}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-lg"
              >
                {tCommon('cancel')}
              </button>
              <button
                onClick={() => handleConfirm(confirmModal.id)}
                disabled={confirmingId === confirmModal.id}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
              >
                {confirmingId === confirmModal.id ? tCommon('loading') : tCommon('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
