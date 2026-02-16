'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, dbDelete, auditLog } from '@/lib/db-proxy';
import Navbar from '@/components/Navbar';
import QRCode from 'qrcode';
import { toAr } from '@/lib/number-utils';

interface Student {
  id: string;
  name: string;
  phone: string;
  parent_phone: string;
  subject: string;
  fee: number;
  payment_status: string;
  student_number?: string;
  qr_code?: string | null;
}

interface Subject {
  id: string;
  name: string;
}

interface Group {
  id: string;
  name: string;
  subject: string | null;
  fee?: number;
}

type SortBy = 'name' | 'balance';

export default function StudentsPage() {
  const t = useTranslations('students');
  const tCommon = useTranslations('common');
  const locale = useLocale();

  const [students, setStudents] = useState<Student[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [studentGroupsMap, setStudentGroupsMap] = useState<Record<string, { names: string[]; fees: number[]; subjects: string[] }>>({});
  const [balanceByStudent, setBalanceByStudent] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    name: '',
    phone: '',
    parentPhone: '',
    subjectId: '',
    monthlyFee: '',
    groupId: '',
  });
  const [addError, setAddError] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addSuccess, setAddSuccess] = useState<{ name: string; studentNumber: string; qrDataUrl?: string } | null>(null);
  const [generateSuccess, setGenerateSuccess] = useState<string | null>(null);
  const [qrModalStudent, setQrModalStudent] = useState<Student | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [generateProgress, setGenerateProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    const loadStudents = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const meRes = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const meData = await meRes.json();

      if (!meData?.user?.center_id) return;

      const { data } = await dbSelect({
        table: 'students',
        select: '*',
        filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
        order: { column: 'name' },
      });

      if (data) setStudents(data as Student[]);
      setIsLoading(false);
    };

    loadStudents();
  }, []);

  useEffect(() => {
    if (groups.length === 0) return;
    const loadBalanceData = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
      const meData = await meRes.json();
      if (!meData?.user?.center_id) return;
      const cid = meData.user.center_id;

      const [scansRes, paymentsRes] = await Promise.all([
        dbSelect({
          table: 'attendance_scans',
          select: 'student_id, group_id',
          filters: [{ column: 'center_id', op: 'eq', value: cid }],
        }),
        dbSelect({
          table: 'payments',
          select: 'student_id, amount, confirmed',
          filters: [{ column: 'center_id', op: 'eq', value: cid }],
        }),
      ]);
      const scans = (scansRes.data || []) as { student_id: string; group_id: string | null }[];
      const payments = (paymentsRes.data || []) as { student_id: string; amount: number; confirmed?: boolean }[];

      const groupFeeMap = new Map(groups.map((g) => [g.id, g.fee ?? 0]));
      const owedByStudent: Record<string, number> = {};
      for (const s of scans) {
        if (s.group_id && groupFeeMap.has(s.group_id)) {
          const key = `${s.student_id}:${s.group_id}`;
          owedByStudent[key] = (owedByStudent[key] ?? 0) + 1;
        }
      }
      const totalOwedByStudent: Record<string, number> = {};
      for (const [key, count] of Object.entries(owedByStudent)) {
        const [sid, gid] = key.split(':');
        const fee = groupFeeMap.get(gid) ?? 0;
        totalOwedByStudent[sid] = (totalOwedByStudent[sid] ?? 0) + count * fee;
      }
      const paidByStudent: Record<string, number> = {};
      for (const p of payments) {
        if (p.confirmed === true) {
          paidByStudent[p.student_id] = (paidByStudent[p.student_id] ?? 0) + parseFloat(String(p.amount ?? 0));
        }
      }
      const balance: Record<string, number> = {};
      const allIds = new Set([...Object.keys(totalOwedByStudent), ...Object.keys(paidByStudent)]);
      for (const sid of allIds) {
        const owed = totalOwedByStudent[sid] ?? 0;
        const paid = paidByStudent[sid] ?? 0;
        balance[sid] = Math.max(0, owed - paid);
      }
      setBalanceByStudent(balance);
    };
    loadBalanceData();
  }, [groups]);

  useEffect(() => {
    const loadSubjectsAndGroups = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
      const meData = await meRes.json();
      if (!meData?.user?.center_id) return;
      const [subRes, grpRes] = await Promise.all([
        dbSelect({ table: 'subjects', select: 'id, name', filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }], order: { column: 'name' } }),
        dbSelect({ table: 'student_groups', select: 'id, name, subject, fee', filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }], order: { column: 'name' } }),
      ]);
      if (subRes.data) setSubjects(subRes.data as Subject[]);
      if (grpRes.data) {
        const grps = grpRes.data as Group[];
        setGroups(grps);
        const groupIds = grps.map((g) => g.id);
        if (groupIds.length > 0) {
          const { data: membersData } = await dbSelect({
            table: 'student_group_members',
            select: 'student_id, group_id',
            filters: [{ column: 'group_id', op: 'in', value: groupIds }],
          });
          const map: Record<string, { names: string[]; fees: number[]; subjects: string[] }> = {};
          for (const m of (membersData || []) as { student_id: string; group_id: string }[]) {
            const g = grps.find((x) => x.id === m.group_id);
            if (g) {
              if (!map[m.student_id]) map[m.student_id] = { names: [], fees: [], subjects: [] };
              map[m.student_id].names.push(g.name);
              map[m.student_id].fees.push(g.fee ?? 0);
              if (g.subject && !map[m.student_id].subjects.includes(g.subject)) {
                map[m.student_id].subjects.push(g.subject);
              }
            }
          }
          setStudentGroupsMap(map);
        }
      }
    };
    loadSubjectsAndGroups();
  }, []);

  const distinctSubjects = useMemo(() => {
    const subs = new Set<string>();
    for (const g of groups) {
      if (g.subject) subs.add(g.subject);
    }
    return Array.from(subs).sort();
  }, [groups]);

  const subjectCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of students) {
      const subs = studentGroupsMap[s.id]?.subjects ?? [];
      for (const sub of subs) {
        counts[sub] = (counts[sub] ?? 0) + 1;
      }
    }
    return counts;
  }, [students, studentGroupsMap]);

  const filteredStudents = useMemo(() => {
    let list = students.filter((s) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        if (!(s.name && s.name.toLowerCase().includes(q)) &&
            !(s.student_number && s.student_number.toUpperCase().includes(q.toUpperCase()))) {
          return false;
        }
      }
      if (subjectFilter) {
        const subs = studentGroupsMap[s.id]?.subjects ?? [];
        if (!subs.includes(subjectFilter)) return false;
      }
      return true;
    });
    if (sortBy === 'name') {
      list = [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else {
      list = [...list].sort((a, b) => (balanceByStudent[b.id] ?? 0) - (balanceByStudent[a.id] ?? 0));
    }
    return list;
  }, [students, searchQuery, subjectFilter, sortBy, studentGroupsMap, balanceByStudent]);

  const openQRModal = async (student: Student) => {
    setQrModalStudent(student);
    setQrDataUrl(null);
    try {
      let dataUrl = student.qr_code;
      if (!dataUrl) {
        dataUrl = await QRCode.toDataURL(student.id, {
          width: 300,
          margin: 2,
          color: { dark: '#000000', light: '#FFFFFF' },
        });
        await dbUpdate({
          table: 'students',
          data: { qr_code: dataUrl },
          filters: [{ column: 'id', op: 'eq', value: student.id }],
        });
        setStudents((prev) =>
          prev.map((s) => (s.id === student.id ? { ...s, qr_code: dataUrl } : s))
        );
      }
      setQrDataUrl(dataUrl);
    } catch (err) {
      console.error('QR generation error:', err);
    }
  };

  const handleRegenerateQR = async () => {
    if (!qrModalStudent || !confirm(t('regenerateQRConfirm', { defaultValue: 'This will invalidate the printed card. Are you sure?' }))) return;
    try {
      const dataUrl = await QRCode.toDataURL(qrModalStudent.id, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' },
      });
      await dbUpdate({
        table: 'students',
        data: { qr_code: dataUrl },
        filters: [{ column: 'id', op: 'eq', value: qrModalStudent.id }],
      });
      setStudents((prev) =>
        prev.map((s) => (s.id === qrModalStudent.id ? { ...s, qr_code: dataUrl } : s))
      );
      setQrDataUrl(dataUrl);
    } catch (err) {
      console.error('QR regenerate error:', err);
    }
  };

  const downloadQR = () => {
    if (!qrDataUrl || !qrModalStudent) return;
    const link = document.createElement('a');
    link.download = `QR-${qrModalStudent.name}-${qrModalStudent.student_number || qrModalStudent.id}.png`;
    link.href = qrDataUrl;
    link.click();
  };

  const printCard = () => {
    if (!qrDataUrl || !qrModalStudent) return;
    const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html dir='rtl'>
      <head>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@600&display=swap');
          body { font-family: 'Cairo', sans-serif; }
          .card {
            width: 90mm; height: 55mm;
            border: 1px solid #ccc; border-radius: 8px;
            display: flex; align-items: center; justify-content: center;
            gap: 12px; padding: 8px; direction: rtl;
          }
          .info { text-align: center; }
          .name { font-size: 16px; font-weight: bold; }
          .subject { font-size: 12px; color: #666; }
          .id { font-size: 11px; color: #999; }
          img { width: 40mm; height: 40mm; }
          @media print { body { margin: 0; } }
        </style>
      </head>
      <body>
        <div class='card'>
          <img src='${qrDataUrl}' alt='QR' />
          <div class='info'>
            <div class='name'>${esc(qrModalStudent.name)}</div>
            <div class='subject'>${esc(qrModalStudent.subject)}</div>
            <div class='id'>${esc(qrModalStudent.student_number || '')}</div>
          </div>
        </div>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const handleGenerateAllQR = async () => {
    const needQR = students.filter((s) => !s.qr_code);
    if (needQR.length === 0) {
      setGenerateSuccess(t('allStudentsHaveQR', { defaultValue: 'All students already have QR codes' }));
      setTimeout(() => setGenerateSuccess(null), 3000);
      return;
    }
    setIsGeneratingAll(true);
    setGenerateProgress({ current: 0, total: needQR.length });
    try {
      for (let i = 0; i < needQR.length; i++) {
        const student = needQR[i];
        setGenerateProgress({ current: i + 1, total: needQR.length });
        const dataUrl = await QRCode.toDataURL(student.id, {
          width: 300,
          margin: 2,
          color: { dark: '#000000', light: '#FFFFFF' },
        });
        await dbUpdate({
          table: 'students',
          data: { qr_code: dataUrl },
          filters: [{ column: 'id', op: 'eq', value: student.id }],
        });
        setStudents((prev) =>
          prev.map((s) => (s.id === student.id ? { ...s, qr_code: dataUrl } : s))
        );
      }
      setGenerateSuccess(t('qrGeneratedNew', { count: needQR.length, defaultValue: `Generating QR codes for ${needQR.length} new students...` }));
      setTimeout(() => setGenerateSuccess(null), 4000);
    } catch (err) {
      console.error('Bulk QR error:', err);
    } finally {
      setIsGeneratingAll(false);
      setGenerateProgress({ current: 0, total: 0 });
    }
  };

  const handleDeleteStudent = async (student: Student) => {
    if (!confirm(t('deleteStudentConfirm', { defaultValue: 'Are you sure you want to delete this student?' }))) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
    const meData = await meRes.json();
    const centerId = meData?.user?.center_id;
    const userId = meData?.user?.id;
    if (!centerId || !userId) return;
    try {
      await dbDelete({ table: 'student_group_members', filters: [{ column: 'student_id', op: 'eq', value: student.id }] });
      await dbDelete({ table: 'attendance_scans', filters: [{ column: 'student_id', op: 'eq', value: student.id }] });
      await dbDelete({ table: 'payments', filters: [{ column: 'student_id', op: 'eq', value: student.id }] });
      const { error } = await dbDelete({ table: 'students', filters: [{ column: 'id', op: 'eq', value: student.id }] });
      if (!error) {
        setStudents((prev) => prev.filter((s) => s.id !== student.id));
        await auditLog({ centerId, userId, action: 'student_delete', entityType: 'students', entityId: student.id, details: { name: student.name } });
      }
    } catch (err) {
      console.error('Delete student error:', err);
    }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
    const meData = await meRes.json();
    const centerId = meData?.user?.center_id;
    const userId = meData?.user?.id;
    if (!centerId || !userId || !addForm.name.trim()) {
      setAddError(t('nameRequired', { defaultValue: 'Name is required' }));
      return;
    }
    if (!addForm.groupId) {
      setAddError(t('groupRequiredError'));
      return;
    }
    setIsAdding(true);
    try {
      const selectedGroup = groups.find((g) => g.id === addForm.groupId);
      const subjectValue = selectedGroup?.subject ?? subjects.find((s) => s.id === addForm.subjectId)?.name ?? null;
      const insertPayload = {
        center_id: centerId,
        name: addForm.name.trim(),
        phone: addForm.phone.trim() || null,
        parent_phone: addForm.parentPhone.trim() || null,
        subject: subjectValue,
        fee: Number(addForm.monthlyFee) || (selectedGroup?.fee ?? 0),
        payment_status: 'unpaid',
      };
      const { data: inserted, error } = await dbInsert({
        table: 'students',
        data: insertPayload,
        select: '*',
      });
      if (error) {
        const errMsg = typeof error === 'object' && error !== null && 'message' in error
          ? (error as { message: string }).message
          : String(error);
        console.error('[AddStudent] Supabase insert failed:', errMsg, insertPayload);
        throw new Error(errMsg);
      }
      const student = Array.isArray(inserted) ? inserted[0] : inserted;
      if (!student?.id) throw new Error('Insert failed');
      const studentNumber = (student as Student).student_number ?? '—';
      let qrDataURL: string | undefined;
      try {
        qrDataURL = await QRCode.toDataURL(student.id, { width: 300, margin: 2, errorCorrectionLevel: 'H' });
        await dbUpdate({ table: 'students', data: { qr_code: qrDataURL }, filters: [{ column: 'id', op: 'eq', value: student.id }] });
      } catch {}
      if (addForm.groupId) {
        await dbInsert({
          table: 'student_group_members',
          data: { group_id: addForm.groupId, student_id: student.id },
          select: false,
        });
      }
      await auditLog({ centerId, userId, action: 'student_create', entityType: 'students', entityId: student.id, details: { name: addForm.name, student_number: studentNumber } });
      const addedGroup = groups.find((g) => g.id === addForm.groupId);
      if (addedGroup) {
        setStudentGroupsMap((prev) => ({
          ...prev,
          [student.id]: {
            names: [addedGroup.name],
            fees: [addedGroup.fee ?? 0],
            subjects: addedGroup.subject ? [addedGroup.subject] : [],
          },
        }));
      }
      setStudents((prev) => [{ ...student, student_number: studentNumber } as Student, ...prev]);
      setAddSuccess({ name: addForm.name.trim(), studentNumber, qrDataUrl: qrDataURL });
      setAddForm({ name: '', phone: '', parentPhone: '', subjectId: '', monthlyFee: '', groupId: '' });
      setShowAddModal(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : (typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: string }).message) : 'Failed to add student');
      setAddError(msg);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {t('title')}
            </h1>
            <div className="flex flex-wrap gap-3">
              <input
                type="text"
                placeholder={t('searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm min-w-[180px]"
                dir="auto"
              />
              <button
                onClick={handleGenerateAllQR}
                disabled={isGeneratingAll}
                className="px-4 py-2 text-sm font-medium border border-indigo-600 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors disabled:opacity-50"
              >
                {isGeneratingAll
                  ? t('generatingQRNew', { current: generateProgress.current, total: generateProgress.total, defaultValue: `Generating QR codes for ${generateProgress.current}/${generateProgress.total} new students...` })
                  : t('generateAllQR')}
              </button>
              <Link
                href="/students/print"
                className="px-4 py-2 text-sm font-medium border border-indigo-600 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors"
              >
                {t('printCards')}
              </Link>
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                {t('addStudent')}
              </button>
              <Link
                href="/students/import"
                className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                {t('importStudents')}
              </Link>
            </div>
          </div>

          {addSuccess && (
            <div className="mb-4 p-4 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded-lg flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">{t('addStudentSuccess', { name: addSuccess.name, studentNumber: addSuccess.studentNumber })}</p>
              </div>
              {addSuccess.qrDataUrl && (
                <img src={addSuccess.qrDataUrl} alt="QR" className="w-16 h-16" />
              )}
              <button onClick={() => setAddSuccess(null)} className="text-green-600 dark:text-green-400 hover:underline text-sm">
                {tCommon('cancel')}
              </button>
            </div>
          )}
          {generateSuccess && (
            <div className="mb-4 p-4 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded-lg">
              <p className="font-medium">{generateSuccess}</p>
            </div>
          )}

          {!isLoading && students.length > 0 && (
            <div className="space-y-3 mb-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">{t('sort')}</span>
                <button
                  type="button"
                  onClick={() => setSortBy('name')}
                  className={`px-4 py-2 text-sm font-medium rounded-full transition-colors ${
                    sortBy === 'name'
                      ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {t('sortName')}
                </button>
                <button
                  type="button"
                  onClick={() => setSortBy('balance')}
                  className={`px-4 py-2 text-sm font-medium rounded-full transition-colors ${
                    sortBy === 'balance'
                      ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {t('sortBalance')}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSubjectFilter(null)}
                  className={`px-4 py-2 text-sm font-medium rounded-full transition-colors ${
                    subjectFilter === null
                      ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {t('filterAll')} ({students.length})
                </button>
                {distinctSubjects.map((sub) => (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => setSubjectFilter(subjectFilter === sub ? null : sub)}
                    className={`px-4 py-2 text-sm font-medium rounded-full transition-colors ${
                      subjectFilter === sub
                        ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {sub} ({subjectCounts[sub] ?? 0})
                  </button>
                ))}
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-16">
              <svg className="animate-spin h-8 w-8 text-indigo-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : students.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 mx-auto bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <p className="text-gray-600 dark:text-gray-400 mb-4">{t('noStudents')}</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors inline-block"
              >
                {t('addStudent')}
              </button>
              <Link
                href="/students/import"
                className="ml-3 px-6 py-3 border border-indigo-600 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors inline-block"
              >
                {t('importStudents')}
              </Link>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('studentId')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('name')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('phone')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('subject')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('feePerLesson')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{t('balance')}</th>
                      <th className="px-4 py-3 text-start text-sm font-medium italic text-gray-500 dark:text-gray-400">{tCommon('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((student) => (
                      <tr key={student.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <td className="px-4 py-3 font-mono italic text-gray-600 dark:text-gray-400" dir="ltr">{student.student_number || '—'}</td>
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{student.name}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400" dir="ltr">{student.phone}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          {studentGroupsMap[student.id]?.names?.length
                            ? studentGroupsMap[student.id].names.join(', ')
                            : student.subject || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          {studentGroupsMap[student.id]?.fees?.length
                            ? studentGroupsMap[student.id].fees.length > 1
                              ? <span className="italic">{t('multiple', { defaultValue: 'Multiple' })}</span>
                              : studentGroupsMap[student.id].fees[0]
                            : student.fee ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          {(() => {
                            const bal = balanceByStudent[student.id] ?? 0;
                            if (bal > 0) {
                              const val = locale === 'ar' ? toAr(Math.round(bal)) : Math.round(bal).toLocaleString();
                              return (
                                <span className="font-mono italic text-red-600 dark:text-red-400 font-medium">
                                  {val} {t('currency')}
                                </span>
                              );
                            }
                            return <span className="text-green-600 dark:text-green-400 font-medium">✓</span>;
                          })()}
                        </td>
                        <td className="px-4 py-3 flex items-center gap-1">
                          <button
                            onClick={() => openQRModal(student)}
                            className="p-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950 rounded-lg transition-colors"
                            title={t('viewQR')}
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
                          </button>
                          <button
                            onClick={() => handleDeleteStudent(student)}
                            className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 rounded-lg transition-colors"
                            title={t('deleteStudent', { defaultValue: 'Delete student' })}
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto" dir="auto">
            <div className="p-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">{t('addStudent')}</h2>
              <form onSubmit={handleAddStudent} className="space-y-4">
                {addError && <p className="text-sm text-red-600 dark:text-red-400">{addError}</p>}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('name')} *</label>
                  <input
                    type="text"
                    value={addForm.name}
                    onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('phone')}</label>
                  <input
                    type="tel"
                    value={addForm.phone}
                    onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('parentPhoneOptional')}</label>
                  <input
                    type="tel"
                    value={addForm.parentPhone}
                    onChange={(e) => setAddForm((f) => ({ ...f, parentPhone: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('groupRequired')}</label>
                  <select
                    value={addForm.groupId}
                    onChange={(e) => {
                      const gId = e.target.value;
                      const g = groups.find((gr) => gr.id === gId);
                      setAddForm((f) => ({
                        ...f,
                        groupId: gId,
                        subjectId: g ? subjects.find((s) => s.name === g.subject)?.id ?? '' : '',
                        monthlyFee: g?.fee != null ? String(g.fee) : '',
                      }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                    required
                  >
                    <option value="">{tCommon('select')}</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name} {g.fee != null ? `(EGP ${g.fee})` : ''}</option>
                    ))}
                  </select>
                </div>
                {addForm.groupId && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('subject')}</label>
                      <input
                        type="text"
                        readOnly
                        value={groups.find((g) => g.id === addForm.groupId)?.subject ?? ''}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-100 dark:bg-gray-800 dark:text-white bg-gray-50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('feePerLesson')}</label>
                      <input
                        type="number"
                        value={addForm.monthlyFee}
                        onChange={(e) => setAddForm((f) => ({ ...f, monthlyFee: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                        min={0}
                        step={0.01}
                      />
                    </div>
                  </>
                )}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 py-2 px-4 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    {tCommon('cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={isAdding}
                    className="flex-1 py-2 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {isAdding ? tCommon('loading') : tCommon('add')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {qrModalStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" dir="rtl">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full overflow-hidden">
            <div className="p-6 text-center">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{qrModalStudent.name}</h2>
              <p className="text-lg text-gray-600 dark:text-gray-400 mb-2" dir="ltr">{qrModalStudent.student_number || '—'}</p>
              <div className="flex justify-center mb-4">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="QR Code" className="w-[200px] h-[200px] min-w-[200px] min-h-[200px]" />
                ) : (
                  <div className="w-[200px] h-[200px] bg-gray-200 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                    <svg className="animate-spin h-8 w-8 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </div>
                )}
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">{qrModalStudent.subject || '—'}</p>
              <div className="flex gap-3">
                <button
                  onClick={downloadQR}
                  disabled={!qrDataUrl}
                  className="flex-1 py-2 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {t('downloadQR')}
                </button>
                <button
                  onClick={printCard}
                  disabled={!qrDataUrl}
                  className="flex-1 py-2 px-4 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                  {t('printCard')}
                </button>
              </div>
              <button
                onClick={() => { setQrModalStudent(null); setQrDataUrl(null); }}
                className="mt-4 w-full py-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-400"
              >
                {tCommon('cancel')}
              </button>
              {qrDataUrl && (
                <button
                  onClick={handleRegenerateQR}
                  className="mt-2 w-full py-1 text-xs text-amber-600 dark:text-amber-400 hover:underline"
                >
                  {t('regenerateQR', { defaultValue: 'Regenerate' })}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
