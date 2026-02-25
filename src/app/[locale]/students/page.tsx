'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, dbDelete, auditLog } from '@/lib/db-proxy';
import QRCode from 'qrcode';
import { toAr } from '@/lib/number-utils';
import { Plus, Search, QrCode, Upload, Users, X, Download, Edit, Trash2, Eye, CreditCard } from 'lucide-react';
import { CardOrderModal } from '@/components/CardOrderModal';
import { QRCard } from '@/components/QRCard';

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
  is_active?: boolean;
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
  const [studentGroupsMap, setStudentGroupsMap] = useState<Record<string, { names: string[]; fees: number[]; subjects: string[]; groupIds: string[] }>>({});
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
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editGroups, setEditGroups] = useState<string[]>([]);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [centerInfo, setCenterInfo] = useState<{ name?: string; logo_url?: string } | null>(null);
  const [showCardOrderModal, setShowCardOrderModal] = useState(false);

  useEffect(() => {
    const loadStudents = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const meRes = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const meData = await meRes.json();

      if (!meData?.user?.center_id) return;
      setCenterId(meData.user.center_id);
      setCenterInfo(meData.user.center ? { name: meData.user.center.name, logo_url: meData.user.center.logo_url } : null);

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
          const map: Record<string, { names: string[]; fees: number[]; subjects: string[]; groupIds: string[] }> = {};
          for (const m of (membersData || []) as { student_id: string; group_id: string }[]) {
            const g = grps.find((x) => x.id === m.group_id);
            if (g) {
              if (!map[m.student_id]) map[m.student_id] = { names: [], fees: [], subjects: [], groupIds: [] };
              map[m.student_id].names.push(g.name);
              map[m.student_id].fees.push(g.fee ?? 0);
              map[m.student_id].groupIds.push(g.id);
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
        const matchName = s.name?.toLowerCase().includes(q);
        const matchNumber = s.student_number?.toUpperCase().includes(q.toUpperCase());
        const matchPhone = (s.phone || '').includes(q);
        if (!matchName && !matchNumber && !matchPhone) return false;
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
    const logoHtml = centerInfo?.logo_url
      ? `<img src="${esc(centerInfo.logo_url)}" alt="" style="height:7mm;width:auto;max-width:12mm;object-fit:contain" />`
      : '<div style="height:7mm;width:7mm;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:4px;font-weight:800">CH</div>';
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <!DOCTYPE html><html dir="ltr">
      <head>
        <meta charset="utf-8">
        <style>
          body { margin: 0; padding: 10mm; font-family: system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .card { width: 85.6mm; height: 54mm; background: linear-gradient(135deg, #0D9488 0%, #1E293B 100%); position: relative; overflow: hidden; color: white; }
          .top-bar { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: space-between; padding: 2.5mm 3mm; background: rgba(0,0,0,0.35); }
          .center-name { font-size: 9px; font-weight: 500; opacity: 0.9; }
          .center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
          .qr-wrap { width: 25mm; height: 25mm; background: #fff; border-radius: 8px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
          .qr-wrap img { width: 20mm; height: 20mm; }
          .name { font-size: 14px; font-weight: bold; margin-top: 2.5mm; text-align: center; }
          .num { font-size: 10px; opacity: 0.7; margin-top: 0.5mm; font-family: monospace; }
          .bottom { position: absolute; bottom: 0; left: 0; right: 0; padding: 1.5mm; border-top: 1px solid rgba(255,255,255,0.2); text-align: center; font-size: 7px; opacity: 0.3; font-family: monospace; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="top-bar">${logoHtml}<span class="center-name">${esc(centerInfo?.name || 'CenterHQ')}</span></div>
          <div class="center">
            <div class="qr-wrap"><img src="${qrDataUrl}" alt="QR" /></div>
            <div class="name">${esc(qrModalStudent.name)}</div>
            <div class="num">${esc(qrModalStudent.student_number || '')}</div>
          </div>
          <div class="bottom">CenterHQ</div>
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

  const openEdit = (s: Student) => {
    setEditStudent(s);
    setEditName(s.name || '');
    setEditPhone(s.phone || '');
    setEditGroups(studentGroupsMap[s.id]?.groupIds ?? []);
  };

  const saveEdit = async () => {
    if (!editStudent || !centerId) return;
    setIsSavingEdit(true);
    try {
      await dbUpdate({
        table: 'students',
        data: { name: editName.trim(), phone: editPhone.trim() || null },
        filters: [{ column: 'id', op: 'eq', value: editStudent.id }],
      });
      await dbDelete({ table: 'student_group_members', filters: [{ column: 'student_id', op: 'eq', value: editStudent.id }] });
      for (const gid of editGroups) {
        await dbInsert({ table: 'student_group_members', data: { student_id: editStudent.id, group_id: gid }, select: false });
      }
      const updatedGroups = groups.filter((g) => editGroups.includes(g.id));
      setStudentGroupsMap((prev) => ({
        ...prev,
        [editStudent.id]: {
          names: updatedGroups.map((g) => g.name),
          fees: updatedGroups.map((g) => g.fee ?? 0),
          subjects: [...new Set(updatedGroups.map((g) => g.subject).filter(Boolean))] as string[],
          groupIds: editGroups,
        },
      }));
      setStudents((prev) =>
        prev.map((s) => (s.id === editStudent.id ? { ...s, name: editName.trim(), phone: editPhone.trim() } : s))
      );
      setEditStudent(null);
    } catch (err) {
      console.error('Edit student error:', err);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteStudent = async (student: Student) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
    const meData = await meRes.json();
    const cid = meData?.user?.center_id;
    const userId = meData?.user?.id;
    if (!cid || !userId) return;
    try {
      await dbDelete({ table: 'student_group_members', filters: [{ column: 'student_id', op: 'eq', value: student.id }] });
      await dbDelete({ table: 'attendance_scans', filters: [{ column: 'student_id', op: 'eq', value: student.id }] });
      await dbDelete({ table: 'payments', filters: [{ column: 'student_id', op: 'eq', value: student.id }] });
      const { error } = await dbDelete({ table: 'students', filters: [{ column: 'id', op: 'eq', value: student.id }] });
      if (!error) {
        setStudents((prev) => prev.filter((s) => s.id !== student.id));
        await auditLog({ centerId: cid, userId, action: 'student_delete', entityType: 'students', entityId: student.id, details: { name: student.name } });
      }
    } catch (err) {
      console.error('Delete student error:', err);
    }
  };

  const activeCount = useMemo(() => students.filter((s) => s.is_active !== false).length, [students]);

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
      const studentNumber = (student as Student).student_number ?? '';
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
            groupIds: [addedGroup.id],
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
      <div className="p-4 md:p-6 space-y-5 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-foreground">{t('title')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{students.length} {tCommon('students')}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/students/import"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              <Upload size={14} /> {t('import')}
            </Link>
            <button
              onClick={() => setShowCardOrderModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            <Link
              href="/students/print"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              <QrCode size={14} /> {t('printQr')}
            </Link>
            >
              <CreditCard size={14} /> {t('orderIdCards', { defaultValue: 'Order ID Cards' })}
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
              style={{ background: 'hsl(var(--primary))' }}
            >
              <Plus size={14} /> {t('addStudent')}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="w-full ps-9 pe-4 py-2.5 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            dir="auto"
          />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="ch-card p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))' }}>
              <Users size={18} />
            </div>
            <div>
              <div className="text-xl font-black font-mono">{students.length}</div>
              <div className="text-xs text-muted-foreground">{t('totalStudents')}</div>
            </div>
          </div>
          <div className="ch-card p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#16A34A18', color: '#16A34A' }}>
              <Users size={18} />
            </div>
            <div>
              <div className="text-xl font-black font-mono">{activeCount}</div>
              <div className="text-xs text-muted-foreground">{t('activeStudents')}</div>
            </div>
          </div>
        </div>

        {addSuccess && (
          <div className="p-4 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800 rounded-lg flex items-center justify-between gap-4">
            <p className="font-medium">{t('addStudentSuccess', { name: addSuccess.name, studentNumber: addSuccess.studentNumber })}</p>
            {addSuccess.qrDataUrl && <img src={addSuccess.qrDataUrl} alt="QR" className="w-16 h-16" />}
            <button onClick={() => setAddSuccess(null)} className="text-green-700 dark:text-green-400 hover:underline text-sm">{tCommon('cancel')}</button>
          </div>
        )}
        {generateSuccess && (
          <div className="p-4 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="font-medium">{generateSuccess}</p>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-16">
            <svg className="animate-spin h-8 w-8 text-primary mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        ) : students.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Users size={40} className="mx-auto mb-3 opacity-30" />
            <p>{t('noStudents')}</p>
            <div className="flex justify-center gap-3 mt-4">
              <button onClick={() => setShowAddModal(true)} className="px-6 py-3 text-white rounded-lg" style={{ background: 'hsl(var(--primary))' }}>
                {t('addStudent')}
              </button>
              <Link href="/students/import" className="px-6 py-3 border border-border text-foreground rounded-lg hover:bg-muted">
                {t('import')}
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* Table desktop */}
            <div className="hidden md:block ch-card overflow-hidden">
              <table className="w-full text-sm">
                <thead style={{ background: 'hsl(var(--muted))' }}>
                  <tr>
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('name')}</th>
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">{t('studentNumber')}</th>
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('phone')}</th>
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">{t('groups')}</th>
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('status')}</th>
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">{t('balance')}</th>
                    <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map((s) => {
                    const bal = balanceByStudent[s.id] ?? 0;
                    const isActive = s.is_active !== false;
                    return (
                      <tr key={s.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-foreground">{s.name}</td>
                        <td className="px-4 py-3 font-mono text-muted-foreground text-xs">{s.student_number || ''}</td>
                        <td className="px-4 py-3 font-mono text-muted-foreground" dir="ltr">{s.phone || ''}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(studentGroupsMap[s.id]?.names ?? []).slice(0, 2).map((n, i) => (
                              <span key={i} className="px-2 py-0.5 rounded-full text-xs font-medium border border-border text-muted-foreground">{n}</span>
                            ))}
                            {(studentGroupsMap[s.id]?.names ?? []).length > 2 && (
                              <span className="text-xs text-muted-foreground">+{(studentGroupsMap[s.id]?.names ?? []).length - 2}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={isActive ? 'badge-confirmed' : 'badge-late'}>
                            {isActive ? tCommon('active') : tCommon('inactive')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {bal > 0 ? (
                            <span className="font-mono font-bold text-red-600 text-sm">{locale === 'ar' ? toAr(Math.round(bal)) : Math.round(bal).toLocaleString()} {tCommon('egp')}</span>
                          ) : (
                            <span className="text-muted-foreground">&mdash;</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button onClick={() => openEdit(s)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground" title={tCommon('edit')}><Edit size={14} /></button>
                            <button onClick={() => openQRModal(s)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground" title={t('viewQR')}><Eye size={14} /></button>
                            <button onClick={() => setDeleteTarget(s)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title={tCommon('delete')}><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {filteredStudents.map((s) => {
                const bal = balanceByStudent[s.id] ?? 0;
                return (
                  <div key={s.id} className="ch-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{s.name}</span>
                          {bal > 0 && (
                            <span className="text-xs font-bold text-red-600 font-mono">{locale === 'ar' ? toAr(Math.round(bal)) : Math.round(bal).toLocaleString()} {tCommon('egp')}</span>
                          )}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground mt-0.5">{s.student_number || ''}</div>
                        {s.phone && <div className="font-mono text-xs text-muted-foreground" dir="ltr">{s.phone}</div>}
                        <div className="flex flex-wrap gap-1 mt-2">
                          {(studentGroupsMap[s.id]?.names ?? []).map((n, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-full text-xs border border-border text-muted-foreground">{n}</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(s)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><Edit size={14} /></button>
                        <button onClick={() => openQRModal(s)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><Eye size={14} /></button>
                        <button onClick={() => setDeleteTarget(s)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {filteredStudents.length === 0 && students.length > 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Users size={40} className="mx-auto mb-3 opacity-30" />
            <p>{t('noStudents')}</p>
          </div>
        )}
      </div>

      {/* Add Student Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddModal(false)}>
          <div className="bg-card rounded-2xl border border-border p-6 max-w-sm mx-4 w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-foreground">{t('addStudent')}</h3>
              <button onClick={() => setShowAddModal(false)}><X size={18} className="text-muted-foreground" /></button>
            </div>
            <form onSubmit={handleAddStudent} className="space-y-3">
              {addError && <p className="text-sm text-destructive">{addError}</p>}
              <input value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} placeholder={t('studentName')} className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm" required />
              <input value={addForm.phone} onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))} placeholder={tCommon('phone')} type="tel" dir="ltr" className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm" />
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t('groupRequired')}</label>
                <select value={addForm.groupId} onChange={(e) => { const gId = e.target.value; const g = groups.find((gr) => gr.id === gId); setAddForm((f) => ({ ...f, groupId: gId, subjectId: g ? subjects.find((s) => s.name === g.subject)?.id ?? '' : '', monthlyFee: g?.fee != null ? String(g.fee) : '' })); }} className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm" required>
                  <option value="">{tCommon('select')}</option>
                  {groups.map((g) => (<option key={g.id} value={g.id}>{g.name} {g.fee != null ? `(EGP ${g.fee})` : ''}</option>))}
                </select>
              </div>
              <p className="text-xs text-muted-foreground">{t('autoGenerateNumber')}</p>
              <div className="flex gap-2 justify-end mt-4">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 rounded-lg text-sm border border-border">{tCommon('cancel')}</button>
                <button type="submit" disabled={isAdding} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'hsl(var(--primary))' }}>{isAdding ? tCommon('loading') : tCommon('save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Student Modal */}
      {editStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditStudent(null)}>
          <div className="bg-card rounded-2xl border border-border p-6 max-w-sm mx-4 w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-foreground">{tCommon('edit')}</h3>
              <button onClick={() => setEditStudent(null)}><X size={18} className="text-muted-foreground" /></button>
            </div>
            <div className="space-y-3">
              <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t('studentName')} className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm" />
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder={tCommon('phone')} type="tel" dir="ltr" className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm" />
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t('assignGroups')}</label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {groups.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer">
                      <input type="checkbox" checked={editGroups.includes(g.id)} onChange={(e) => setEditGroups((prev) => e.target.checked ? [...prev, g.id] : prev.filter((x) => x !== g.id))} className="rounded accent-primary" />
                      <span className="text-sm text-foreground">{g.name}</span>
                      <span className="text-xs text-muted-foreground ms-auto">{g.subject}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setEditStudent(null)} className="px-4 py-2 rounded-lg text-sm border border-border">{tCommon('cancel')}</button>
              <button onClick={saveEdit} disabled={isSavingEdit} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'hsl(var(--primary))' }}>{isSavingEdit ? tCommon('loading') : tCommon('save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteTarget(null)}>
          <div className="bg-card rounded-2xl border border-border p-6 max-w-sm mx-4 w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-foreground text-lg mb-2">{t('deleteStudent')}</h3>
            <p className="text-sm text-muted-foreground mb-3">{t('deleteStudentConfirm')}</p>
            <p className="font-medium text-foreground mb-5">{deleteTarget.name}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 rounded-lg text-sm border border-border">{tCommon('cancel')}</button>
              <button onClick={() => { if (deleteTarget) { handleDeleteStudent(deleteTarget); setDeleteTarget(null); } }} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-destructive hover:bg-destructive/90">{tCommon('delete')}</button>
            </div>
          </div>
        </div>
      )}

      {/* View QR Modal -- Professional ID Card */}
      {qrModalStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={() => { setQrModalStudent(null); setQrDataUrl(null); }}>
          <div className="bg-card rounded-2xl border border-border p-6 max-w-sm mx-4 w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-foreground">{t('viewQR')}</h3>
              <button onClick={() => { setQrModalStudent(null); setQrDataUrl(null); }} className="p-1.5 rounded-lg hover:bg-muted"><X size={18} className="text-muted-foreground" /></button>
            </div>
            {/* Professional ID card */}
            <div className="flex justify-center mb-5">
              <div className="w-full max-w-[320px] rounded-2xl overflow-hidden shadow-xl">
                <QRCard
                  student={qrModalStudent}
                  qrDataUrl={qrDataUrl}
                  centerLogo={centerInfo?.logo_url ?? null}
                  centerName={centerInfo?.name ?? 'CenterHQ'}
                  scale={1.2}
                />
              </div>
            </div>
            {/* Student details below card */}
            <div className="text-center mb-4">
              <div className="font-bold text-foreground">{qrModalStudent.name}</div>
              <div className="font-mono text-sm text-muted-foreground">{qrModalStudent.student_number || ''}</div>
              {(balanceByStudent[qrModalStudent.id] ?? 0) > 0 && (
                <div className="mt-2 text-sm font-bold text-red-600">
                  {t('balance')}: {locale === 'ar' ? toAr(Math.round(balanceByStudent[qrModalStudent.id]!)) : Math.round(balanceByStudent[qrModalStudent.id]!).toLocaleString()} {tCommon('egp')}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={downloadQR} disabled={!qrDataUrl} className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium border border-border hover:bg-muted transition-colors disabled:opacity-50">
                <Download size={14} /> {tCommon('download')}
              </button>
              <button onClick={printCard} disabled={!qrDataUrl} className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-colors disabled:opacity-50" style={{ background: 'hsl(var(--primary))' }}>
                <QrCode size={14} /> {tCommon('print')}
              </button>
            </div>
            {qrDataUrl && <button onClick={handleRegenerateQR} className="mt-3 w-full py-1 text-xs text-amber-500 hover:underline">{t('regenerateQR')}</button>}
          </div>
        </div>
      )}

      {/* Order ID Cards Modal */}
      {centerId && (
        <CardOrderModal
          isOpen={showCardOrderModal}
          onClose={() => setShowCardOrderModal(false)}
          students={students}
          centerId={centerId}
          centerInfo={centerInfo}
        />
      )}
    </>
  );
}
