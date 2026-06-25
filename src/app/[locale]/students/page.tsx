'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, dbDelete, auditLog } from '@/lib/db-proxy';
import QRCode from 'qrcode';
import { Plus, Search, QrCode, Upload, Users, X, Download, Edit, Trash2, Eye, Printer, ShoppingCart, Phone, Pencil, Inbox, CircleHelp } from 'lucide-react';
import { KpiCard, SectionHeader } from '@/components/shared';
import { QRCard } from '@/components/QRCard';
import { PrintStatementModal } from '@/components/PrintStatementModal';
import EmptyState from '@/components/empty-states/EmptyState';
import { AtRiskPanel } from '@/components/students/AtRiskPanel';
import { LifecycleBadge } from '@/components/students/LifecycleBadge';
import { SwipeRow } from '@/components/students/SwipeRow';
import { FamilyLinkingSection } from '@/components/students/FamilyLinkingSection';
import { useUser } from '@/contexts/UserContext';
import { useCardOrderCart } from '@/hooks/useCardOrderCart';
import { useToast } from '@/components/ui/ToastProvider';
import {
  ANNOUNCEMENT_WARN_THRESHOLD,
  BLAST_PRICE_PER_PARENT,
  getAnnouncementCap,
} from '@/lib/parentPack';
import { formatCurrency, formatNumber, formatPlainInteger } from '@/lib/formatNumber';
import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';
import { memoryCacheGet, memoryCacheSet } from '@/lib/clientMemoryCache';

// In-memory only (tab-scoped). The roster carries PII (names, phones, parent
// phones) and must never be written to sessionStorage/localStorage.
const STUDENTS_CACHE_KEY = 'chq_students_cache';
const STUDENTS_PAGE_SIZE = 20;

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

function readStudentsCache(): Student[] | null {
  if (typeof window === 'undefined') return null;
  return memoryCacheGet<Student[]>(STUDENTS_CACHE_KEY);
}

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

function studentStatusLabelFallback(lifecycle: Student['lifecycle_status']): string {
  const x = lifecycle ?? 'enrolled';
  if (x === 'active') return 'Active';
  if (x === 'at_risk') return 'At Risk';
  if (x === 'inactive') return 'Inactive';
  if (x === 'churned') return 'Churned';
  return 'Enrolled';
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

type StatusHelpKey =
  | 'statusHelp_all'
  | 'statusHelp_active'
  | 'statusHelp_at_risk'
  | 'statusHelp_inactive'
  | 'statusHelp_enrolled'
  | 'statusHelp_churned';

function lifecycleStatusHelpKey(f: LifecycleFilter): StatusHelpKey {
  if (f === 'all') return 'statusHelp_all';
  if (f === 'active') return 'statusHelp_active';
  if (f === 'at_risk') return 'statusHelp_at_risk';
  if (f === 'inactive') return 'statusHelp_inactive';
  if (f === 'enrolled') return 'statusHelp_enrolled';
  return 'statusHelp_churned';
}

export default function StudentsPage() {
  const locale = useLocale();
  const ts = useTranslations('students');
  const tCart = useTranslations('cart');
  const router = useRouter();
  const tCommon = useTranslations('common');
  const tToast = useTranslations('toasts');
  const { user, hasPermission, refreshUser } = useUser();
  const canViewPayments =
    user?.role === 'owner' || user?.role === 'admin' || user?.role === 'super_admin' || hasPermission('can_view_payments');
  const { activeItemCount, addItem, addItemsBatch, isStudentInCart } = useCardOrderCart();
  const { toast } = useToast();

  const [students, setStudents] = useState<Student[] | null>(() => readStudentsCache());
  const [studentsListFresh, setStudentsListFresh] = useState(false);
  const [printStudent, setPrintStudent] = useState<{ id: string; name: string } | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [studentGroupsMap, setStudentGroupsMap] = useState<Record<string, { names: string[]; fees: number[]; subjects: string[]; groupIds: string[] }>>({});
  const [balanceByStudent, setBalanceByStudent] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>('all');
  const [filterKey, setFilterKey] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [statusHelpOpen, setStatusHelpOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    name: '',
    phone: '',
    parentPhone: '',
    subjectId: '',
    monthlyFee: '',
    groupId: '',
    parentPackOptIn: false,
  });
  const [showParentSectionAdd, setShowParentSectionAdd] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
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
  const [editParentPackOptIn, setEditParentPackOptIn] = useState(false);
  const [showParentSectionEdit, setShowParentSectionEdit] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [announcementBlastType, setAnnouncementBlastType] = useState<'ops' | 'promo' | null>(null);
  const [announcementMessage, setAnnouncementMessage] = useState('');
  const [announcementSubmitting, setAnnouncementSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [centerInfo, setCenterInfo] = useState<{
    name?: string;
    logo_url?: string;
    phone?: string;
    governorate?: string;
    delivery_address?: Record<string, unknown>;
    parent_pack_enabled?: boolean;
    plan?: string;
    announcement_balance?: string | number;
    parent_pack_active_parents?: number;
  } | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const parentPhonePopoverRef = useRef<HTMLDivElement>(null);
  const [openPopoverId, setOpenPopoverId] = useState<string | null>(null);
  const [parentPhoneDraft, setParentPhoneDraft] = useState('');
  const [savingParentPhoneId, setSavingParentPhoneId] = useState<string | null>(null);
  const [isDesktopLayout, setIsDesktopLayout] = useState(false);
  const [studentListPage, setStudentListPage] = useState(1);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [studentCardDelivered, setStudentCardDelivered] = useState<Record<string, boolean>>({});
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const addToggling = (id: string) => setTogglingIds((prev) => new Set(prev).add(id));
  const removeToggling = (id: string) =>
    setTogglingIds((prev) => {
      const s = new Set(prev);
      s.delete(id);
      return s;
    });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 768px)');
    const apply = () => setIsDesktopLayout(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (openPopoverId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPopoverId(null);
    };
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (parentPhonePopoverRef.current?.contains(t)) return;
      const el = t as HTMLElement;
      if (el.closest?.('[data-parent-phone-trigger]')) return;
      setOpenPopoverId(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [openPopoverId]);

  const saveParentPhoneInline = async (studentId: string) => {
    const value = parentPhoneDraft.trim();
    setSavingParentPhoneId(studentId);
    try {
      const { error } = await dbUpdate({
        table: 'students',
        data: { parent_phone: value || null },
        filters: [{ column: 'id', op: 'eq', value: studentId }],
      });
      if (error) {
        toast.error(tToast('error'));
        return;
      }
      setStudents((prev) =>
        (prev ?? []).map((st) => (st.id === studentId ? { ...st, parent_phone: value || null } : st)),
      );
      setOpenPopoverId(null);
      toast.success(value ? ts('parentPhoneSaved') : ts('parentPhoneCleared'));
    } finally {
      setSavingParentPhoneId(null);
    }
  };

  useEffect(() => {
    const loadStudents = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const meRes = await fetch('/api/me', {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });
        const meData = await meRes.json().catch(() => null);

        if (!meData?.user?.center_id) return;
        setCenterId(meData.user.center_id);
        setCenterInfo(
          meData.user.center
            ? {
                name: meData.user.center.name,
                logo_url: meData.user.center.logo_url,
                phone: meData.user.center.phone,
                governorate: meData.user.center.governorate,
                delivery_address: meData.user.center.delivery_address,
                parent_pack_enabled: meData.user.center.parent_pack_enabled,
                plan: meData.user.center.plan,
                announcement_balance: meData.user.center.announcement_balance,
                parent_pack_active_parents: meData.user.center.parent_pack_active_parents,
              }
            : null
        );

        const { data } = await dbSelect({
          table: 'students',
          select:
            'id, name, phone, parent_phone, parent_consent_given, parent_pack_opted_in, subject, fee, payment_status, student_number, qr_code, is_active, lifecycle_status, sibling_family_id, center_id',
          filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
          order: { column: 'name' },
        });

        const list = Array.isArray(data) ? (data as Student[]) : [];
        setStudents(list);
        memoryCacheSet(STUDENTS_CACHE_KEY, list);
        setStudentsListFresh(true);
      } catch (err) {
        console.error('[students] loadStudents failed', err);
        setStudents((prev) => prev ?? []);
        setStudentsListFresh(true);
      }
    };

    loadStudents();
  }, []);

  useEffect(() => {
    if (!centerId) return;
    let cancelled = false;
    const loadPendingCount = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      try {
        const res = await fetch('/api/students/pending', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { pending?: unknown[] };
        if (!cancelled) setPendingCount(Array.isArray(data.pending) ? data.pending.length : 0);
      } catch {
        /* ignore */
      }
    };
    loadPendingCount();
    return () => {
      cancelled = true;
    };
  }, [centerId]);

  useEffect(() => {
    if (groups.length === 0) return;
    const loadBalanceData = async () => {
      try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
      const meData = await meRes.json().catch(() => null);
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
      } catch (err) {
        console.error('[students] loadBalanceData failed', err);
      }
    };
    loadBalanceData();
  }, [groups]);

  useEffect(() => {
    const loadSubjectsAndGroups = async () => {
      try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
      const meData = await meRes.json().catch(() => null);
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
      } catch (err) {
        console.error('[students] loadSubjectsAndGroups failed', err);
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

  const studentsList = students ?? [];
  const studentsStale = Boolean(students !== null && !studentsListFresh);

  const subjectCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of studentsList) {
      const subs = studentGroupsMap[s.id]?.subjects ?? [];
      for (const sub of subs) {
        counts[sub] = (counts[sub] ?? 0) + 1;
      }
    }
    return counts;
  }, [studentsList, studentGroupsMap]);

  const filteredStudents = useMemo(() => {
    let list = studentsList.filter((s) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = s.name?.toLowerCase().includes(q);
        const qNum = q.replace(/^#/, '').toUpperCase();
        const matchNumber = (s.student_number ?? '')
          .replace(/^#/, '')
          .toUpperCase()
          .includes(qNum);
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
  }, [studentsList, searchQuery, subjectFilter, lifecycleFilter, sortBy, studentGroupsMap, balanceByStudent]);

  const studentTotalCount = filteredStudents.length;
  const studentTotalPages = Math.max(1, Math.ceil(studentTotalCount / STUDENTS_PAGE_SIZE));
  const studentPageClamped = Math.min(studentListPage, studentTotalPages);
  const paginatedStudents = useMemo(() => {
    const start = (studentPageClamped - 1) * STUDENTS_PAGE_SIZE;
    return filteredStudents.slice(start, start + STUDENTS_PAGE_SIZE);
  }, [filteredStudents, studentPageClamped]);

  useEffect(() => {
    if (!centerId || studentsList.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token || cancelled) return;
        const ids = studentsList.map((s) => s.id);
        const res = await fetch('/api/card-order-cart/student-card-status', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as { statusByStudentId?: Record<string, string> };
        const map: Record<string, boolean> = {};
        for (const [id, st] of Object.entries(j.statusByStudentId ?? {})) {
          map[id] = st === 'delivered';
        }
        if (!cancelled) setStudentCardDelivered(map);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [centerId, studentsList]);

  const addStudentToCart = useCallback(
    async (studentId: string) => {
      if (isStudentInCart(studentId)) {
        toast.info(ts('alreadyInOrder'));
        return;
      }
      if (studentCardDelivered[studentId]) return;
      try {
        await addItem({ kind: 'student', student_id: studentId });
        toast.success(tCart('toast.added'));
      } catch {
        toast.error(tToast('error'));
      }
    },
    [isStudentInCart, studentCardDelivered, addItem, toast, ts, tCart, tToast],
  );

  const toggleBulkStudent = useCallback((id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const bulkAddToCart = useCallback(async () => {
    const ids = [...bulkSelected].filter((id) => !isStudentInCart(id) && !studentCardDelivered[id]);
    if (ids.length === 0) return;
    setBulkSubmitting(true);
    try {
      await addItemsBatch(ids.map((student_id) => ({ kind: 'student' as const, student_id })));
      toast.success(tCart('toast.added'));
      setBulkSelected(new Set());
    } catch {
      toast.error(tToast('error'));
    } finally {
      setBulkSubmitting(false);
    }
  }, [bulkSelected, isStudentInCart, studentCardDelivered, addItemsBatch, toast, tCart, tToast]);

  useEffect(() => {
    setStudentListPage(1);
  }, [searchQuery, subjectFilter, lifecycleFilter, sortBy]);

  useEffect(() => {
    setStudentListPage((p) => Math.min(p, studentTotalPages));
  }, [studentTotalPages]);

  const isFirstStudentPage = studentPageClamped <= 1;
  const isLastStudentPage = studentPageClamped >= studentTotalPages;

  const maxBalanceAcross = useMemo(
    () => Math.max(1, ...studentsList.map((s) => balanceByStudent[s.id] ?? 0)),
    [studentsList, balanceByStudent]
  );

  const activeParentsForAnnounce =
    user?.center?.parent_pack_active_parents ?? centerInfo?.parent_pack_active_parents ?? 0;
  const canSendAnnouncement =
    (user?.role === 'owner' || user?.role === 'admin' || user?.role === 'super_admin') && activeParentsForAnnounce > 0;
  const announcementPlan = user?.center?.plan ?? centerInfo?.plan ?? 'starter';
  const announcementBalanceNum = Number(
    user?.center?.announcement_balance ?? centerInfo?.announcement_balance ?? 0,
  );
  const announcementCap = getAnnouncementCap(announcementPlan);
  const announcementCapWarning =
    announcementBalanceNum >= announcementCap * ANNOUNCEMENT_WARN_THRESHOLD;
  const announcementCapReached = announcementBalanceNum >= announcementCap;

  const handlePackToggle = async (student: Student) => {
    if (togglingIds.has(student.id)) return;
    const newValue = !student.parent_pack_opted_in;
    const prevOpted = student.parent_pack_opted_in ?? false;
    setStudents((prev) =>
      (prev ?? []).map((s) => (s.id === student.id ? { ...s, parent_pack_opted_in: newValue } : s)),
    );
    addToggling(student.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setStudents((prev) =>
          (prev ?? []).map((s) => (s.id === student.id ? { ...s, parent_pack_opted_in: prevOpted } : s)),
        );
        return;
      }
      const res = await fetch(`/api/parent-pack/student/${student.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ parent_pack_opted_in: newValue }),
      });
      if (!res.ok) {
        setStudents((prev) =>
          (prev ?? []).map((s) => (s.id === student.id ? { ...s, parent_pack_opted_in: prevOpted } : s)),
        );
        toast.error(ts('packOptInError'));
        return;
      }
      await refreshUser();
    } finally {
      removeToggling(student.id);
    }
  };

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
          (prev ?? []).map((s) => (s.id === student.id ? { ...s, qr_code: dataUrl } : s))
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
        (prev ?? []).map((s) => (s.id === qrModalStudent.id ? { ...s, qr_code: dataUrl } : s))
      );
      setQrDataUrl(dataUrl);
    } catch (err) {
      console.error('QR regenerate error:', err);
    }
  };

  const downloadQR = () => {
    if (!qrDataUrl || !qrModalStudent) return;
    const link = document.createElement('a');
    const numForFile = (qrModalStudent.student_number || qrModalStudent.id).replace(/^#/, '');
    link.download = `QR-${qrModalStudent.name}-${numForFile}.png`;
    link.href = qrDataUrl;
    link.click();
  };

  const printCard = () => {
    if (!qrDataUrl || !qrModalStudent) return;
    const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const logoHtml = centerInfo?.logo_url
      ? `<img src="${esc(centerInfo.logo_url)}" alt="" style="height:7mm;width:auto;max-width:12mm;object-fit:contain" />`
      : '';
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <!DOCTYPE html><html dir="ltr">
      <head>
        <meta charset="utf-8">
        <style>
          body { margin: 0; padding: 10mm; font-family: system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .card { width: 85.6mm; height: 54mm; background: linear-gradient(135deg, #0D9488 0%, #1E293B 100%); position: relative; overflow: hidden; color: white; }
          .top-bar { position: absolute; top: 0; inset-inline-start: 0; inset-inline-end: 0; display: flex; align-items: center; justify-content: space-between; padding: 2.5mm 3mm; background: rgba(0,0,0,0.35); }
          .center-name { font-size: 9px; font-weight: 500; opacity: 0.9; }
          .center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
          .qr-wrap { width: 25mm; height: 25mm; background: #fff; border-radius: 8px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
          .qr-wrap img { width: 20mm; height: 20mm; }
          .name { font-size: 14px; font-weight: bold; margin-top: 2.5mm; text-align: center; }
          .num { font-size: 10px; opacity: 0.7; margin-top: 0.5mm; font-family: monospace; }
          .bottom { position: absolute; bottom: 0; inset-inline-start: 0; inset-inline-end: 0; padding: 1.5mm; border-top: 1px solid rgba(255,255,255,0.2); text-align: center; font-size: 7px; opacity: 0.3; font-family: monospace; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="top-bar">${logoHtml}<span class="center-name">${esc(centerInfo?.name || 'TutoringHQ')}</span></div>
          <div class="center">
            <div class="qr-wrap"><img src="${qrDataUrl}" alt="QR" /></div>
            <div class="name">${esc(qrModalStudent.name)}</div>
            <div class="num">${esc(formatStudentNumberForDisplay(qrModalStudent.student_number))}</div>
          </div>
          <div class="bottom">TutoringHQ</div>
        </div>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const handleGenerateAllQR = async () => {
    const needQR = studentsList.filter((s) => !s.qr_code);
    if (needQR.length === 0) {
      toast.info(ts('allStudentsHaveQR', { defaultValue: 'All students already have QR codes' }));
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
          (prev ?? []).map((s) => (s.id === student.id ? { ...s, qr_code: dataUrl } : s))
        );
      }
      toast.success(ts('qrGeneratedNew', { count: needQR.length, defaultValue: `Generating QR codes for ${needQR.length} new students...` }));
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
    setEditSiblingFamilyId(s.sibling_family_id ?? null);
    setEditParentPackOptIn(s.parent_pack_opted_in === true);
    setShowParentSectionEdit(false);
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
      const consentAt = editParentPackOptIn ? new Date().toISOString() : null;
      await dbUpdate({
        table: 'students',
        data: {
          name: editName.trim(),
          phone: editPhone.trim() || null,
          parent_phone: parentPhoneNorm,
          sibling_family_id: editSiblingFamilyId,
          parent_pack_opted_in: editParentPackOptIn,
          parent_consent_given: editParentPackOptIn,
          parent_consent_at: consentAt,
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
        (prev ?? []).map((s) =>
          s.id === editStudent.id
            ? {
                ...s,
                name: editName.trim(),
                phone: editPhone.trim(),
                parent_phone: parentPhoneNorm ?? s.parent_phone,
                sibling_family_id: editSiblingFamilyId,
                parent_pack_opted_in: editParentPackOptIn,
                parent_consent_given: editParentPackOptIn,
              }
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
        setStudents((prev) => (prev ?? []).filter((s) => s.id !== student.id));
        await auditLog({ centerId: cid, userId, action: 'student_delete', entityType: 'students', entityId: student.id, details: { name: student.name } });
      }
    } catch (err) {
      console.error('Delete student error:', err);
    }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
    const meData = await meRes.json();
    const centerId = meData?.user?.center_id;
    const userId = meData?.user?.id;
    if (!centerId || !userId || !addForm.name.trim()) {
      toast.error(ts('nameRequired', { defaultValue: 'Name is required' }));
      return;
    }
    if (!addForm.groupId) {
      toast.error(ts('groupRequiredError'));
      return;
    }
    setIsAdding(true);
    try {
      const selectedGroup = groups.find((g) => g.id === addForm.groupId);
      const subjectValue = selectedGroup?.subject ?? subjects.find((s) => s.id === addForm.subjectId)?.name ?? null;
      const parentPhoneNorm = addForm.parentPhone.trim()
        ? normalizeParentPhone(addForm.parentPhone.trim())
        : null;
      const packEnabled = meData?.user?.center?.parent_pack_enabled === true;
      const optedIn = packEnabled && addForm.parentPackOptIn;
      // Fee comes from group (groups.fee), not from students table
      const insertPayload = {
        center_id: centerId,
        name: addForm.name.trim(),
        phone: addForm.phone.trim() || null,
        parent_phone: parentPhoneNorm,
        subject: subjectValue,
        payment_status: 'unpaid' as const,
        parent_pack_opted_in: optedIn,
        parent_consent_given: optedIn,
        parent_consent_at: optedIn ? new Date().toISOString() : null,
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
      setStudents((prev) => [{ ...student, student_number: studentNumber } as Student, ...(prev ?? [])]);
      toast.success(ts('addStudentSuccess', { name: addForm.name.trim(), studentNumber: formatStudentNumberForDisplay(studentNumber) || studentNumber }));
      setAddForm({ name: '', phone: '', parentPhone: '', subjectId: '', monthlyFee: '', groupId: '', parentPackOptIn: false });
      setShowParentSectionAdd(false);
      setShowAddModal(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : (typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: string }).message) : 'Failed to add student');
      toast.error(tToast('error'), msg);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <>
      <div className="min-h-screen w-full min-w-0 overflow-x-clip bg-[var(--color-surface-0)] page-enter max-md:pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-0">
        <div className="px-4 pt-4 pb-3 max-w-3xl mx-auto w-full">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{ts('title')}</h1>
                <span
                  className={`inline-flex items-center rounded-full bg-teal-600 text-white text-xs font-semibold px-2.5 py-0.5 tabular-nums shrink-0 transition-opacity duration-300 ${studentsStale ? 'opacity-70' : 'opacity-100'}`}
                >
                  {students === null ? '-' : formatNumber(studentsList.length, locale)}
                </span>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">{ts('subtitle')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Link
                href="/students/import"
                className="btn-lift flex items-center gap-1.5 px-3 py-2.5 min-h-[40px] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-teal-500/40 text-xs font-semibold rounded-xl transition-all duration-150 bg-[var(--color-surface-1)] card-shadow"
              >
                <Upload size={16} /> {ts('import')}
              </Link>
              <Link
                href="/orders"
                className="btn-lift relative flex items-center gap-1.5 px-3 py-2.5 min-h-[40px] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-teal-500/40 text-xs font-semibold rounded-xl transition-all duration-150 bg-[var(--color-surface-1)] card-shadow btn-press chq-focus"
                aria-label={ts('order_cards')}
              >
                <ShoppingCart size={16} />
                {ts('order_cards')}
                {activeItemCount > 0 ? (
                  <span className="absolute -top-1 -end-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-teal-500 text-white text-[10px] font-bold leading-none">
                    {activeItemCount > 99 ? '99+' : activeItemCount}
                  </span>
                ) : null}
              </Link>
              <Link
                href="/students/pending"
                className="btn-lift relative flex items-center gap-1.5 px-3 py-2.5 min-h-[40px] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-teal-500/40 text-xs font-semibold rounded-xl transition-all duration-150 bg-[var(--color-surface-1)] card-shadow btn-press chq-focus"
                aria-label={ts('pendingRequests')}
              >
                <Inbox size={16} /> {ts('pendingRequests')}
                {pendingCount > 0 ? (
                  <span className="absolute -top-1 -end-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-teal-500 text-white text-[10px] font-bold leading-none">
                    {pendingCount > 99 ? '99+' : pendingCount}
                  </span>
                ) : null}
              </Link>
              {(user?.role === 'owner' || user?.role === 'admin' || user?.role === 'super_admin') && (
                <button
                  type="button"
                  disabled={!canSendAnnouncement}
                  onClick={() => {
                    setAnnouncementBlastType(null);
                    setAnnouncementMessage('');
                    setShowAnnouncementModal(true);
                  }}
                  className="btn-lift flex items-center gap-1.5 px-3 py-2.5 min-h-[40px] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-teal-500/40 text-xs font-semibold rounded-xl transition-all duration-150 bg-[var(--color-surface-1)] card-shadow disabled:opacity-50 disabled:cursor-not-allowed btn-press chq-focus"
                >
                  {ts('sendAnnouncement')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="btn-lift flex items-center gap-1.5 px-3 py-2.5 min-h-[40px] bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded-xl transition-all duration-150 shadow-sm btn-press chq-focus"
              >
                <Plus size={16} /> {ts('add_student')}
              </button>
            </div>
          </div>

          <div className="mb-3">
            <SectionHeader title={tCommon('sectionAtAGlance')} />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {students === null ? (
              <>
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shadow-sm p-6 flex flex-col gap-2" aria-hidden>
                  <div className="h-3 w-24 rounded bg-[var(--color-surface-2)] animate-pulse" />
                  <div className="h-7 w-16 rounded bg-[var(--color-surface-2)] animate-pulse" />
                </div>
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shadow-sm p-6 flex flex-col gap-2" aria-hidden>
                  <div className="h-3 w-28 rounded bg-[var(--color-surface-2)] animate-pulse" />
                  <div className="h-7 w-12 rounded bg-[var(--color-surface-2)] animate-pulse" />
                </div>
              </>
            ) : (
              <div className={`contents transition-opacity duration-300 ${studentsStale ? 'opacity-70' : 'opacity-100'}`}>
                <KpiCard
                  label={ts('total_students')}
                  value={formatNumber(studentsList.length, locale)}
                />
                <KpiCard
                  label={ts('active_students')}
                  value={formatNumber(
                    studentsList.filter((s) => s.lifecycle_status === 'active').length,
                    locale,
                  )}
                  tone="success"
                />
              </div>
            )}
          </div>

          <div className="rounded-xl bg-[var(--color-surface-1)] mb-3 ring-1 ring-[var(--color-border-subtle)] border-0 shadow-sm focus-within:ring-2 focus-within:ring-teal-500 transition-shadow duration-150">
            <div className="relative">
              <Search size={18} className="absolute top-1/2 -translate-y-1/2 start-4 text-[var(--color-text-muted)] pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setFilterKey((k) => k + 1);
                }}
                placeholder={ts('search_placeholder')}
                className="w-full bg-transparent ps-12 pe-4 py-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none border-0 rounded-xl"
                dir="auto"
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 mb-3">
            <div className="flex flex-wrap items-center gap-2 pb-1">
              <button
                type="button"
                onClick={() => {
                  setSubjectFilter(null);
                  setFilterKey((k) => k + 1);
                }}
                className={`shrink-0 px-3.5 py-2 rounded-full text-xs font-medium transition-all duration-150 ${
                  subjectFilter === null
                    ? 'bg-teal-600 text-white shadow-sm'
                    : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]'
                } btn-press chq-focus`}
              >
                {ts('allGroups')}
              </button>
              {distinctSubjects.map((sub) => (
                <button
                  key={sub}
                  type="button"
                  onClick={() => {
                    setSubjectFilter(subjectFilter === sub ? null : sub);
                    setFilterKey((k) => k + 1);
                  }}
                  className={`shrink-0 px-3.5 py-2 rounded-full text-xs font-medium transition-all duration-150 ${
                    subjectFilter === sub
                      ? 'bg-teal-600 text-white shadow-sm'
                      : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]'
                  } btn-press chq-focus`}
                >
                  {sub}
                </button>
              ))}
            </div>

            <div className="flex items-start gap-2">
            <div className="flex flex-wrap gap-2 pb-1 flex-1 min-w-0">
              {(['all', 'active', 'at_risk', 'inactive', 'enrolled', 'churned'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setLifecycleFilter(f);
                    setFilterKey((k) => k + 1);
                  }}
                  className={`shrink-0 px-3.5 py-2 rounded-full text-xs font-medium transition-all duration-150 ${
                    lifecycleFilter === f
                      ? 'bg-teal-600 text-white shadow-sm'
                      : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]'
                  } btn-press chq-focus`}
                >
                  {ts(lifecycleFilterLabelKey(f))}
                </button>
              ))}
            </div>
              <button
                type="button"
                className="shrink-0 rounded-full p-2 text-teal-600 hover:bg-[var(--color-surface-2)] btn-press chq-focus"
                aria-label={ts('statusHelpTitle')}
                onClick={() => setStatusHelpOpen(true)}
              >
                <CircleHelp className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-[var(--color-text-tertiary)]">{ts('sort')}</span>
              <button
                type="button"
                onClick={() => {
                  setSortBy('name');
                  setFilterKey((k) => k + 1);
                }}
                className={`px-3.5 py-2 rounded-full text-xs font-medium transition-all duration-150 border ${
                  sortBy === 'name'
                    ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                    : 'bg-[var(--color-surface-1)] text-[var(--color-text-secondary)] border-[var(--color-border-subtle)] hover:border-teal-500/40'
                } btn-press chq-focus`}
              >
                {ts('sortName')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSortBy('balance');
                  setFilterKey((k) => k + 1);
                }}
                className={`px-3.5 py-2 rounded-full text-xs font-medium transition-all duration-150 border ${
                  sortBy === 'balance'
                    ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                    : 'bg-[var(--color-surface-1)] text-[var(--color-text-secondary)] border-[var(--color-border-subtle)] hover:border-teal-500/40'
                } btn-press chq-focus`}
              >
                {ts('sortBalance')}
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 max-w-3xl mx-auto w-full space-y-4 pb-6">
          <AtRiskPanel />

          {students === null ? (
            <div className="space-y-3" aria-busy="true">
              <div className="hidden md:block rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] overflow-hidden card-shadow">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[var(--color-surface-2)]">
                        <th className="px-4 py-3 text-start font-semibold text-[var(--color-text-secondary)]">
                          {ts('name')}
                        </th>
                        <th className="px-4 py-3 text-start font-semibold text-[var(--color-text-secondary)]">
                          {ts('studentId')}
                        </th>
                        <th className="px-4 py-3 text-start font-semibold text-[var(--color-text-secondary)]">
                          {ts('parentPhone')}
                        </th>
                        <th className="px-4 py-3 text-start font-semibold text-[var(--color-text-secondary)]">
                          {ts('balance')}
                        </th>
                        <th className="px-4 py-3 text-end font-semibold text-[var(--color-text-secondary)]">
                          {tCommon('actions')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...Array(8)].map((_, i) => (
                        <tr
                          key={i}
                          className="border-b border-[var(--color-border-subtle)] last:border-b-0 transition-colors duration-150"
                        >
                          <td className="px-4 py-4 align-top">
                            <div className="flex items-start gap-2">
                              <div className="h-9 w-9 shrink-0 rounded-full bg-[var(--color-surface-2)] animate-pulse" />
                              <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                                <div className="h-4 w-36 max-w-full rounded bg-[var(--color-surface-2)] animate-pulse" />
                                <div className="h-3 w-20 rounded bg-[var(--color-surface-2)] animate-pulse" />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <div className="h-4 w-24 rounded bg-[var(--color-surface-2)] animate-pulse" />
                          </td>
                          <td className="px-4 py-4 align-top">
                            <div className="h-4 w-28 rounded bg-[var(--color-surface-2)] animate-pulse" />
                          </td>
                          <td className="px-4 py-4 align-top">
                            <div className="h-4 w-16 rounded bg-[var(--color-surface-2)] animate-pulse" />
                          </td>
                          <td className="px-4 py-4 align-top text-end">
                            <div className="ms-auto h-8 w-20 rounded-lg bg-[var(--color-surface-2)] animate-pulse" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex flex-col gap-2 md:hidden">
                {[...Array(8)].map((_, i) => (
                  <div
                    key={i}
                    className="card p-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-9 h-9 rounded-full shrink-0 bg-[var(--color-surface-2)] animate-pulse" />
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="h-4 w-40 rounded bg-[var(--color-surface-2)] animate-pulse" />
                        <div className="h-3 w-24 rounded bg-[var(--color-surface-2)] animate-pulse" />
                      </div>
                    </div>
                    <div className="h-3 w-32 rounded bg-[var(--color-surface-2)] animate-pulse" />
                  </div>
                ))}
              </div>
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
            <div
              key={filterKey}
              className={`transition-opacity duration-300 ${studentsStale ? 'opacity-70' : 'opacity-100'}`}
            >
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
                <>
                  <div className="hidden md:block rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] overflow-hidden mb-2 card-shadow">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-[var(--color-surface-2)]">
                            <th className="px-2 py-3 w-10">
                              <input
                                type="checkbox"
                                aria-label={tCart('picker.selectAllFiltered')}
                                checked={
                                  paginatedStudents.some((s) => !studentCardDelivered[s.id] && !isStudentInCart(s.id)) &&
                                  paginatedStudents
                                    .filter((s) => !studentCardDelivered[s.id] && !isStudentInCart(s.id))
                                    .every((s) => bulkSelected.has(s.id))
                                }
                                disabled={paginatedStudents.every((s) => studentCardDelivered[s.id] || isStudentInCart(s.id))}
                                onChange={() => {
                                  const eligible = paginatedStudents.filter(
                                    (st) => !studentCardDelivered[st.id] && !isStudentInCart(st.id),
                                  );
                                  const allOn =
                                    eligible.length > 0 && eligible.every((st) => bulkSelected.has(st.id));
                                  setBulkSelected((prev) => {
                                    const next = new Set(prev);
                                    if (allOn) {
                                      for (const st of eligible) next.delete(st.id);
                                    } else {
                                      for (const st of eligible) next.add(st.id);
                                    }
                                    return next;
                                  });
                                }}
                              />
                            </th>
                            <th className="px-4 py-3 text-start font-semibold text-[var(--color-text-secondary)]">
                              {ts('name')}
                            </th>
                            <th className="px-4 py-3 text-start font-semibold text-[var(--color-text-secondary)]">
                              {ts('studentId')}
                            </th>
                            <th className="px-4 py-3 text-start font-semibold text-[var(--color-text-secondary)]">
                              {ts('parentPhone')}
                            </th>
                            <th className="px-4 py-3 text-start font-semibold text-[var(--color-text-secondary)]">
                              {ts('balance')}
                            </th>
                            <th className="px-4 py-3 text-end font-semibold text-[var(--color-text-secondary)]">
                              {tCommon('actions')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedStudents.map((s) => {
                            const bal = balanceByStudent[s.id] ?? 0;
                            const balNum = Number(bal);
                            const statusKey = studentStatusLabelKey(s.lifecycle_status);
                            const hasParent = s.parent_phone != null && String(s.parent_phone).trim() !== '';
                            return (
                              <tr
                                key={s.id}
                                className="transition-colors duration-150 hover:bg-[var(--color-surface-2)]"
                              >
                                <td className="px-2 py-4 align-top">
                                  <input
                                    type="checkbox"
                                    checked={bulkSelected.has(s.id)}
                                    disabled={studentCardDelivered[s.id] || isStudentInCart(s.id)}
                                    onChange={() => toggleBulkStudent(s.id)}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                </td>
                                <td className="px-4 py-4 align-top">
                                  <div className="text-start">
                                    <Link
                                      href={`/students/${s.id}`}
                                      className="inline-block btn-press chq-focus rounded-md outline-offset-2"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <span className="font-semibold text-[var(--color-text-primary)]">{s.name}</span>
                                    </Link>
                                    <div className="mt-1">
                                      <LifecycleBadge status={s.lifecycle_status} label={ts(statusKey, { defaultValue: studentStatusLabelFallback(s.lifecycle_status) })} />
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-4 align-top font-mono text-[var(--color-text-primary)]" dir="ltr">
                                  {s.student_number ? formatStudentNumberForDisplay(s.student_number) : tCommon('notSet')}
                                </td>
                                <td className="px-4 py-4 align-top relative">
                                  <div
                                    className="relative inline-block"
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    role="presentation"
                                  >
                                    {!hasParent ? (
                                      <button
                                        type="button"
                                        data-parent-phone-trigger
                                        className="inline-flex items-center justify-center rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)] btn-press chq-focus"
                                        aria-label={ts('addParentPhone')}
                                        onClick={() => {
                                          setOpenPopoverId(s.id);
                                          setParentPhoneDraft('');
                                        }}
                                      >
                                        <Phone className="h-4 w-4" />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        data-parent-phone-trigger
                                        className="inline-flex items-center gap-1.5 rounded-lg p-1 text-start hover:bg-[var(--color-surface-2)] btn-press chq-focus"
                                        onClick={() => {
                                          setOpenPopoverId(s.id);
                                          setParentPhoneDraft(String(s.parent_phone ?? ''));
                                        }}
                                      >
                                        <span className="text-xs text-[var(--color-text-secondary)] max-w-[140px] truncate" dir="ltr">
                                          {s.parent_phone}
                                        </span>
                                        <Pencil className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
                                      </button>
                                    )}
                                    {openPopoverId === s.id && isDesktopLayout ? (
                                      <div
                                        ref={parentPhonePopoverRef}
                                        className="absolute z-50 mt-1 min-w-[220px] rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-3 shadow-lg start-0"
                                        onClick={(e) => e.stopPropagation()}
                                        role="dialog"
                                        aria-label={hasParent ? ts('editParentPhone') : ts('addParentPhone')}
                                      >
                                        <input
                                          type="tel"
                                          value={parentPhoneDraft}
                                          onChange={(e) => setParentPhoneDraft(e.target.value)}
                                          placeholder={ts('parentPhonePlaceholder')}
                                          dir="ltr"
                                          className="w-full rounded-lg border border-input bg-[var(--color-surface-0)] px-3 py-2 text-sm"
                                        />
                                        <div className="mt-2 flex gap-2">
                                          <button
                                            type="button"
                                            disabled={savingParentPhoneId === s.id}
                                            className="flex-1 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50 btn-press chq-focus"
                                            onClick={() => void saveParentPhoneInline(s.id)}
                                          >
                                            {savingParentPhoneId === s.id ? tCommon('loading') : ts('save')}
                                          </button>
                                          <button
                                            type="button"
                                            className="rounded-lg border border-[var(--color-border-default)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] btn-press chq-focus"
                                            onClick={() => setOpenPopoverId(null)}
                                          >
                                            {ts('cancel')}
                                          </button>
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                </td>
                                <td className="px-4 py-4 align-top">
                                  {balNum > 0 ? (
                                    <span className="text-sm font-medium text-red-600 dark:text-red-400 tabular-nums">
                                      {formatCurrency(balNum, locale)}
                                    </span>
                                  ) : (
                                    <span className="text-sm text-[var(--color-text-muted)]">{ts('no_balance')}</span>
                                  )}
                                </td>
                                <td className="px-4 py-4 align-top text-end">
                                  <div className="flex flex-wrap justify-end gap-0.5">
                                    <button
                                      type="button"
                                      onClick={() => openEdit(s)}
                                      className="p-2 rounded-lg hover:bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] transition-colors duration-150 btn-press chq-focus"
                                      title={tCommon('edit')}
                                    >
                                      <Edit size={18} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openQRModal(s)}
                                      className="p-2 rounded-lg hover:bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] transition-colors duration-150 btn-press chq-focus"
                                      title={ts('viewQR')}
                                    >
                                      <Eye size={18} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 md:hidden">
                {paginatedStudents.map((s, index) => {
                  const bal = balanceByStudent[s.id] ?? 0;
                  const balNum = Number(bal);
                  const statusKey = studentStatusLabelKey(s.lifecycle_status);
                  const hasParent = s.parent_phone != null && String(s.parent_phone).trim() !== '';
                  const idLineClass = searchQuery.trim()
                    ? 'text-xs text-[var(--color-text-muted)]'
                    : 'text-xs text-[var(--color-text-tertiary)]';
                  return (
                    <SwipeRow
                      key={s.id}
                      actions={[
                        {
                          label: ts('addToCardOrder'),
                          variant: 'default',
                          icon: (
                            <ShoppingCart
                              size={16}
                              className={isStudentInCart(s.id) ? 'text-teal-500 fill-teal-500' : 'text-[var(--color-text-muted)]'}
                            />
                          ),
                          onClick: () => {
                            void addStudentToCart(s.id);
                          },
                        },
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
                          onClick: () => router.push('/attendance'),
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
                          <input
                            type="checkbox"
                            className="mt-1 shrink-0"
                            checked={bulkSelected.has(s.id)}
                            disabled={studentCardDelivered[s.id] || isStudentInCart(s.id)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleBulkStudent(s.id)}
                          />
                          <div className="w-9 h-9 rounded-full shrink-0 bg-[rgba(13,148,136,0.12)] text-brand-400 font-semibold text-sm flex items-center justify-center">
                            {(s.name ?? '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Link
                                href={`/students/${s.id}`}
                                className="text-sm font-semibold text-[var(--color-text-primary)] truncate btn-press chq-focus rounded outline-offset-2"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {s.name}
                              </Link>
                              <LifecycleBadge status={s.lifecycle_status} label={ts(statusKey, { defaultValue: studentStatusLabelFallback(s.lifecycle_status) })} />
                              {s.parent_consent_given && (
                                <span
                                  className="badge badge-success text-[10px] px-1.5 py-0"
                                  title={ts('parentConsented', { defaultValue: 'Parent consented' })}
                                >
                                  ✓
                                </span>
                              )}
                            </div>
                            {s.student_number ? (
                              <p className={`${idLineClass} mt-0.5`} dir="ltr">
                                {formatStudentNumberForDisplay(s.student_number)}
                              </p>
                            ) : null}
                            {s.phone ? (
                              <p className="text-xs text-[var(--color-text-tertiary)] font-mono mt-0.5" dir="ltr">
                                {s.phone}
                              </p>
                            ) : null}
                            <div
                              className="relative mt-2 inline-flex flex-wrap items-center gap-2"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                              role="presentation"
                            >
                              {!hasParent ? (
                                <button
                                  type="button"
                                  data-parent-phone-trigger
                                  className="inline-flex items-center justify-center rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] btn-press chq-focus"
                                  aria-label={ts('addParentPhone')}
                                  onClick={() => {
                                    setOpenPopoverId(s.id);
                                    setParentPhoneDraft('');
                                  }}
                                >
                                  <Phone className="h-4 w-4" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  data-parent-phone-trigger
                                  className="inline-flex items-center gap-1.5 rounded-lg py-1 pe-2 text-start hover:bg-[var(--color-surface-2)] btn-press chq-focus"
                                  onClick={() => {
                                    setOpenPopoverId(s.id);
                                    setParentPhoneDraft(String(s.parent_phone ?? ''));
                                  }}
                                >
                                  <span className="text-xs text-[var(--color-text-secondary)]" dir="ltr">
                                    {s.parent_phone}
                                  </span>
                                  <Pencil className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
                                </button>
                              )}
                              {openPopoverId === s.id && !isDesktopLayout ? (
                                <div
                                  ref={parentPhonePopoverRef}
                                  className="absolute z-[60] start-0 top-full mt-1 min-w-[220px] rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-3 shadow-lg"
                                  onClick={(e) => e.stopPropagation()}
                                  role="dialog"
                                  aria-label={hasParent ? ts('editParentPhone') : ts('addParentPhone')}
                                >
                                  <input
                                    type="tel"
                                    value={parentPhoneDraft}
                                    onChange={(e) => setParentPhoneDraft(e.target.value)}
                                    placeholder={ts('parentPhonePlaceholder')}
                                    dir="ltr"
                                    className="w-full rounded-lg border border-input bg-[var(--color-surface-0)] px-3 py-2 text-sm"
                                  />
                                  <div className="mt-2 flex gap-2">
                                    <button
                                      type="button"
                                      disabled={savingParentPhoneId === s.id}
                                      className="flex-1 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50 btn-press chq-focus"
                                      onClick={() => void saveParentPhoneInline(s.id)}
                                    >
                                      {savingParentPhoneId === s.id ? tCommon('loading') : ts('save')}
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-lg border border-[var(--color-border-default)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] btn-press chq-focus"
                                      onClick={() => setOpenPopoverId(null)}
                                    >
                                      {ts('cancel')}
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
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
                              <span className="text-xs text-red-600 dark:text-red-400 font-medium">{ts('balance_due')}:</span>
                              <span className="text-xs font-semibold text-red-600 dark:text-red-400 tabular-nums">
                                {formatCurrency(balNum, locale)}
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
                          <p className="text-xs text-[var(--color-text-muted)]">{ts('no_balance')}</p>
                        )}

                        {user?.center?.parent_pack_enabled === true && (
                          <div
                            className="flex items-center justify-between gap-2 pt-2 mt-2 border-t border-[var(--color-border-subtle)]"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                            role="presentation"
                          >
                            <span className="text-xs text-[var(--color-text-secondary)]">{ts('parentPackOptIn')}</span>
                            {(() => {
                              const canOptIn =
                                s.is_active === true &&
                                s.parent_phone != null &&
                                String(s.parent_phone).trim() !== '';
                              const toggleDisabled = !canOptIn || togglingIds.has(s.id);
                              const tip = !s.is_active
                                ? ts('packDisabledInactive')
                                : !s.parent_phone || String(s.parent_phone).trim() === ''
                                  ? ts('packDisabledNoPhone')
                                  : undefined;
                              return (
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={!!s.parent_pack_opted_in}
                                  disabled={toggleDisabled}
                                  title={tip}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (canOptIn) void handlePackToggle(s);
                                  }}
                                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${s.parent_pack_opted_in ? 'bg-teal-600' : 'bg-[var(--color-surface-3)]'} btn-press chq-focus`}
                                >
                                  {/* RTL-EXEMPT: knob uses physical translateX until refactored to inset-based thumb */}
                                  <span
                                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-[var(--color-surface-1)] shadow transition-transform ${s.parent_pack_opted_in ? 'translate-x-4' : 'translate-x-0.5'}`}
                                  />
                                </button>
                              );
                            })()}
                          </div>
                        )}

                        <div className="hidden md:flex flex-wrap items-center justify-end gap-1 pt-3 mt-2 border-t border-[var(--color-border-subtle)]">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void addStudentToCart(s.id);
                            }}
                            className={`p-2 rounded-lg hover:bg-[var(--color-surface-2)] active:scale-95 transition-transform ${isStudentInCart(s.id) ? 'text-teal-500' : 'text-[var(--color-text-muted)]'} btn-press chq-focus`}
                            aria-label={ts('addToCardOrder')}
                            title={ts('addToCardOrder')}
                          >
                            <ShoppingCart size={14} className={isStudentInCart(s.id) ? 'fill-teal-500' : ''} />
                          </button>
                          {canViewPayments && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPrintStudent({ id: s.id, name: s.name });
                              }}
                              className="p-2 rounded-lg hover:bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] btn-press chq-focus"
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
                            className="p-2 rounded-lg hover:bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] btn-press chq-focus"
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
                            className="p-2 rounded-lg hover:bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] btn-press chq-focus"
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
                            className="p-2 rounded-lg hover:bg-[rgba(239,68,68,0.12)] text-[var(--color-danger)] btn-press chq-focus"
                            title={tCommon('delete')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </SwipeRow>
                  );
                })}
                  </div>
                  {studentTotalPages > 1 ? (
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow">
                      <span className="text-sm text-[var(--color-text-secondary)]">
                        {ts('pageOf', { page: studentPageClamped, total: studentTotalPages })}
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setStudentListPage((p) => Math.max(1, p - 1))}
                          disabled={isFirstStudentPage}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] text-[var(--color-text-primary)] transition-colors btn-press chq-focus ${
                            isFirstStudentPage ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[var(--color-surface-0)]'
                          }`}
                        >
                          {ts('prevPage')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setStudentListPage((p) => Math.min(studentTotalPages, p + 1))}
                          disabled={isLastStudentPage}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] text-[var(--color-text-primary)] transition-colors btn-press chq-focus ${
                            isLastStudentPage ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[var(--color-surface-0)]'
                          }`}
                        >
                          {ts('nextPage')}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
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
              <button onClick={() => setShowAddModal(false)} className="btn-press chq-focus"><X size={18} className="text-[var(--color-text-secondary)]" /></button>
            </div>
            <form onSubmit={handleAddStudent} className="space-y-3">
              <input value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} placeholder={ts('studentName')} className="w-full px-3 py-2.5 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm" required />
              <input value={addForm.phone} onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))} placeholder={tCommon('phone')} type="tel" dir="ltr" className="w-full px-3 py-2.5 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm" />
              <button
                type="button"
                onClick={() => setShowParentSectionAdd((v) => !v)}
                className="w-full text-start text-sm font-medium text-teal-700 py-2 border border-dashed border-teal-200 rounded-lg px-3 hover:bg-teal-50/50 btn-press chq-focus"
              >
                {ts('parentSection')}
              </button>
              {showParentSectionAdd && (
                <div className="space-y-3 ps-1 border-s-2 border-teal-100 ms-1 pe-1">
                  <input
                    value={addForm.parentPhone}
                    onChange={(e) => setAddForm((f) => ({ ...f, parentPhone: e.target.value }))}
                    placeholder={ts('parentPhonePlaceholder')}
                    aria-label={ts('parentPhone')}
                    type="tel"
                    dir="ltr"
                    className="w-full px-3 py-2.5 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm"
                  />
                  {centerInfo?.parent_pack_enabled === true && (
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={addForm.parentPackOptIn}
                        onChange={(e) => setAddForm((f) => ({ ...f, parentPackOptIn: e.target.checked }))}
                        className="mt-1 rounded accent-teal-600"
                      />
                      <span className="text-sm text-[var(--color-text-primary)]">
                        <span className="font-medium block">{ts('parentPackOptIn')}</span>
                        <span className="text-xs text-[var(--color-text-secondary)]">{ts('parentPackOptInHint')}</span>
                      </span>
                    </label>
                  )}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{ts('groupRequired')}</label>
                <select
                  value={addForm.groupId}
                  onChange={(e) => { const gId = e.target.value; const g = groups.find((gr) => gr.id === gId); setAddForm((f) => ({ ...f, groupId: gId, subjectId: g ? subjects.find((s) => s.name === g.subject)?.id ?? '' : '', monthlyFee: g?.fee != null ? String(g.fee) : '' })); }}
                  className="w-full px-3 py-2.5 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm"
                  required
                  disabled={groups.length === 0}
                >
                  {groups.length === 0 ? (
                    <option value="" disabled>{ts('add.noGroupsPlaceholder')}</option>
                  ) : (
                    <option value="">{tCommon('select')}</option>
                  )}
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                      {g.fee != null ? ` (${formatCurrency(g.fee, locale)})` : ''}
                    </option>
                  ))}
                </select>
                {groups.length === 0 && (
                  <Link
                    href="/groups"
                    className="mt-1.5 inline-block text-xs text-teal-600 hover:underline"
                  >
                    {ts('add.createGroupHelper')}
                  </Link>
                )}
              </div>
              <p className="text-xs text-[var(--color-text-secondary)]">{ts('autoGenerateNumber')}</p>
              <div className="flex gap-2 justify-end mt-4">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 rounded-lg text-sm border border-border btn-press chq-focus">{tCommon('cancel')}</button>
                <button type="submit" disabled={isAdding} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 btn-press chq-focus" style={{ background: 'hsl(var(--primary))' }}>{isAdding ? tCommon('loading') : tCommon('save')}</button>
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
              <button onClick={() => setEditStudent(null)} className="btn-press chq-focus"><X size={18} className="text-[var(--color-text-secondary)]" /></button>
            </div>
            <div className="space-y-3">
              <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={ts('studentName')} className="w-full px-3 py-2.5 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm" />
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder={tCommon('phone')} type="tel" dir="ltr" className="w-full px-3 py-2.5 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm" />
              <button
                type="button"
                onClick={() => setShowParentSectionEdit((v) => !v)}
                className="w-full text-start text-sm font-medium text-teal-700 py-2 border border-dashed border-teal-200 rounded-lg px-3 hover:bg-teal-50/50 btn-press chq-focus"
              >
                {ts('parentSection')}
              </button>
              {showParentSectionEdit && (
                <div className="space-y-3 ps-1 border-s-2 border-teal-100 ms-1 pe-1">
                  <input
                    value={editParentPhone}
                    onChange={(e) => setEditParentPhone(e.target.value)}
                    placeholder={ts('parentPhonePlaceholder')}
                    aria-label={ts('parentPhone')}
                    type="tel"
                    dir="ltr"
                    className="w-full px-3 py-2.5 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm"
                  />
                  {user?.center?.parent_pack_enabled === true && (
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editParentPackOptIn}
                        onChange={(e) => setEditParentPackOptIn(e.target.checked)}
                        className="mt-1 rounded accent-teal-600"
                      />
                      <span className="text-sm text-[var(--color-text-primary)]">
                        <span className="font-medium block">{ts('parentPackOptIn')}</span>
                        <span className="text-xs text-[var(--color-text-secondary)]">{ts('parentPackOptInHint')}</span>
                      </span>
                    </label>
                  )}
                </div>
              )}
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
              <button onClick={() => setEditStudent(null)} className="px-4 py-2 rounded-lg text-sm border border-border btn-press chq-focus">{tCommon('cancel')}</button>
              <button onClick={saveEdit} disabled={isSavingEdit} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 btn-press chq-focus" style={{ background: 'hsl(var(--primary))' }}>{isSavingEdit ? tCommon('loading') : tCommon('save')}</button>
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
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 rounded-lg text-sm border border-border btn-press chq-focus">{tCommon('cancel')}</button>
              <button onClick={() => { if (deleteTarget) { handleDeleteStudent(deleteTarget); setDeleteTarget(null); } }} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-destructive hover:bg-destructive/90 btn-press chq-focus">{tCommon('delete')}</button>
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
              <button onClick={() => { setQrModalStudent(null); setQrDataUrl(null); }} className="p-1.5 rounded-lg hover:bg-muted btn-press chq-focus"><X size={18} className="text-[var(--color-text-secondary)]" /></button>
            </div>
            {/* Professional ID card */}
            <div className="flex justify-center mb-5">
              <div className="w-full max-w-[320px] rounded-2xl overflow-hidden shadow-xl">
                <QRCard
                  student={qrModalStudent}
                  qrDataUrl={qrDataUrl}
                  centerLogo={centerInfo?.logo_url ?? null}
                  centerName={centerInfo?.name ?? 'TutoringHQ'}
                  scale={1.2}
                  variant="preview"
                />
              </div>
            </div>
            {/* Student details below card */}
            <div className="text-center mb-4">
              <div className="font-bold text-[var(--color-text-primary)]">{qrModalStudent.name}</div>
              <div className="font-mono text-sm text-[var(--color-text-secondary)]">
                {formatStudentNumberForDisplay(qrModalStudent.student_number)}
              </div>
              {(balanceByStudent[qrModalStudent.id] ?? 0) > 0 && (
                <div className="mt-2 text-sm font-bold text-red-600">
                  {ts('balance')}: {formatCurrency(Math.round(balanceByStudent[qrModalStudent.id]!), locale)}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={downloadQR} disabled={!qrDataUrl} className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium border border-border hover:bg-muted transition-colors disabled:opacity-50 btn-press chq-focus">
                <Download size={14} /> {tCommon('download')}
              </button>
              <button onClick={printCard} disabled={!qrDataUrl} className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-colors disabled:opacity-50 btn-press chq-focus" style={{ background: 'hsl(var(--primary))' }}>
                <QrCode size={14} /> {tCommon('print')}
              </button>
            </div>
            {qrDataUrl && <button onClick={handleRegenerateQR} className="mt-3 w-full py-1 text-xs text-amber-500 hover:underline btn-press chq-focus">{ts('regenerateQR')}</button>}
          </div>
        </div>
      )}

      {showAnnouncementModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            if (!announcementSubmitting) setShowAnnouncementModal(false);
          }}
          role="presentation"
        >
          <div
            className="bg-[var(--color-surface-1)] rounded-2xl border border-border max-w-md w-full max-h-[90vh] overflow-y-auto p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-[var(--color-text-primary)]">{ts('sendAnnouncement')}</h3>
              <button
                type="button"
                disabled={announcementSubmitting}
                onClick={() => setShowAnnouncementModal(false)}
                className="p-1 rounded-lg hover:bg-muted btn-press chq-focus"
                aria-label={tCommon('cancel')}
              >
                <X size={18} className="text-[var(--color-text-secondary)]" />
              </button>
            </div>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setAnnouncementBlastType('ops')}
                className={`flex-1 py-2.5 rounded-lg text-xs font-semibold border transition-colors ${
                  announcementBlastType === 'ops'
                    ? 'border-teal-600 bg-teal-50 text-teal-900'
                    : 'border-[var(--color-border-default)] text-[var(--color-text-secondary)]'
                } btn-press chq-focus`}
              >
                {ts('announcementOps')}
              </button>
              <button
                type="button"
                onClick={() => setAnnouncementBlastType('promo')}
                className={`flex-1 py-2.5 rounded-lg text-xs font-semibold border transition-colors ${
                  announcementBlastType === 'promo'
                    ? 'border-amber-500 bg-amber-50 text-amber-900'
                    : 'border-[var(--color-border-default)] text-[var(--color-text-secondary)]'
                } btn-press chq-focus`}
              >
                {ts('announcementPromo')}
              </button>
            </div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">{ts('announcementMessage')}</label>
            <textarea
              value={announcementMessage}
              onChange={(e) => setAnnouncementMessage(e.target.value.slice(0, 200))}
              dir="rtl"
              maxLength={200}
              rows={4}
              className="w-full border border-input rounded-lg p-3 text-sm bg-[var(--color-surface-0)]"
            />
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1 text-end">
              {200 - announcementMessage.length}
            </p>
            <p className="text-xs font-medium text-[var(--color-text-secondary)] mt-3">{ts('announcementPreview')}</p>
            <div
              className="mt-1 p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-sm text-[var(--color-text-primary)] whitespace-pre-wrap"
              dir="rtl"
            >
              {announcementBlastType === 'promo'
                ? ts('announcementPreviewPromo', {
                    center: centerInfo?.name ?? '',
                    message: announcementMessage.trim() || '…',
                  })
                : ts('announcementPreviewOps', {
                    center: centerInfo?.name ?? '',
                    message: announcementMessage.trim() || '…',
                  })}
            </div>
            <p className="text-sm mt-3 text-[var(--color-text-primary)]">
              {ts('announcementParentsCount', {
                count: formatPlainInteger(Math.round(Number(activeParentsForAnnounce)), locale),
              })}
            </p>
            <p className="text-sm font-mono mt-1 text-[var(--color-text-primary)]" dir="ltr">
              {ts('announcementCost')}:{' '}
              {formatCurrency(
                Math.round(activeParentsForAnnounce * BLAST_PRICE_PER_PARENT * 100) / 100,
                locale,
              )}
            </p>
            {announcementCapWarning && !announcementCapReached && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
                {ts('announcementCapWarning', {
                  balance: formatPlainInteger(Math.round(announcementBalanceNum), locale),
                  cap: formatPlainInteger(Math.round(announcementCap), locale),
                })}
              </p>
            )}
            {announcementCapReached && (
              <p className="text-sm text-red-300 bg-red-950/30 border border-red-900/50 rounded-lg p-2 mt-2">
                {ts('announcementCapReached')}
              </p>
            )}
            <button
              type="button"
              disabled={
                announcementSubmitting ||
                !announcementBlastType ||
                !announcementMessage.trim() ||
                announcementCapReached ||
                activeParentsForAnnounce === 0
              }
              onClick={async () => {
                if (!announcementBlastType) return;
                setAnnouncementSubmitting(true);
                try {
                  const { data: { session } } = await supabase.auth.getSession();
                  if (!session?.access_token) return;
                  const res = await fetch('/api/parent-pack/announcement', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({
                      blast_type: announcementBlastType,
                      message: announcementMessage.trim(),
                    }),
                  });
                  if (!res.ok) {
                    toast.error(tToast('error'));
                    return;
                  }
                  const j = (await res.json()) as { sent?: number; totalCost?: number };
                  toast.success(
                    ts('announcementSentToast', {
                      count: j.sent ?? 0,
                      cost: formatNumber(j.totalCost ?? 0, locale),
                    }),
                  );
                  await refreshUser();
                  const meRes = await fetch('/api/me', {
                    headers: { Authorization: `Bearer ${session.access_token}` },
                  });
                  const meData = await meRes.json();
                  if (meData?.user?.center) {
                    setCenterInfo((prev) => ({
                      ...(prev ?? {}),
                      announcement_balance: meData.user.center.announcement_balance,
                      parent_pack_active_parents: meData.user.center.parent_pack_active_parents,
                    }));
                  }
                  setShowAnnouncementModal(false);
                  setAnnouncementMessage('');
                  setAnnouncementBlastType(null);
                } finally {
                  setAnnouncementSubmitting(false);
                }
              }}
              className="mt-4 w-full py-3 rounded-xl text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed btn-press chq-focus"
            >
              {announcementSubmitting ? tCommon('loading') : ts('announcementConfirm')}
            </button>
          </div>
        </div>
      )}

      {bulkSelected.size > 0 ? (
        <div className="fixed start-0 end-0 bottom-[calc(56px+env(safe-area-inset-bottom,0px))] md:bottom-6 z-[70] flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shadow-xl px-4 py-3 max-w-lg w-full">
            <span className="text-sm text-[var(--color-text-secondary)] flex-1 tabular-nums">{bulkSelected.size}</span>
            <button
              type="button"
              data-testid="students-bulk-add-cart"
              disabled={bulkSubmitting}
              className="px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 shrink-0"
              onClick={() => void bulkAddToCart()}
            >
              {tCart('picker.addSelected', { count: bulkSelected.size })}
            </button>
          </div>
        </div>
      ) : null}

      {/* Print Statement Modal */}
      {printStudent && (
        <PrintStatementModal
          studentId={printStudent.id}
          studentName={printStudent.name}
          isOpen={true}
          onClose={() => setPrintStudent(null)}
        />
      )}

      {/* Student lifecycle filters, definitions */}
      {statusHelpOpen ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="status-help-title"
          onClick={() => setStatusHelpOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 id="status-help-title" className="text-lg font-semibold text-[var(--color-text-primary)]">
                {ts('statusHelpTitle')}
              </h2>
              <button
                type="button"
                className="rounded-lg p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
                onClick={() => setStatusHelpOpen(false)}
                aria-label={ts('closeModal')}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{ts('statusHelpIntro')}</p>
            <ul className="space-y-3 text-sm text-[var(--color-text-primary)]">
              {(['all', 'active', 'at_risk', 'inactive', 'enrolled', 'churned'] as const).map((k) => (
                <li key={k}>
                  <span className="font-semibold text-teal-600 dark:text-teal-400">
                    {ts(lifecycleFilterLabelKey(k))}
                  </span>
                  <span className="text-[var(--color-text-secondary)]">, {ts(lifecycleStatusHelpKey(k))}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-6 w-full rounded-lg bg-teal-600 py-2.5 text-sm font-semibold text-white hover:bg-teal-700"
              onClick={() => setStatusHelpOpen(false)}
            >
              {ts('closeModal')}
            </button>
          </div>
        </div>
      ) : null}

    </>
  );
}
