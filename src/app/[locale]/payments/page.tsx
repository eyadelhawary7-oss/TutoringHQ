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

  const [students, setStudents] = useState<Student[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [subjects, setSubjects] = useState<string[]>([]);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Bulk action
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

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

      // Load students and subjects table in parallel
      const [studentsRes, subjectsRes] = await Promise.all([
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
      ]);

      if (studentsRes.data) {
        setStudents(studentsRes.data);
      }
      // Merge subjects from subjects table + any subject_name on students
      const subjectTableNames = (subjectsRes.data || []).map((s: { name: string }) => s.name);
      const studentSubjectNames = (studentsRes.data || []).map((s: Student) => s.subject_name).filter(Boolean);
      const allSubjects = [...new Set([...subjectTableNames, ...studentSubjectNames])];
      setSubjects(allSubjects);
      setIsLoading(false);
    };
    load();
  }, []);

  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      if (statusFilter !== 'all' && s.payment_status !== statusFilter) return false;
      if (subjectFilter !== 'all' && s.subject_name !== subjectFilter) return false;
      return true;
    });
  }, [students, statusFilter, subjectFilter]);

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

  const handleBulkMarkPaid = async (method: string) => {
    if (!centerId || !userId || selected.size === 0) return;
    setIsProcessing(true);

    try {
      const selectedIds = Array.from(selected);

      // Update payment status
      await dbUpdate({
        table: 'students',
        data: { payment_status: 'paid', last_paid_date: new Date().toISOString() },
        filters: [{ column: 'id', op: 'in', value: selectedIds }],
      });

      // Create payment records
      const paymentRecords = selectedIds.map(id => {
        const student = students.find(s => s.id === id);
        return {
          student_id: id,
          center_id: centerId,
          amount: student?.monthly_fee || 0,
          payment_method: method,
          payment_date: new Date().toISOString(),
          created_by: userId,
        };
      });
      await dbInsert({ table: 'payments', data: paymentRecords });

      // Audit log
      await dbInsert({
        table: 'audit_log',
        data: {
          center_id: centerId,
          user_id: userId,
          action: 'bulk_payment_update',
          entity_type: 'students',
          details: { ids: selectedIds, method },
        },
      });

      // Update local state
      setStudents(prev =>
        prev.map(s =>
          selected.has(s.id)
            ? { ...s, payment_status: 'paid', last_paid_date: new Date().toISOString() }
            : s
        )
      );

      setSelected(new Set());
      setShowPaymentModal(false);
      setSuccessMessage(t('confirmed', { count: selectedIds.length }));
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err) {
      console.error('Bulk payment error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const [isSendingReminders, setIsSendingReminders] = useState(false);
  const [reminderResult, setReminderResult] = useState<{ sent: number; failed: number } | null>(null);

  const handleSendReminders = async () => {
    if (!centerId) return;
    setIsSendingReminders(true);
    setReminderResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const unpaidIds = selected.size > 0
        ? Array.from(selected).filter(id => students.find(s => s.id === id)?.payment_status === 'unpaid')
        : [];

      const response = await fetch('/api/whatsapp/remind', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          centerId,
          studentIds: unpaidIds.length > 0 ? unpaidIds : undefined,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setReminderResult({ sent: result.sent, failed: result.failed });
        setSuccessMessage(`WhatsApp reminders sent: ${result.sent} success, ${result.failed} failed`);
        setTimeout(() => setSuccessMessage(''), 6000);
      } else {
        setSuccessMessage(result.error || 'Failed to send reminders');
        setTimeout(() => setSuccessMessage(''), 6000);
      }
    } catch (err) {
      console.error('Reminder error:', err);
      setSuccessMessage('Failed to send WhatsApp reminders');
      setTimeout(() => setSuccessMessage(''), 4000);
    } finally {
      setIsSendingReminders(false);
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
                onClick={handleSendReminders}
                disabled={isSendingReminders}
                className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-green-400 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                  <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 01-4.243-1.217l-.271-.162-2.87.853.853-2.87-.162-.271A8 8 0 1112 20z"/>
                </svg>
                {isSendingReminders ? 'Sending...' : 'Send Reminders'}
              </button>
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
              <option value="all">{t('filterBySubject')}</option>
              {subjects.map((subject) => (
                <option key={subject} value={subject}>{subject}</option>
              ))}
            </select>
          </div>

          {/* Bulk Actions Bar */}
          {selected.size > 0 && (
            <div className="flex items-center gap-3 mb-4 p-3 bg-indigo-50 dark:bg-indigo-950/50 rounded-lg">
              <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                {t('selected', { count: selected.size })}
              </span>
              <button
                onClick={() => setShowPaymentModal(true)}
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
                      </tr>
                    ))}
                    {filteredStudents.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
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

      {/* Payment Method Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              {tScan('selectMethod')}
            </h3>
            <div className="space-y-2">
              {PAYMENT_METHODS.map((method) => (
                <button
                  key={method.value}
                  disabled={isProcessing}
                  onClick={() => handleBulkMarkPaid(method.value)}
                  className="w-full py-3 px-4 text-start font-medium rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors disabled:opacity-50"
                >
                  {tScan(method.key)}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowPaymentModal(false)}
              className="w-full mt-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              {t('filterAll')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
