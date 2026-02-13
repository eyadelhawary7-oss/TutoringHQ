'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate } from '@/lib/db-proxy';
import { exportToExcel } from '@/lib/excel-export';
import Navbar from '@/components/Navbar';

interface Student {
  id: string;
  name: string;
  subject_name: string;
  payment_status: string;
  last_paid_date: string | null;
  monthly_fee: number;
  last_payment_method?: string | null;
}

type StatusFilter = 'all' | 'paid' | 'unpaid';

const PAYMENT_METHODS = [
  { key: 'cash', value: 'cash' },
  { key: 'instapay', value: 'instapay' },
  { key: 'vodafone', value: 'vodafone_cash' },
  { key: 'orange', value: 'orange' },
  { key: 'fawry', value: 'fawry' },
  { key: 'bankTransfer', value: 'bank_transfer' },
];

export default function PaymentsPage() {
  const t = useTranslations('payments');
  const tScan = useTranslations('scan');
  const tCommon = useTranslations('common');

  const [students, setStudents] = useState<Student[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [subjects, setSubjects] = useState<string[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [studentGroupIds, setStudentGroupIds] = useState<Record<string, string[]>>({});

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Bulk action
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [paymentModalMethod, setPaymentModalMethod] = useState('cash');
  const [paymentModalAmount, setPaymentModalAmount] = useState('');
  const [paymentModalDate, setPaymentModalDate] = useState(new Date().toISOString().slice(0, 10));

  // Date range filter
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);

      // Use /api/me to bypass RLS on users table
      const meRes = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const meData = await meRes.json();

      if (!meData?.user?.center_id) return;
      setCenterId(meData.user.center_id);

      // Load students, subjects, groups, members, and payments (for last payment method)
      const [studentsRes, subjectsRes, groupsRes, membersRes, paymentsRes] = await Promise.all([
        dbSelect({
          table: 'students',
          select: 'id, name, subject_name, payment_status, last_paid_date, monthly_fee',
          filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
          order: { column: 'name' },
        }),
        dbSelect({
          table: 'subjects',
          select: 'name',
          filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
          order: { column: 'name' },
        }),
        dbSelect({
          table: 'student_groups',
          select: 'id, name',
          filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
          order: { column: 'name' },
        }),
        dbSelect({
          table: 'student_group_members',
          select: 'student_id, group_id',
          filters: [],
        }),
        dbSelect({
          table: 'payments',
          select: 'student_id, payment_method, payment_date',
          filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
          order: { column: 'payment_date', ascending: false },
        }),
      ]);

      if (studentsRes.data) {
        const studentsData = studentsRes.data as Student[];
        const paymentsData = (paymentsRes.data || []) as { student_id: string; payment_method: string; payment_date: string }[];
        const lastPaymentByStudent: Record<string, { method: string }> = {};
        for (const p of paymentsData) {
          if (!lastPaymentByStudent[p.student_id]) {
            lastPaymentByStudent[p.student_id] = { method: p.payment_method };
          }
        }
        setStudents(studentsData.map(s => ({
          ...s,
          last_payment_method: lastPaymentByStudent[s.id]?.method ?? null,
        })));
      }
      // Merge subjects from subjects table + any subject_name on students
      const subjectTableNames = (subjectsRes.data || []).map((s: { name: string }) => s.name);
      const studentSubjectNames = (studentsRes.data || []).map((s: Student) => s.subject_name).filter(Boolean);
      const allSubjects = [...new Set([...subjectTableNames, ...studentSubjectNames])];
      setSubjects(allSubjects);
      if (groupsRes.data) {
        setGroups(groupsRes.data as { id: string; name: string }[]);
      }
      if (membersRes.data && groupsRes.data) {
        const members = membersRes.data as { student_id: string; group_id: string }[];
        const centerGroupIds = new Set((groupsRes.data as { id: string }[]).map((g) => g.id));
        const map: Record<string, string[]> = {};
        for (const m of members) {
          if (!centerGroupIds.has(m.group_id)) continue;
          if (!map[m.student_id]) map[m.student_id] = [];
          map[m.student_id].push(m.group_id);
        }
        setStudentGroupIds(map);
      }
      setIsLoading(false);
    };
    load();
  }, []);

  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      if (statusFilter !== 'all' && s.payment_status !== statusFilter) return false;
      if (subjectFilter !== 'all' && s.subject_name !== subjectFilter) return false;
      if (groupFilter !== 'all') {
        const studentGroups = studentGroupIds[s.id] || [];
        if (!studentGroups.includes(groupFilter)) return false;
      }
      if (dateFrom && s.last_paid_date) {
        const d = new Date(s.last_paid_date).toISOString().slice(0, 10);
        if (d < dateFrom) return false;
      }
      if (dateTo && s.last_paid_date) {
        const d = new Date(s.last_paid_date).toISOString().slice(0, 10);
        if (d > dateTo) return false;
      }
      return true;
    });
  }, [students, statusFilter, subjectFilter, groupFilter, studentGroupIds, dateFrom, dateTo]);

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelected(newSelected);
  };

  const selectAllUnpaid = () => {
    const unpaidIds = filteredStudents
      .filter(s => s.payment_status === 'unpaid')
      .map(s => s.id);
    setSelected(new Set(unpaidIds));
  };

  const selectAll = () => {
    if (selected.size === filteredStudents.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredStudents.map(s => s.id)));
    }
  };

  const handleBulkMarkPaid = async () => {
    if (!centerId || !userId || selected.size === 0) return;
    const firstAmount = students.find(s => selected.has(s.id))?.monthly_fee || 0;
    const amount = paymentModalAmount ? Number(paymentModalAmount) : firstAmount;
    if (amount <= 0) return;
    setIsProcessing(true);

    try {
      const selectedIds = Array.from(selected);
      const paidDate = new Date(paymentModalDate).toISOString();

      await dbUpdate({
        table: 'students',
        data: { payment_status: 'paid', last_paid_date: paidDate },
        filters: [{ column: 'id', op: 'in', value: selectedIds }],
      });

      const paymentRecords = selectedIds.map(id => {
        const student = students.find(s => s.id === id);
        return {
          student_id: id,
          center_id: centerId,
          amount,
          payment_method: paymentModalMethod,
          payment_date: paidDate,
          created_by: userId,
        };
      });
      await dbInsert({ table: 'payments', data: paymentRecords });

      await dbInsert({
        table: 'audit_log',
        data: {
          center_id: centerId,
          user_id: userId,
          action: 'bulk_payment_update',
          entity_type: 'students',
          details: { ids: selectedIds, method: paymentModalMethod, amount },
        },
      });

      setStudents(prev =>
        prev.map(s =>
          selected.has(s.id)
            ? { ...s, payment_status: 'paid', last_paid_date: paidDate, last_payment_method: paymentModalMethod }
            : s
        )
      );

      setSelected(new Set());
      setShowPaymentModal(false);
      setPaymentModalAmount('');
      setPaymentModalDate(new Date().toISOString().slice(0, 10));
      setSuccessMessage(t('confirmed', { count: selectedIds.length }));
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err) {
      console.error('Bulk payment error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExport = () => {
    exportToExcel(filteredStudents);
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('title')}</h1>
            <div className="flex gap-2">
              <button
                onClick={handleExport}
                className="px-4 py-2 text-sm font-medium border border-green-600 text-green-600 dark:text-green-400 rounded-lg hover:bg-green-50 dark:hover:bg-green-950 transition-colors"
              >
                {t('export')}
              </button>
            </div>
          </div>

          {/* Success Message */}
          {successMessage && (
            <div className="mb-4 p-3 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-sm text-center">
              {successMessage}
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-6">
            {/* Status filter tabs */}
            <div className="flex bg-white dark:bg-gray-800 rounded-lg shadow p-1">
              {(['all', 'paid', 'unpaid'] as StatusFilter[]).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    statusFilter === status
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {status === 'all' ? t('filterAll') : status === 'paid' ? t('filterPaid') : t('filterUnpaid')}
                </button>
              ))}
            </div>

            {/* Subject filter */}
            <select
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value)}
              className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm shadow"
            >
              <option value="all">{t('allSubjects')}</option>
              {subjects.map((subject) => (
                <option key={subject} value={subject}>{subject}</option>
              ))}
            </select>

            {/* Group filter */}
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm shadow"
            >
              <option value="all">{t('allGroups')}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            {/* Date range */}
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              placeholder={t('fromDate')}
              className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm shadow"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              placeholder={t('toDate')}
              className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm shadow"
            />
          </div>

          {/* Bulk Actions Bar */}
          {selected.size > 0 && (
            <div className="flex items-center gap-3 mb-4 p-3 bg-indigo-50 dark:bg-indigo-950/50 rounded-lg">
              <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                {t('selected', { count: selected.size })}
              </span>
              <button
                onClick={() => {
                  const first = students.find(s => selected.has(s.id));
                  setPaymentModalAmount(first ? String(first.monthly_fee) : '');
                  setPaymentModalDate(new Date().toISOString().slice(0, 10));
                  setShowPaymentModal(true);
                }}
                className="px-4 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                {t('bulkMarkPaid')}
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              >
                {t('filterAll')}
              </button>
            </div>
          )}

          {/* Quick Select Buttons */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={selectAll}
              className="text-xs px-3 py-1.5 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950 rounded-lg transition-colors"
            >
              {t('selectAll')}
            </button>
            <button
              onClick={selectAllUnpaid}
              className="text-xs px-3 py-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 rounded-lg transition-colors"
            >
              {t('selectAllUnpaid')}
            </button>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="text-center py-16">
              <svg className="animate-spin h-8 w-8 text-indigo-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                      <th className="px-4 py-3 w-10">
                        <input
                          type="checkbox"
                          checked={selected.size === filteredStudents.length && filteredStudents.length > 0}
                          onChange={selectAll}
                          className="w-4 h-4 text-indigo-600 rounded"
                        />
                      </th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('studentName')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('subject')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('status')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('amount')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('lastPaidDate')}</th>
                      <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('paymentMethod')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((student) => (
                      <tr
                        key={student.id}
                        className={`border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 ${
                          selected.has(student.id) ? 'bg-indigo-50 dark:bg-indigo-950/30' : ''
                        }`}
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selected.has(student.id)}
                            onChange={() => toggleSelect(student.id)}
                            className="w-4 h-4 text-indigo-600 rounded"
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{student.name}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{student.subject_name}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                            student.payment_status === 'paid'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                              : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                          }`}>
                            {student.payment_status === 'paid' ? t('filterPaid') : t('filterUnpaid')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{student.monthly_fee}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          {student.last_paid_date
                            ? new Date(student.last_paid_date).toLocaleDateString('ar-EG')
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          {student.last_payment_method ? (PAYMENT_METHODS.find(m => m.value === student.last_payment_method) ? tScan(PAYMENT_METHODS.find(m => m.value === student.last_payment_method)!.key) : student.last_payment_method) : '—'}
                        </td>
                      </tr>
                    ))}
                    {filteredStudents.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                          ---
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mark as Paid Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              {t('bulkMarkPaid')}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('paymentMethod')}</label>
                <select
                  value={paymentModalMethod}
                  onChange={(e) => setPaymentModalMethod(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{tScan(m.key)}</option>
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
                  onChange={(e) => setPaymentModalAmount(e.target.value)}
                  placeholder={String(students.find(s => selected.has(s.id))?.monthly_fee || '')}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('lastPaidDate')}</label>
                <input
                  type="date"
                  value={paymentModalDate}
                  onChange={(e) => setPaymentModalDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleBulkMarkPaid}
                disabled={isProcessing}
                className="flex-1 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {isProcessing ? tCommon('loading') : tCommon('save')}
              </button>
              <button
                onClick={() => setShowPaymentModal(false)}
                className="flex-1 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                {tCommon('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
