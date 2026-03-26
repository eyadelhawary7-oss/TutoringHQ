'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, dbDelete, auditLog } from '@/lib/db-proxy';
import QRCode from 'qrcode';
import { toAr } from '@/lib/number-utils';
import { Plus, Search, QrCode, Upload, Users, X, Download, Edit, Trash2, Eye, CreditCard, Printer } from 'lucide-react';
import { CardOrderModal } from '@/components/CardOrderModal';
import { QRCard } from '@/components/QRCard';
import { PrintStatementModal } from '@/components/PrintStatementModal';
import EmptyState from '@/components/empty-states/EmptyState';
import { AtRiskPanel } from '@/components/students/AtRiskPanel';
import { LifecycleBadge } from '@/components/students/LifecycleBadge';
import { SwipeRow } from '@/components/students/SwipeRow';
import { FamilyLinkingSection } from '@/components/students/FamilyLinkingSection';
import { useUser } from '@/contexts/UserContext';

interface Student {
  id: string;
  name: string;
  phone: string;
  parent_phone?: string | null;
  parent_consent_given?: boolean;
  parent_pack_opted_in?: boolean;
  subject: string;
  fee: number;
  payment_status: string;
  student_number?: string;
  qr_code?: string | null;
  is_active?: boolean;
  lifecycle_status?: 'enrolled' | 'active' | 'at_risk' | 'inactive' | 'churned';
  sibling_family_id?: string | null;
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

type LifecycleFilter = 'all' | 'active' | 'at_risk' | 'inactive' | 'enrolled' | 'churned';

function matchesLifecycle(
  s: Student,
  f: LifecycleFilter
): boolean {
  if (f === 'all') return true;
  const st = s.lifecycle_status;
  switch (f) {
    case 'active':
      return st === 'active';
    case 'at_risk':
      return st === 'at_risk';
    case 'inactive':
      return st === 'inactive';
    case 'churned':
      return st === 'churned';
    case 'enrolled':
      return st === 'enrolled' || st == null || st === undefined;
    default:
      return true;
  }
}

type StudentStatusLabelKey =
  | 'status_enrolled'
  | 'status_active'
  | 'status_at_risk'
  | 'status_inactive'
  | 'status_churned';

function studentStatusLabelKey(lifecycle: Student['lifecycle_status']): StudentStatusLabelKey {
  const x = lifecycle ?? 'enrolled';
  if (x === 'active') return 'status_active';
  if (x === 'at_risk') return 'status_at_risk';
  if (x === 'inactive') return 'status_inactive';
  if (x === 'churned') return 'status_churned';
  return 'status_enrolled';
}

type FilterLabelKey =
  | 'filter_all'
  | 'filter_active'
  | 'filter_at_risk'
  | 'filter_inactive'
  | 'filter_enrolled'
  | 'filter_churned';

function lifecycleFilterLabelKey(f: LifecycleFilter): FilterLabelKey {
  if (f === 'all') return 'filter_all';
  if (f === 'active') return 'filter_active';
  if (f === 'at_risk') return 'filter_at_risk';
  if (f === 'inactive') return 'filter_inactive';
  if (f === 'enrolled') return 'filter_enrolled';
  return 'filter_churned';
}

export default function StudentsPage() {
  const ts = useTranslations('students');
  const router = useRouter();
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const { user, hasPermission } = useUser();
  const canViewPayments = user?.role === 'owner' || user?.role === 'admin' || hasPermission('can_view_payments');

  const [students, setStudents] = useState<Student[]>([]);
  const [printStudent, setPrintStudent] = useState<{ id: string; name: string } | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [studentGroupsMap, setStudentGroupsMap] = useState<Record<string, { names: string[]; fees: number[]; subjects: string[]; groupIds: string[] }>>({});
  const [balanceByStudent, setBalanceByStudent] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>('all');
  const [filterKey, setFilterKey] = useState(0);
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
  const [editParentPhone, setEditParentPhone] = useState('');
  const [editGroups, setEditGroups] = useState<string[]>([]);
  const [editSiblingFamilyId, setEditSiblingFamilyId] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [centerInfo, setCenterInfo] = useState<{ name?: string; logo_url?: string; phone?: string; delivery_address?: Record<string, unknown>; card_color?: string } | null>(null);
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
      setCenterInfo(meData.user.center ? { name: meData.user.center.name, logo_url: meData.user.center.logo_url, phone: meData.user.center.phone, delivery_address: meData.user.center.delivery_address, card_color: meData.user.center.card_color } : null);

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
      if (!matchesLifecycle(s, lifecycleFilter)) return false;
      return true;
    });
    if (sortBy === 'name') {
      list = [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else {
      list = [...list].sort((a, b) => (balanceByStudent[b.id] ?? 0) - (balanceByStudent[a.id] ?? 0));
    }
    return list;
  }, [students, searchQuery, subjectFilter, lifecycleFilter, sortBy, studentGroupsMap, balanceByStudent]);

  const maxBalanceAcross = useMemo(
    () => Math.max(1, ...students.map((s) => balanceByStudent[s.id] ?? 0)),
    [students, balanceByStudent]
  );

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
    if (!qrModalStudent || !confirm(ts('regenerateQRConfirm', { defaultValue: 'This will invalidate the printed card. Are you sure?' }))) return;
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
      setGenerateSuccess(ts('allStudentsHaveQR', { defaultValue: 'All students already have QR codes' }));
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
      setGenerateSuccess(ts('qrGeneratedNew', { count: needQR.length, defaultValue: `Generating QR codes for ${needQR.length} new students...` }));
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
    setEditParentPhone(s.parent_phone || '');
    setEditGroups(studentGroupsMap[s.id]?.groupIds ?? []);
  };

  function normalizeParentPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('01')) return '+2' + digits;
    if (digits.length === 10 && digits.startsWith('1')) return '+2' + digits;
    if (phone.startsWith('+')) return phone;
    return digits.length >= 10 ? '+2' + digits.slice(-10) : phone;
  }

  const saveEdit = async () => {
    if (!editStudent || !centerId) return;
    setIsSavingEdit(true);
    try {
      const parentPhoneNorm = editParentPhone.trim() ? normalizeParentPhone(editParentPhone.trim()) : null;
      await dbUpdate({
        table: 'students',
        data: {
          name: editName.trim(),
          phone: editPhone.trim() || null,
          parent_phone: parentPhoneNorm,
          sibling_family_id: editSiblingFamilyId,
        },
        filters: [{ column: 'id', op: 'eq', value: editStudent.id }],
      });
      await dbDelete({ table: 'student_group_members', filters: [{ column: 'student_id', op: 'eq', value: editStudent.id }] });
      for (const gid of editGroups) {
        await dbInsert({ table: 'student_group_members', data: { student_id: editStudent.id, group_id: gid }, select: false });
      }
      if (parentPhoneNorm) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          try {
            await fetch('/api/parents/request-consent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({ student_id: editStudent.id, parent_phone: parentPhoneNorm }),
            });
          } catch {}
        }
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
        prev.map((s) =>
          s.id === editStudent.id
            ? { ...s, name: editName.trim(), phone: editPhone.trim(), parent_phone: parentPhoneNorm ?? s.parent_phone, sibling_family_id: editSiblingFamilyId }
            : s
        )
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
      setAddError(ts('nameRequired', { defaultValue: 'Name is required' }));
      return;
    }
    if (!addForm.groupId) {
      setAddError(ts('groupRequiredError'));
      return;
    }
    setIsAdding(true);
    try {
      const selectedGroup = groups.find((g) => g.id === addForm.groupId);
      const subjectValue = selectedGroup?.subject ?? subjects.find((s) => s.id === addForm.subjectId)?.name ?? null;
      // Fee comes from group (groups.fee), not from students table
      const insertPayload = {
        center_id: centerId,
        name: addForm.name.trim(),
        phone: addForm.phone.trim() || null,
        parent_phone: addForm.parentPhone.trim() || null,
        subject: subjectValue,
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
      const parentPhoneNorm = addForm.parentPhone.trim()
        ? (addForm.parentPhone.replace(/\D/g, '').length === 11 && addForm.parentPhone.replace(/\D/g, '').startsWith('01')
          ? '+2' + addForm.parentPhone.replace(/\D/g, '')
          : addForm.parentPhone.replace(/\D/g, '').length === 10 && addForm.parentPhone.replace(/\D/g, '').startsWith('1')
            ? '+2' + addForm.parentPhone.replace(/\D/g, '')
            : addForm.parentPhone.startsWith('+')
              ? addForm.parentPhone
              : '+2' + addForm.parentPhone.replace(/\D/g, '').slice(-10))
        : null;
      if (parentPhoneNorm) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            await fetch('/api/parents/request-consent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({ student_id: student.id, parent_phone: parentPhoneNorm }),
            });
          }
        } catch {}
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
      <div className="bg-[var(--color-surface-0)] min-h-screen animate-fade-in pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-0">
        <div className="px-4 pt-4 pb-3 max-w-3xl mx-auto w-full">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{ts('title')}</h1>
              <p className="text-xs text-[var(--color-text-secondary)]">{ts('subtitle')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Link
                href="/students/import"
                className="flex items-center gap-1.5 px-3 py-2 border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] text-xs font-semibold rounded-lg transition-colors"
              >
                <Upload size={14} /> {ts('import')}
              </Link>
              <Link
                href="/students/print"
                className="flex items-center gap-1.5 px-3 py-2 border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] text-xs font-semibold rounded-lg transition-colors"
              >
                <Printer size={14} /> {ts('print_cards')}
              </Link>
              <button
                type="button"
                onClick={() => setShowCardOrderModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] text-xs font-semibold rounded-lg transition-colors"
              >
                <CreditCard size={14} /> {ts('order_cards')}
              </button>
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-brand-500 hover:opacity-90 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                <Plus size={14} /> {ts('add_student')}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="card p-3 flex items-center gap-3">
              <span className="text-[var(--color-text-secondary)] text-xs">{ts('total_students')}</span>
              <span className="text-lg font-bold text-[var(--color-text-primary)] ms-auto">
                {students.length.toLocaleString('en-US')}
              </span>
            </div>
            <div className="card p-3 flex items-center gap-3">
              <span className="text-[var(--color-text-secondary)] text-xs">{ts('active_students')}</span>
              <span className="text-lg font-bold text-[var(--color-success)] ms-auto">
                {students.filter((s) => s.lifecycle_status === 'active').length.toLocaleString('en-US')}
              </span>
            </div>
          </div>

          <div className="card p-0 overflow-hidden mb-3">
            <div className="relative">
              <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-[var(--color-text-tertiary)]" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setFilterKey((k) => k + 1);
                }}
                placeholder={ts('search_placeholder')}
                className="w-full bg-transparent ps-9 pe-4 py-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none border-none"
                dir="auto"
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 mb-3">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--color-surface-2)] overflow-x-auto">
              <button
                type="button"
                onClick={() => {
                  setSubjectFilter(null);
                  setFilterKey((k) => k + 1);
                }}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${subjectFilter === null ? 'bg-[var(--color-surface-1)] text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
              >
                {tCommon('all', { defaultValue: 'All' })}
              </button>
              {distinctSubjects.map((sub) => (
                <button
                  key={sub}
                  type="button"
                  onClick={() => {
                    setSubjectFilter(subjectFilter === sub ? null : sub);
                    setFilterKey((k) => k + 1);
                  }}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${subjectFilter === sub ? 'bg-[var(--color-surface-1)] text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
                >
                  {sub}
                </button>
              ))}
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
              {(['all', 'active', 'at_risk', 'inactive', 'enrolled', 'churned'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setLifecycleFilter(f);
                    setFilterKey((k) => k + 1);
                  }}
                  className={`shrink-0 px-3 py-1.5 rounded-badge text-xs font-medium transition-all duration-fast ease-out ${lifecycleFilter === f ? 'bg-[var(--color-brand-500)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'}`}
                >
                  {ts(lifecycleFilterLabelKey(f))}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-[var(--color-text-tertiary)]">{ts('sort')}</span>
              <button
                type="button"
                onClick={() => {
                  setSortBy('name');
                  setFilterKey((k) => k + 1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${sortBy === 'name' ? 'bg-[var(--color-brand-500)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'}`}
              >
                {ts('sortName')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSortBy('balance');
                  setFilterKey((k) => k + 1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${sortBy === 'balance' ? 'bg-[var(--color-brand-500)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'}`}
              >
                {ts('sortBalance')}
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 max-w-3xl mx-auto w-full space-y-4 pb-6">
          {addSuccess && (
            <div className="p-4 rounded-xl border border-[var(--color-success)] bg-[rgba(16,185,129,0.08)] text-[var(--color-success)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <p className="font-medium text-sm">
                {ts('addStudentSuccess', { name: addSuccess.name, studentNumber: addSuccess.studentNumber })}
              </p>
              {addSuccess.qrDataUrl && <img src={addSuccess.qrDataUrl} alt="" className="w-16 h-16" />}
              <button type="button" onClick={() => setAddSuccess(null)} className="text-sm underline">
                {tCommon('cancel')}
              </button>
            </div>
          )}
          {generateSuccess && (
            <div className="p-4 rounded-xl border border-[var(--color-success)] bg-[rgba(16,185,129,0.08)] text-[var(--color-success)]">
              <p className="font-medium text-sm">{generateSuccess}</p>
            </div>
          )}

          <AtRiskPanel />

          {isLoading ? (
            <div className="text-center py-16">
              <svg
                className="animate-spin h-8 w-8 text-brand-500 mx-auto"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            </div>
          ) : students.length === 0 ? (
            <EmptyState
              icon={<Users />}
              titleKey="students.title"
              descriptionKey="students.description"
              namespace="emptyStates"
              actionLabel="students.action"
              onAction={() => setShowAddModal(true)}
            />
          ) : (
            <div className="flex flex-col gap-2" key={filterKey}>
              {filteredStudents.length === 0 ? (
                <div className="card p-10 flex flex-col items-center gap-3 mt-4">
                  <svg
                    width="40"
                    height="40"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    viewBox="0 0 24 24"
                    className="text-[var(--color-text-tertiary)]"
                  >
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                  </svg>
                  <p className="text-sm font-medium text-[var(--color-text-secondary)]">{ts('empty_title')}</p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">{ts('empty_subtitle')}</p>
                </div>
              ) : (
                filteredStudents.map((s, index) => {
                  const bal = balanceByStudent[s.id] ?? 0;
                  const balNum = Number(bal);
                  const statusKey = studentStatusLabelKey(s.lifecycle_status);
                  return (
                    <SwipeRow
                      key={s.id}
                      actions={[
                        {
                          label: ts('swipe_edit'),
                          variant: 'default',
                          icon: (
                            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          ),
                          onClick: () => openEdit(s),
                        },
                        {
                          label: ts('swipe_scan'),
                          variant: 'default',
                          icon: <QrCode size={16} />,
                          onClick: () => router.push('/scan'),
                        },
                        {
                          label: ts('swipe_delete'),
                          variant: 'danger',
                          icon: (
                            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              <path d="M10 11v6M14 11v6" />
                            </svg>
                          ),
                          onClick: () => setDeleteTarget(s),
                        },
                      ]}
                    >
                      <div
                        className="card p-4 cursor-pointer hover:border-[var(--color-brand-500)] transition-all duration-fast ease-out student-card-enter"
                        style={{ animationDelay: `${Math.min(index * 30, 150)}ms` }}
                        onClick={() => openQRModal(s)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openQRModal(s);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-9 h-9 rounded-full shrink-0 bg-[rgba(13,148,136,0.12)] text-brand-400 font-semibold text-sm flex items-center justify-center">
                            {(s.name ?? '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{s.name}</p>
                              <LifecycleBadge status={s.lifecycle_status} label={ts(statusKey)} />
                              {s.parent_consent_given && (
                                <span
                                  className="badge badge-success text-[10px] px-1.5 py-0"
                                  title={ts('parentConsented', { defaultValue: 'Parent consented' })}
                                >
                                  ✓
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-[var(--color-text-tertiary)] font-mono" dir="ltr">
                              {s.student_number ?? ''}
                              {s.phone ? ` · ${s.phone}` : ''}
                            </p>
                            {(studentGroupsMap[s.id]?.names ?? []).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {(studentGroupsMap[s.id]?.names ?? []).slice(0, 3).map((n, gi) => (
                                  <span
                                    key={gi}
                                    className="px-2 py-0.5 rounded-full text-[10px] font-medium border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]"
                                  >
                                    {n}
                                  </span>
                                ))}
                                {(studentGroupsMap[s.id]?.names ?? []).length > 3 && (
                                  <span className="text-[10px] text-[var(--color-text-tertiary)]">
                                    +{(studentGroupsMap[s.id]?.names ?? []).length - 3}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-xs text-[var(--color-text-tertiary)] me-1">{ts('last_sessions')}</span>
                          {Array.from({ length: 7 }).map((_, i) => (
                            <div key={i} className="attendance-dot attendance-dot-unknown" />
                          ))}
                        </div>

                        {balNum > 0 ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-[var(--color-danger)] font-medium">{ts('balance_due')}:</span>
                              <span className="text-xs font-bold text-[var(--color-danger)]">
                                {balNum.toLocaleString('en-US')} {tCommon('egp')}
                              </span>
                            </div>
                            <div className="balance-bar">
                              <div
                                className="balance-bar-fill"
                                style={{ width: `${Math.min(100, (balNum / maxBalanceAcross) * 100)}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-[var(--color-text-tertiary)]">{ts('no_balance')}</p>
                        )}

                        <div className="hidden md:flex flex-wrap items-center justify-end gap-1 pt-3 mt-2 border-t border-[var(--color-border-subtle)]">
                          {canViewPayments && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPrintStudent({ id: s.id, name: s.name });
                              }}
                              className="p-2 rounded-lg hover:bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]"
                              title={ts('statement.printStatement')}
                            >
                              <Printer size={14} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(s);
                            }}
                            className="p-2 rounded-lg hover:bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]"
                            title={tCommon('edit')}
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openQRModal(s);
                            }}
                            className="p-2 rounded-lg hover:bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]"
                            title={ts('viewQR')}
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(s);
                            }}
                            className="p-2 rounded-lg hover:bg-[rgba(239,68,68,0.12)] text-[var(--color-danger)]"
                            title={tCommon('delete')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </SwipeRow>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add Student Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddModal(false)}>
          <div className="bg-[var(--color-surface-1)] rounded-2xl border border-border p-6 max-w-sm mx-4 w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-[var(--color-text-primary)]">{ts('addStudent')}</h3>
              <button onClick={() => setShowAddModal(false)}><X size={18} className="text-[var(--color-text-secondary)]" /></button>
            </div>
            <form onSubmit={handleAddStudent} className="space-y-3">
              {addError && <p className="text-sm text-destructive">{addError}</p>}
              <input value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} placeholder={ts('studentName')} className="w-full px-3 py-2.5 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm" required />
              <input value={addForm.phone} onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))} placeholder={tCommon('phone')} type="tel" dir="ltr" className="w-full px-3 py-2.5 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm" />
              <input value={addForm.parentPhone} onChange={(e) => setAddForm((f) => ({ ...f, parentPhone: e.target.value }))} placeholder={ts('parentPhone', { defaultValue: 'رقم ولي الأمر' })} type="tel" dir="ltr" className="w-full px-3 py-2.5 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm" />
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{ts('groupRequired')}</label>
                <select value={addForm.groupId} onChange={(e) => { const gId = e.target.value; const g = groups.find((gr) => gr.id === gId); setAddForm((f) => ({ ...f, groupId: gId, subjectId: g ? subjects.find((s) => s.name === g.subject)?.id ?? '' : '', monthlyFee: g?.fee != null ? String(g.fee) : '' })); }} className="w-full px-3 py-2.5 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm" required>
                  <option value="">{tCommon('select')}</option>
                  {groups.map((g) => (<option key={g.id} value={g.id}>{g.name} {g.fee != null ? `(EGP ${g.fee})` : ''}</option>))}
                </select>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)]">{ts('autoGenerateNumber')}</p>
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
          <div className="bg-[var(--color-surface-1)] rounded-2xl border border-border p-6 max-w-sm mx-4 w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-[var(--color-text-primary)]">{tCommon('edit')}</h3>
              <button onClick={() => setEditStudent(null)}><X size={18} className="text-[var(--color-text-secondary)]" /></button>
            </div>
            <div className="space-y-3">
              <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={ts('studentName')} className="w-full px-3 py-2.5 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm" />
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder={tCommon('phone')} type="tel" dir="ltr" className="w-full px-3 py-2.5 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm" />
              <input value={editParentPhone} onChange={(e) => setEditParentPhone(e.target.value)} placeholder={ts('parentPhone', { defaultValue: 'رقم ولي الأمر' })} type="tel" dir="ltr" className="w-full px-3 py-2.5 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm" />
              {editStudent.parent_consent_given && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                  {ts('parentConsented', { defaultValue: 'موافقة ولي الأمر ✓' })}
                </span>
              )}
              <FamilyLinkingSection
                centerId={centerId}
                studentId={editStudent.id}
                currentFamilyId={editSiblingFamilyId}
                onFamilyChange={setEditSiblingFamilyId}
              />
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{ts('assignGroups')}</label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {groups.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer">
                      <input type="checkbox" checked={editGroups.includes(g.id)} onChange={(e) => setEditGroups((prev) => e.target.checked ? [...prev, g.id] : prev.filter((x) => x !== g.id))} className="rounded accent-primary" />
                      <span className="text-sm text-[var(--color-text-primary)]">{g.name}</span>
                      <span className="text-xs text-[var(--color-text-secondary)] ms-auto">{g.subject}</span>
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
          <div className="bg-[var(--color-surface-1)] rounded-2xl border border-border p-6 max-w-sm mx-4 w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-[var(--color-text-primary)] text-lg mb-2">{ts('deleteStudent')}</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-3">{ts('deleteStudentConfirm')}</p>
            <p className="font-medium text-[var(--color-text-primary)] mb-5">{deleteTarget.name}</p>
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
          <div className="bg-[var(--color-surface-1)] rounded-2xl border border-border p-6 max-w-sm mx-4 w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-[var(--color-text-primary)]">{ts('viewQR')}</h3>
              <button onClick={() => { setQrModalStudent(null); setQrDataUrl(null); }} className="p-1.5 rounded-lg hover:bg-muted"><X size={18} className="text-[var(--color-text-secondary)]" /></button>
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
              <div className="font-bold text-[var(--color-text-primary)]">{qrModalStudent.name}</div>
              <div className="font-mono text-sm text-[var(--color-text-secondary)]">{qrModalStudent.student_number || ''}</div>
              {(balanceByStudent[qrModalStudent.id] ?? 0) > 0 && (
                <div className="mt-2 text-sm font-bold text-red-600">
                  {ts('balance')}: {locale === 'ar' ? toAr(Math.round(balanceByStudent[qrModalStudent.id]!)) : Math.round(balanceByStudent[qrModalStudent.id]!).toLocaleString('en-US')} {tCommon('egp')}
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
            {qrDataUrl && <button onClick={handleRegenerateQR} className="mt-3 w-full py-1 text-xs text-amber-500 hover:underline">{ts('regenerateQR')}</button>}
          </div>
        </div>
      )}

      {/* Print Statement Modal */}
      {printStudent && (
        <PrintStatementModal
          studentId={printStudent.id}
          studentName={printStudent.name}
          isOpen={true}
          onClose={() => setPrintStudent(null)}
        />
      )}

      {/* Order ID Cards Modal */}
      {centerId && (
        <CardOrderModal
          isOpen={showCardOrderModal}
          onClose={() => setShowCardOrderModal(false)}
          students={students}
          centerId={centerId}
          centerInfo={centerInfo}
          onSuccess={async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
              const meRes = await fetch('/api/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
              const meData = await meRes.json();
              if (meData?.user?.center) setCenterInfo({ name: meData.user.center.name, logo_url: meData.user.center.logo_url, phone: meData.user.center.phone, delivery_address: meData.user.center.delivery_address, card_color: meData.user.center.card_color });
            }
          }}
        />
      )}
    </>
  );
}
