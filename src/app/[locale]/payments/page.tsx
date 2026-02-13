'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, auditLog } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { exportToExcel } from '@/lib/excel-export';
import Navbar from '@/components/Navbar';

interface Payment {
  id: string;
  amount: number;
  payment_method: string;
  payment_date: string;
  status: string;
  confirmed?: boolean;
}

interface Student {
  id: string;
  name: string;
  subject: string;
  payment_status: string;
  last_paid_date: string | null;
  fee: number;
  payments?: Payment[];
}

type PaymentDisplayStatus = 'PAID' | 'PENDING' | 'UNPAID';
type StatusFilter = 'all' | 'paid' | 'unpaid' | 'pending';

// Method keys: DB value -> translation key
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

const PAYMENT_METHODS_QUICK = [
  { key: 'cash', value: 'cash' },
  { key: 'instapay', value: 'instapay' },
  { key: 'vodacash', value: 'vodafone_cash' },
  { key: 'orange', value: 'orange' },
  { key: 'fawry', value: 'fawry' },
  { key: 'bank', value: 'bank_transfer' },
];

function getLatestPayment(student: Student): Payment | undefined {
  const payments = student.payments || [];
  if (payments.length === 0) return undefined;
  const sorted = [...payments].sort(
    (a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime()
  );
  return sorted[0];
}

function getDisplayStatus(student: Student): PaymentDisplayStatus {
  const latest = getLatestPayment(student);
  if (student.payment_status === 'paid' && latest?.confirmed !== false && latest?.status === 'paid') return 'PAID';
  if (student.payment_status === 'paid' && (latest?.confirmed === false || latest?.status === 'pending')) return 'PENDING';
  return 'UNPAID';
}

export default function PaymentsPage() {
  const t = useTranslations('payments');
  const tCommon = useTranslations('common');
  const { user, hasPermission } = useUser();
  const canConfirmPayments = user?.role === 'owner' || user?.role === 'admin' || hasPermission('can_manage_payments');

  const [students, setStudents] = useState<Student[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [subjects, setSubjects] = useState<string[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [studentGroupIds, setStudentGroupIds] = useState<Record<string, string[]>>({});

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [paymentModalMethod, setPaymentModalMethod] = useState('cash');
  const [paymentModalAmount, setPaymentModalAmount] = useState('');
  const [paymentModalDate, setPaymentModalDate] = useState(new Date().toISOString().slice(0, 10));

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [quickPayOpenId, setQuickPayOpenId] = useState<string | null>(null);
  const [recordingPaymentId, setRecordingPaymentId] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  const isOwner = user?.role === 'owner';

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

    const [studentsRes, subjectsRes, groupsRes, membersRes, paymentsRes] = await Promise.all([
      dbSelect({
        table: 'students',
        select: 'id, name, subject, payment_status, last_paid_date, fee',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
        order: { column: 'created_at', ascending: false },
      }),
      dbSelect({
        table: 'subjects',
        select: 'name',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
        order: { column: 'name' },
      }),
      dbSelect({
        table: 'student_groups',
        select: 'id, name',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
        order: { column: 'name' },
      }),
      dbSelect({ table: 'student_group_members', select: 'student_id, group_id', filters: [] }),
      dbSelect({
        table: 'payments',
        select: 'id, student_id, amount, payment_method, payment_date, status, confirmed',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
        order: { column: 'payment_date', ascending: false },
      }),
    ]);

    const studentsData = (studentsRes.data || []) as Student[];
    const paymentsData = (paymentsRes.data || []) as (Payment & { student_id: string })[];
    const paymentsByStudent: Record<string, Payment[]> = {};
    for (const p of paymentsData) {
      if (!paymentsByStudent[p.student_id]) paymentsByStudent[p.student_id] = [];
      paymentsByStudent[p.student_id].push({
        id: p.id,
        amount: p.amount,
        payment_method: p.payment_method,
        payment_date: p.payment_date,
        status: p.status || 'paid',
        confirmed: p.confirmed !== false && p.status === 'paid',
      });
    }

    setStudents(studentsData.map(s => ({
      ...s,
      payments: paymentsByStudent[s.id] || [],
    })));

    const subjectTableNames = (subjectsRes.data || []).map((s: { name: string }) => s.name);
    const studentSubjectNames = studentsData.map(s => s.subject).filter(Boolean);
    setSubjects([...new Set([...subjectTableNames, ...studentSubjectNames])]);
    if (groupsRes.data) setGroups(groupsRes.data as { id: string; name: string }[]);
    if (membersRes.data && groupsRes.data) {
      const members = membersRes.data as { student_id: string; group_id: string }[];
      const centerGroupIds = new Set((groupsRes.data as { id: string }[]).map(g => g.id));
      const map: Record<string, string[]> = {};
      for (const m of members) {
        if (!centerGroupIds.has(m.group_id)) continue;
        if (!map[m.student_id]) map[m.student_id] = [];
        map[m.student_id].push(m.group_id);
      }
      setStudentGroupIds(map);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      const displayStatus = getDisplayStatus(s);
      if (statusFilter !== 'all') {
        if (statusFilter === 'pending' && displayStatus !== 'PENDING') return false;
        if (statusFilter === 'paid' && displayStatus !== 'PAID') return false;
        if (statusFilter === 'unpaid' && displayStatus !== 'UNPAID') return false;
      }
      if (subjectFilter !== 'all' && s.subject !== subjectFilter) return false;
      if (groupFilter !== 'all') {
        const studentGroups = studentGroupIds[s.id] || [];
        if (!studentGroups.includes(groupFilter)) return false;
      }
      const lastDate = getLatestPayment(s)?.payment_date || s.last_paid_date;
      if (dateFrom && lastDate) {
        const d = new Date(lastDate).toISOString().slice(0, 10);
        if (d < dateFrom) return false;
      }
      if (dateTo && lastDate) {
        const d = new Date(lastDate).toISOString().slice(0, 10);
        if (d > dateTo) return false;
      }
      return true;
    });
  }, [students, statusFilter, subjectFilter, groupFilter, studentGroupIds, dateFrom, dateTo]);

  const pendingPaymentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of filteredStudents) {
      const latest = getLatestPayment(s);
      if (latest && (latest.confirmed === false || latest.status === 'pending')) ids.add(latest.id);
    }
    return ids;
  }, [filteredStudents]);

  const selectAllPending = () => {
    const pendingIds = new Set<string>();
    for (const s of filteredStudents) {
      const latest = getLatestPayment(s);
      if (latest && (latest.confirmed === false || latest.status === 'pending')) pendingIds.add(latest.id);
    }
    setSelected(pendingIds);
  };

  const handleQuickPay = async (studentId: string, method: string) => {
    if (!centerId || !userId) return;
    const student = students.find(s => s.id === studentId);
    if (!student) return;
    setQuickPayOpenId(null);
    setRecordingPaymentId(studentId);

    const isCash = method === 'cash';
    const confirmed = isCash;
    const paidDate = new Date().toISOString();

    try {
      await dbUpdate({
        table: 'students',
        data: { payment_status: 'paid', ...(isCash ? { last_paid_date: paidDate } : {}) },
        filters: [{ column: 'id', op: 'eq', value: studentId }],
      });
      await dbInsert({
        table: 'payments',
        data: {
          student_id: studentId,
          center_id: centerId,
          amount: student.fee,
          payment_method: method,
          payment_date: paidDate,
          created_by: userId,
          status: isCash ? 'paid' : 'pending',
          confirmed: isCash,
        },
        select: false,
      });

      setStudents(prev =>
        prev.map(s => s.id === studentId
          ? {
              ...s,
              payment_status: 'paid',
              last_paid_date: isCash ? paidDate : s.last_paid_date,
              payments: [
                {
                  id: 'new',
                  amount: student.fee,
                  payment_method: method,
                  payment_date: paidDate,
                  status: isCash ? 'paid' : 'pending',
                  confirmed: isCash,
                },
                ...(s.payments || []),
              ],
            }
          : s
        )
      );

      setSuccessMessage(isCash ? t('recorded') : t('awaitingConfirmation'));
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err) {
      console.error('Quick pay error:', err);
    } finally {
      setRecordingPaymentId(null);
    }
  };

  const handleConfirmSingle = async (paymentId: string) => {
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

  const handleBulkConfirm = async () => {
    if (!userId || !canConfirmPayments || selected.size === 0) return;
    setIsProcessing(true);
    try {
      for (const pid of selected) {
        await dbUpdate({
          table: 'payments',
          data: {
            confirmed: true,
            confirmed_by: userId,
            confirmed_at: new Date().toISOString(),
            status: 'paid',
          },
          filters: [{ column: 'id', op: 'eq', value: pid }],
        });
      }
      await loadData();
      setSelected(new Set());
      setSuccessMessage(t('confirmed', { count: selected.size }));
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err) {
      console.error('Bulk confirm error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleSelect = (paymentId: string) => {
    const next = new Set(selected);
    if (next.has(paymentId)) next.delete(paymentId);
    else next.add(paymentId);
    setSelected(next);
  };

  const handleBulkMarkPaid = async () => {
    if (!centerId || !userId || selected.size === 0) return;
    const studentIds = statusFilter === 'pending'
      ? filteredStudents.filter(s => { const latest = getLatestPayment(s); return latest && selected.has(latest.id); }).map(s => s.id)
      : Array.from(selected) as string[];
    if (studentIds.length === 0) return;
    const first = students.find(s => studentIds.includes(s.id));
    const amount = paymentModalAmount ? Number(paymentModalAmount) : (first?.fee || 0);
    if (amount <= 0) return;
    setIsProcessing(true);
    const paidDate = new Date(paymentModalDate).toISOString();
    try {
      await dbUpdate({
        table: 'students',
        data: { payment_status: 'paid', last_paid_date: paidDate },
        filters: [{ column: 'id', op: 'in', value: studentIds }],
      });
      await dbInsert({
        table: 'payments',
        data: studentIds.map(id => ({
          student_id: id,
          center_id: centerId,
          amount,
          payment_method: paymentModalMethod,
          payment_date: paidDate,
          created_by: userId,
          status: 'paid',
          confirmed: true,
        })),
        select: false,
      });
      await loadData();
      setSelected(new Set());
      setShowPaymentModal(false);
      setSuccessMessage(t('confirmed', { count: studentIds.length }));
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err) {
      console.error('Bulk pay error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const selectAll = () => {
    if (statusFilter === 'pending') {
      if (selected.size === Array.from(pendingPaymentIds).length) setSelected(new Set());
      else setSelected(new Set(pendingPaymentIds));
    } else {
      if (selected.size === filteredStudents.length) setSelected(new Set());
      else setSelected(new Set(filteredStudents.map(s => s.id)));
    }
  };

  const selectAllUnpaid = () => {
    const unpaidIds = filteredStudents.filter(s => getDisplayStatus(s) === 'UNPAID').map(s => s.id);
    setSelected(new Set(unpaidIds));
  };

  const handleResetAllPayments = async () => {
    if (!centerId || !userId || !isOwner) return;
    if (!confirm(t('resetAllPaymentsConfirm'))) return;
    setIsResetting(true);
    try {
      const { error } = await dbUpdate({
        table: 'students',
        data: { payment_status: 'unpaid' },
        filters: [{ column: 'center_id', op: 'eq', value: centerId }],
        select: false,
      });
      if (error) {
        console.error('[Payments] Reset all failed:', error);
        setSuccessMessage(tCommon('error'));
        setTimeout(() => setSuccessMessage(''), 4000);
      } else {
        await auditLog({
          centerId,
          userId: userId!,
          action: 'payments_reset_all',
          entityType: 'students',
          details: { reset_all: true },
        });
        await loadData();
        setSuccessMessage(t('resetAllPayments') + ' ✓');
        setTimeout(() => setSuccessMessage(''), 4000);
      }
    } catch (err) {
      console.error('[Payments] Reset all error:', err);
      setSuccessMessage(tCommon('error'));
      setTimeout(() => setSuccessMessage(''), 4000);
    } finally {
      setIsResetting(false);
    }
  };

  const handleExport = () => {
    const forExport = filteredStudents.map(s => {
      const latest = getLatestPayment(s);
      const displayStatus = getDisplayStatus(s);
      return {
        ...s,
        last_paid_date: latest?.payment_date || s.last_paid_date,
        last_payment_method: latest?.payment_method || null,
        payment_status: displayStatus === 'PAID' ? 'paid' : displayStatus === 'PENDING' ? 'pending' : 'unpaid',
      };
    });
    exportToExcel(forExport);
  };

  const formatMethod = (method: string) => {
    const key = METHOD_KEYS[method] || method;
    return t(String(key) as any) || method;
  };

  const StatusBadge = ({ status }: { status: PaymentDisplayStatus }) => {
    const styles = {
      PAID: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
      PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
      UNPAID: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    };
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${styles[status]}`}>
        {status === 'PAID' ? t('filterPaid') : status === 'PENDING' ? t('filterPending') : t('filterUnpaid')}
      </span>
    );
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
            <div className="flex gap-2">
              {isOwner && (
                <button
                  onClick={handleResetAllPayments}
                  disabled={isResetting || isLoading}
                  className="px-4 py-2 text-sm font-medium border border-amber-600 text-amber-600 dark:text-amber-400 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950 disabled:opacity-50"
                >
                  {isResetting ? tCommon('loading') : t('resetAllPayments')}
                </button>
              )}
              <button
                onClick={handleExport}
                className="px-4 py-2 text-sm font-medium border border-green-600 text-green-600 dark:text-green-400 rounded-lg hover:bg-green-50 dark:hover:bg-green-950"
              >
                {t('export')}
              </button>
            </div>
          </div>

          {successMessage && (
            <div className="mb-4 p-3 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-sm text-center">
              {successMessage}
            </div>
          )}

          <div className="flex flex-wrap gap-3 mb-6">
            <div className="flex bg-white dark:bg-gray-800 rounded-lg shadow p-1">
              {(['all', 'paid', 'unpaid', 'pending'] as StatusFilter[]).map(status => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    statusFilter === status ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {status === 'all' ? t('filterAll') : status === 'paid' ? t('filterPaid') : status === 'unpaid' ? t('filterUnpaid') : t('filterPending')}
                </button>
              ))}
            </div>
            <select
              value={subjectFilter}
              onChange={e => setSubjectFilter(e.target.value)}
              className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm shadow"
            >
              <option value="all">{t('allSubjects')}</option>
              {subjects.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={groupFilter}
              onChange={e => setGroupFilter(e.target.value)}
              className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm shadow"
            >
              <option value="all">{t('allGroups')}</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
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

          {statusFilter === 'pending' && canConfirmPayments && (
            <div className="flex items-center gap-3 mb-4 p-3 bg-amber-50 dark:bg-amber-950/50 rounded-lg">
              <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                {t('selected', { count: selected.size })}
              </span>
              <button
                onClick={selectAllPending}
                className="text-xs px-3 py-1.5 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900 rounded-lg"
              >
                {t('selectAll')}
              </button>
              <button
                onClick={handleBulkConfirm}
                disabled={isProcessing || selected.size === 0}
                className="px-4 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {isProcessing ? tCommon('loading') : t('confirmSelected')}
              </button>
            </div>
          )}

          {statusFilter !== 'pending' && selected.size > 0 && (
            <div className="flex items-center gap-3 mb-4 p-3 bg-indigo-50 dark:bg-indigo-950/50 rounded-lg">
              <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">{t('selected', { count: selected.size })}</span>
              <button
                onClick={() => { setPaymentModalAmount(String(students.find(s => selected.has(s.id))?.fee || '')); setPaymentModalDate(new Date().toISOString().slice(0, 10)); setShowPaymentModal(true); }}
                className="px-4 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                {t('bulkMarkPaid')}
              </button>
              <button onClick={() => setSelected(new Set())} className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400">
                {t('filterAll')}
              </button>
            </div>
          )}

          <div className="flex gap-2 mb-4">
            <button onClick={selectAll} className="text-xs px-3 py-1.5 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950 rounded-lg">
              {t('selectAll')}
            </button>
            <button onClick={selectAllUnpaid} className="text-xs px-3 py-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 rounded-lg">
              {t('selectAllUnpaid')}
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
            <>
              {/* Desktop Table */}
              <div className="hidden md:block bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                        <th className="px-4 py-3 w-10">
                          {statusFilter === 'pending' ? (
                            <input
                              type="checkbox"
                              checked={selected.size > 0 && selected.size === Array.from(pendingPaymentIds).length}
                              onChange={selectAll}
                              className="w-4 h-4 text-indigo-600 rounded"
                            />
                          ) : (
                            <input
                              type="checkbox"
                              checked={selected.size === filteredStudents.length && filteredStudents.length > 0}
                              onChange={selectAll}
                              className="w-4 h-4 text-indigo-600 rounded"
                            />
                          )}
                        </th>
                        <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('studentName')}</th>
                        <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('subject')}</th>
                        <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('status')}</th>
                        <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('amount')}</th>
                        <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('lastPaidDate')}</th>
                        <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('paymentMethod')}</th>
                        <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{tCommon('actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStudents.map(student => {
                        const latest = getLatestPayment(student);
                        const displayStatus = getDisplayStatus(student);
                        const isPendingPayment = latest && (latest.confirmed === false || latest.status === 'pending');
                        return (
                          <tr
                            key={student.id}
                            className={`border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 ${
                              (statusFilter === 'pending' ? selected.has(latest?.id || '') : selected.has(student.id)) ? 'bg-indigo-50 dark:bg-indigo-950/30' : ''
                            }`}
                          >
                            <td className="px-4 py-3">
                              {statusFilter === 'pending' && latest ? (
                                <input
                                  type="checkbox"
                                  checked={selected.has(latest.id)}
                                  onChange={() => toggleSelect(latest.id)}
                                  className="w-4 h-4 text-indigo-600 rounded"
                                />
                              ) : statusFilter !== 'pending' ? (
                                <input
                                  type="checkbox"
                                  checked={selected.has(student.id)}
                                  onChange={() => {
                                    const next = new Set(selected);
                                    if (next.has(student.id)) next.delete(student.id);
                                    else next.add(student.id);
                                    setSelected(next);
                                  }}
                                  className="w-4 h-4 text-indigo-600 rounded"
                                />
                              ) : null}
                            </td>
                            <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{student.name}</td>
                            <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{student.subject}</td>
                            <td className="px-4 py-3"><StatusBadge status={displayStatus} /></td>
                            <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{student.fee}</td>
                            <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                              {latest?.payment_date ? new Date(latest.payment_date).toLocaleDateString('ar-EG') : '—'}
                            </td>
                            <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                              {latest?.payment_method ? formatMethod(latest.payment_method) : '—'}
                            </td>
                            <td className="px-4 py-3 relative">
                              {displayStatus === 'UNPAID' && (
                                <div className="relative">
                                  <button
                                    onClick={() => setQuickPayOpenId(quickPayOpenId === student.id ? null : student.id)}
                                    disabled={recordingPaymentId === student.id}
                                    className="px-3 py-1.5 text-sm font-medium bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200 rounded-lg hover:bg-green-200 dark:hover:bg-green-800 disabled:opacity-50"
                                  >
                                    💰 {t('recordPayment')}
                                  </button>
                                  {quickPayOpenId === student.id && (
                                    <>
                                      <div className="fixed inset-0 z-40" onClick={() => setQuickPayOpenId(null)} />
                                      <div className="absolute left-0 top-full mt-1 z-50 w-48 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700">
                                        <div className="grid grid-cols-2 gap-2">
                                          {PAYMENT_METHODS_QUICK.map(m => (
                                            <button
                                              key={m.value}
                                              onClick={() => handleQuickPay(student.id, m.value)}
                                              className="py-2 px-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
                                            >
                                              {t(String(m.key) as any)}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}
                              {displayStatus === 'PENDING' && canConfirmPayments && latest && (
                                <button
                                  onClick={() => handleConfirmSingle(latest.id)}
                                  disabled={confirmingId === latest.id}
                                  className="px-3 py-1.5 text-sm font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-800 disabled:opacity-50"
                                >
                                  ✓ {t('confirm')}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {filteredStudents.length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-4 py-8 text-center text-gray-400">—</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3">
                {filteredStudents.map(student => {
                  const latest = getLatestPayment(student);
                  const displayStatus = getDisplayStatus(student);
                  const isPendingPayment = latest && (latest.confirmed === false || latest.status === 'pending');
                  return (
                    <div
                      key={student.id}
                      className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 border border-gray-200 dark:border-gray-700"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-medium text-gray-900 dark:text-white">{student.name}</span>
                        <StatusBadge status={displayStatus} />
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1 mb-3">
                        <div>{t('subject')}: {student.subject} | {t('amount')}: EGP {student.fee}</div>
                        <div>{t('paymentMethod')}: {latest?.payment_method ? formatMethod(latest.payment_method) : '—'} | {t('lastPaidDate')}: {latest?.payment_date ? new Date(latest.payment_date).toLocaleDateString('ar-EG') : '—'}</div>
                      </div>
                      <div className="flex gap-2">
                        {displayStatus === 'UNPAID' && (
                          <div className="relative flex-1">
                            <button
                              onClick={() => setQuickPayOpenId(quickPayOpenId === student.id ? null : student.id)}
                              disabled={recordingPaymentId === student.id}
                              className="w-full py-2 text-sm font-medium bg-green-100 text-green-800 dark:bg-green-900/50 rounded-lg"
                            >
                              💰 {t('recordPayment')}
                            </button>
                            {quickPayOpenId === student.id && (
                              <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg grid grid-cols-2 gap-2">
                                {PAYMENT_METHODS_QUICK.map(m => (
                                  <button
                                    key={m.value}
                                    onClick={() => handleQuickPay(student.id, m.value)}
                                    className="py-2 text-sm font-medium rounded-lg bg-white dark:bg-gray-700 border"
                                  >
                                    {t(String(m.key) as any)}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {displayStatus === 'PENDING' && canConfirmPayments && latest && (
                          <button
                            onClick={() => handleConfirmSingle(latest.id)}
                            disabled={confirmingId === latest.id}
                            className="px-4 py-2 text-sm font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/50 rounded-lg"
                          >
                            ✓ {t('confirm')}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">{t('bulkMarkPaid')}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('paymentMethod')}</label>
                <select
                  value={paymentModalMethod}
                  onChange={e => setPaymentModalMethod(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                >
                  {PAYMENT_METHODS_QUICK.map(m => (
                    <option key={m.value} value={m.value}>{t(String(m.key) as any)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('amount')}</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={paymentModalAmount}
                  onChange={e => setPaymentModalAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('lastPaidDate')}</label>
                <input
                  type="date"
                  value={paymentModalDate}
                  onChange={e => setPaymentModalDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={handleBulkMarkPaid} disabled={isProcessing} className="flex-1 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                {isProcessing ? tCommon('loading') : tCommon('save')}
              </button>
              <button onClick={() => setShowPaymentModal(false)} className="flex-1 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg">
                {tCommon('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
