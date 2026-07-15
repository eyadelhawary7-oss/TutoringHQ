'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbDelete, auditLog } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { Link as RouterLink } from '@/i18n/routing';
import { Plus, BookOpen, X, Users, Search, Link as LinkIcon, ClipboardList } from 'lucide-react';
import { AttendanceHeatmap } from '@/components/AttendanceHeatmap';
import EmptyState from '@/components/empty-states/EmptyState';
import { useToast } from '@/components/ui/ToastProvider';
import { formatCurrency, formatNumber, formatDate, formatPercent } from '@/lib/formatNumber';
import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';
import { isUuid, keepValidUuids } from '@/lib/uuid';
import * as Sentry from '@sentry/nextjs';

interface Group {
  id: string;
  name: string;
  subject: string | null;
  fee_per_class?: number;
  /** Member count (same as student_count; kept for mutations). */
  member_count?: number;
  /** Display count for UI (synced with member_count). */
  student_count?: number;
  teacher_name?: string | null;
  max_capacity?: number | null;
}

interface Student {
  id: string;
  name: string;
  subject: string | null;
  student_number?: string | null;
}

interface Subject {
  id: string;
  name: string;
}

export default function GroupsPage() {
  const t = useTranslations('groups');
  const tCommon = useTranslations('common');
  const tHeatmap = useTranslations('heatmap');
  const tAtt = useTranslations('attendance');
  const tToast = useTranslations('toasts');
  const tCut = useTranslations('centerCut');
  const { toast } = useToast();
  const locale = useLocale();
  const isRTL = locale === 'ar';
  const { user } = useUser();
  // Surface the real DB/validation reason in save toasts instead of a generic
  // "something went wrong" — a swallowed message is what hid the dropped-column
  // failure during the attendance rework. Falls back to the generic copy only
  // when there is genuinely no server message.
  const errorDetail = (e: unknown): string => {
    const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
    return msg && msg !== 'Unknown error' ? msg : t('errors.saveFailedGeneric');
  };
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [centerCode, setCenterCode] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [detailGroup, setDetailGroup] = useState<Group | null>(null);
  const [expandedHeatmapId, setExpandedHeatmapId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', subjectId: '', fee_per_class: '', centerCut: '', studentIds: [] as string[], maxCapacity: '' });
  const [addSearch, setAddSearch] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [members, setMembers] = useState<{ student_id: string; student_name: string; student_number?: string }[]>([]);
  const [studentOtherGroups, setStudentOtherGroups] = useState<Record<string, string[]>>({});
  const [addMemberSearch, setAddMemberSearch] = useState('');
  const [waitlist, setWaitlist] = useState<{ id: string; name: string; student_number?: string | null; parent_phone?: string | null }[]>([]);
  const [activeTab, setActiveTab] = useState<'members' | 'waitlist'>('members');
  const [sessionBreakdown, setSessionBreakdown] = useState<{ date: string; present: number }[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const loadData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
    const meData = await meRes.json();
    if (!meData?.user?.center_id) return;
    const cid = meData.user.center_id;
    setCenterId(cid);
    setUserId(meData.user.id);

    const { data: centerRow } = await dbSelect({
      table: 'centers',
      select: 'center_code',
      filters: [{ column: 'id', op: 'eq', value: cid }],
      single: true,
    });
    const centerInfo = Array.isArray(centerRow) ? centerRow[0] : centerRow;
    const code = (centerInfo as { center_code?: string | null } | null)?.center_code ?? null;
    setCenterCode(code);

    const [groupsRes, studentsRes, subjectsRes, slotsRes] = await Promise.all([
      dbSelect({
        table: 'student_groups',
        select: 'id, name, subject, fee_per_class, max_capacity',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
        order: { column: 'name' },
      }),
      dbSelect({
        table: 'students',
        select: 'id, name, subject, student_number',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
        order: { column: 'name' },
      }),
      dbSelect({
        table: 'subjects',
        select: 'id, name',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
        order: { column: 'name' },
      }),
      dbSelect({
        table: 'schedule_slots',
        select: 'group_id, teacher_id',
        filters: [{ column: 'center_id', op: 'eq', value: cid }],
      }),
    ]);

    const groupsData = (groupsRes.data || []) as Group[];
    const studentsData = (studentsRes.data || []) as Student[];
    const subjectsData = (subjectsRes.data || []) as Subject[];
    const slotsData = (slotsRes.data || []) as { group_id?: string | null; teacher_id: string }[];

    const memberCounts = await Promise.all(
      groupsData.map(async (g) => {
        const { data: mData } = await dbSelect({
          table: 'student_group_members',
          select: 'id',
          filters: [{ column: 'group_id', op: 'eq', value: g.id }],
        });
        return ((mData || []) as { id: string }[]).length;
      })
    );

    const groupToTeacher: Record<string, string> = {};
    const teacherIds = [...new Set(slotsData.map(s => s.teacher_id).filter(Boolean))];
    if (teacherIds.length > 0) {
      const { data: usersData } = await dbSelect({
        table: 'users',
        select: 'id, name',
        filters: [{ column: 'id', op: 'in', value: teacherIds }],
      });
      const users = (usersData || []) as { id: string; name: string | null }[];
      const userMap = Object.fromEntries(users.map(u => [u.id, u.name || '\u2014']));
      for (const slot of slotsData) {
        if (slot.group_id && slot.teacher_id && !groupToTeacher[slot.group_id]) {
          groupToTeacher[slot.group_id] = userMap[slot.teacher_id] ?? '\u2014';
        }
      }
    }

    setGroups(groupsData.map((g, i) => {
      const n = memberCounts[i] ?? 0;
      return {
        ...g,
        subject: g.subject ?? null,
        member_count: n,
        student_count: n,
        teacher_name: groupToTeacher[g.id] ?? null,
      };
    }));
    setStudents(studentsData);
    setSubjects(subjectsData);
    setIsLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (!detailGroup) setExpandedHeatmapId(null);
  }, [detailGroup]);

  // Per-session attendance breakdown for the open group (relocated here from the
  // former standalone Attendance "By Group" view — same attendance_scans source).
  useEffect(() => {
    if (!detailGroup) {
      setSessionBreakdown([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      setSessionsLoading(true);
      try {
        const { data } = await dbSelect({
          table: 'attendance_scans',
          select: 'scanned_at, session_date',
          filters: [{ column: 'group_id', op: 'eq', value: detailGroup.id }],
        });
        const rows = (data || []) as { scanned_at: string; session_date?: string | null }[];
        const counts: Record<string, number> = {};
        rows.forEach((r) => {
          const key = r.session_date || (r.scanned_at ? r.scanned_at.slice(0, 10) : '');
          if (!key) return;
          counts[key] = (counts[key] || 0) + 1;
        });
        const breakdown = Object.entries(counts)
          .map(([date, present]) => ({ date, present }))
          .sort((a, b) => (a.date < b.date ? 1 : -1));
        if (!cancelled) setSessionBreakdown(breakdown);
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailGroup]);

  const loadWaitlist = useCallback(async (groupId: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch(`/api/groups/${groupId}/waitlist`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const data = await res.json();
    setWaitlist(data?.waitlist ?? []);
  }, []);

  useEffect(() => {
    if (!detailGroup) { setMembers([]); setStudentOtherGroups({}); setWaitlist([]); return; }
    const loadMembers = async () => {
      const { data: membersData } = await dbSelect({
        table: 'student_group_members',
        select: 'student_id',
        filters: [{ column: 'group_id', op: 'eq', value: detailGroup.id }],
      });
      const membersList = (membersData || []) as { student_id: string }[];
      const ids = membersList.map(m => m.student_id);
      setMembers(ids.map((id: string) => {
        const s = students.find(st => st.id === id);
        return { student_id: id, student_name: s?.name || '', student_number: s?.student_number ?? undefined };
      }));

      const groupIds = groups.map(g => g.id);
      const { data: allMemberships } = await dbSelect({
        table: 'student_group_members',
        select: 'student_id, group_id',
        filters: groupIds.length > 0 ? [{ column: 'group_id', op: 'in' as const, value: groupIds }] : [],
      });
      const map: Record<string, string[]> = {};
      const memberships = (allMemberships || []) as { student_id: string; group_id: string }[];
      for (const m of memberships) {
        if (m.group_id === detailGroup.id) continue;
        const g = groups.find(gr => gr.id === m.group_id);
        if (g) {
          if (!map[m.student_id]) map[m.student_id] = [];
          map[m.student_id].push(g.name);
        }
      }
      setStudentOtherGroups(map);
    };
    loadMembers();
    if (detailGroup.max_capacity != null && detailGroup.max_capacity < 999) {
      loadWaitlist(detailGroup.id);
    }
  }, [detailGroup, students, groups, loadWaitlist]);

  const studentsForAddModal = useMemo(() => {
    if (!addSearch.trim()) return students;
    const q = addSearch.trim().toLowerCase();
    return students.filter(s =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.student_number || '').toLowerCase().includes(q)
    );
  }, [students, addSearch]);

  const studentsForAddInDetail = useMemo(() => {
    const alreadyInGroup = new Set(members.map(m => m.student_id));
    let list = students.filter(s => !alreadyInGroup.has(s.id));
    if (addMemberSearch.trim()) {
      const q = addMemberSearch.trim().toLowerCase();
      list = list.filter(s =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.student_number || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [students, members, addMemberSearch]);

  const handleAddGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId || !userId || !isUuid(centerId)) {
      toast.error(tToast('error'), t('pleaseWait', { defaultValue: 'Please wait, loading...' }));
      return;
    }
    if (!addForm.name.trim()) {
      toast.error(tToast('error'), t('groupNameRequired', { defaultValue: 'Group name is required' }));
      return;
    }
    if (!addForm.subjectId) {
      toast.error(tToast('error'), t('subjectRequired', { defaultValue: 'Subject is required' }));
      return;
    }
    const fee = Number(addForm.fee_per_class);
    if (isNaN(fee) || fee <= 0) {
      toast.error(tToast('error'), t('validFeeRequired', { defaultValue: 'Valid fee is required' }));
      return;
    }
    const centerCut = addForm.centerCut.trim() ? Number(addForm.centerCut) : 0;
    if (isNaN(centerCut) || centerCut < 0 || centerCut >= fee) {
      toast.error(tToast('error'), tCut('mustBeLessThanFee'));
      return;
    }
    const subjectName = subjects.find(s => s.id === addForm.subjectId)?.name ?? '';
    const memberIds = keepValidUuids(addForm.studentIds);
    setIsAdding(true);
    try {
      const maxCap = addForm.maxCapacity.trim() ? parseInt(addForm.maxCapacity, 10) : null;
      const { data, error } = await dbInsert({
        table: 'student_groups',
        data: { center_id: centerId, name: addForm.name.trim(), subject: subjectName, fee_per_class: fee, center_cut_egp: centerCut, max_capacity: maxCap && maxCap > 0 ? maxCap : null },
        single: true,
      });
      if (error) {
        Sentry.captureException(error, {
          tags: { feature: 'groups', action: 'create' },
          extra: { centerId, name: addForm.name, memberCount: memberIds.length },
        });
        toast.error(tToast('error'), errorDetail(error));
        setIsAdding(false);
        return;
      }
      const inserted = Array.isArray(data) ? data[0] : data;
      if (inserted?.id) {
        try {
          await auditLog({ centerId, userId, action: 'group_create', entityType: 'student_groups', entityId: inserted.id, details: { name: inserted.name } });
        } catch {}
        for (const sid of memberIds) {
          await dbInsert({ table: 'student_group_members', data: { group_id: inserted.id, student_id: sid }, select: false });
        }
        const addN = memberIds.length;
        setGroups(prev => [...prev, { id: inserted.id, name: inserted.name, subject: subjectName, fee_per_class: fee, member_count: addN, student_count: addN, teacher_name: null, max_capacity: maxCap }]);
        setShowAddModal(false);
        setAddForm({ name: '', subjectId: '', fee_per_class: '', centerCut: '', studentIds: [], maxCapacity: '' });
        toast.success(tToast('saved'));
      } else {
        toast.warning(t('groupCreatedRefresh'));
      }
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: 'groups', action: 'create' },
        extra: { centerId, name: addForm.name },
      });
      toast.error(tToast('error'), errorDetail(err));
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteGroup = async (id: string) => {
    if (!centerId || !userId || !confirm(t('deleteConfirm'))) return;
    await dbDelete({ table: 'student_group_members', filters: [{ column: 'group_id', op: 'eq', value: id }] });
    await dbDelete({ table: 'student_groups', filters: [{ column: 'id', op: 'eq', value: id }] });
    await auditLog({ centerId, userId, action: 'group_delete', entityType: 'student_groups', entityId: id });
    setGroups(prev => prev.filter(g => g.id !== id));
    if (detailGroup?.id === id) setDetailGroup(null);
  };

  const handleAddMember = async (studentId: string) => {
    if (!detailGroup || !centerId) return;
    const student = students.find(s => s.id === studentId);
    const { error } = await dbInsert({
      table: 'student_group_members',
      data: { group_id: detailGroup.id, student_id: studentId },
      select: false,
    });
    if (!error) {
      setMembers(prev => [...prev, { student_id: studentId, student_name: student?.name || '', student_number: student?.student_number ?? undefined }]);
      setGroups(prev =>
        prev.map((g) =>
          g.id === detailGroup.id
            ? { ...g, member_count: (g.member_count ?? 0) + 1, student_count: (g.student_count ?? g.member_count ?? 0) + 1 }
            : g,
        ),
      );
    } else {
      Sentry.captureException(error, { tags: { feature: 'groups', action: 'add_member' }, extra: { groupId: detailGroup.id, studentId } });
      toast.error(tToast('error'), errorDetail(error));
    }
  };

  const handleRemoveMember = async (studentId: string) => {
    if (!detailGroup || !centerId) return;
    await dbDelete({
      table: 'student_group_members',
      filters: [{ column: 'group_id', op: 'eq', value: detailGroup.id }, { column: 'student_id', op: 'eq', value: studentId }],
    });
    setMembers(prev => prev.filter(m => m.student_id !== studentId));
    setGroups(prev =>
      prev.map((g) => {
        if (g.id !== detailGroup.id) return g;
        const next = Math.max(0, (g.member_count ?? 1) - 1);
        return { ...g, member_count: next, student_count: next };
      }),
    );
    const maxCap = detailGroup.max_capacity ?? 999;
    const newCount = (detailGroup.student_count ?? detailGroup.member_count ?? 1) - 1;
    if (maxCap < 999 && newCount < maxCap) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        try {
          await fetch(`/api/groups/${detailGroup.id}/notify-waitlist`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          loadWaitlist(detailGroup.id);
        } catch {}
      }
    }
  };

  const handleCopyInviteLink = async (groupId: string) => {
    const code = centerCode ?? centerId;
    if (!code) {
      toast.error(tToast('error'));
      return;
    }
    const url = `https://tutoringhq.app/${locale}/join/${code}/${groupId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('linkCopied'));
    } catch {
      toast.error(tToast('error'));
    }
  };

  const toggleAddFormStudent = (studentId: string) => {
    setAddForm(prev => ({
      ...prev,
      studentIds: prev.studentIds.includes(studentId) ? prev.studentIds.filter(x => x !== studentId) : [...prev.studentIds, studentId],
    }));
  };

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="min-h-screen w-full bg-[var(--color-surface-0)] space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            {formatNumber(groups.length, locale)} {t('title')}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          <Plus size={16} /> {t('addGroup')}
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-16">
          <svg className="animate-spin h-8 w-8 text-teal-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          titleKey="groups.title"
          descriptionKey="groups.description"
          namespace="emptyStates"
          actionLabel="groups.action"
          onAction={() => setShowAddModal(true)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map(g => (
            <div
              key={g.id}
              className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-5 hover:shadow-md transition-shadow cursor-pointer group"
              onClick={() => setDetailGroup(g)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="p-2 bg-teal-100 rounded-lg">
                  <BookOpen className="w-5 h-5 text-teal-600" />
                </div>
                <div className="flex items-center">
                  <span
                    className="text-xs text-[var(--color-text-muted)] font-mono tabular-nums"
                    title={t('studentCount')}
                  >
                    {formatNumber(g.student_count ?? g.member_count ?? 0, locale)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyInviteLink(g.id);
                    }}
                    className="ms-3 p-1 text-[var(--color-text-muted)] hover:text-[var(--color-teal)] transition-colors"
                    aria-label={t('linkCopied')}
                    title={t('linkCopied')}
                  >
                    <LinkIcon size={16} />
                  </button>
                </div>
              </div>
              <h3 className="font-semibold text-[var(--color-text-primary)] mb-1">{g.name}</h3>
              <p className="text-sm text-[var(--color-text-secondary)] mb-3">{g.subject || tCommon('notSet')}</p>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[var(--color-text-primary)] font-mono">
                  {g.fee_per_class != null ? formatCurrency(g.fee_per_class, locale) : tCommon('notSet')}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">{t('perLesson')}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Group Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowAddModal(false)}>
          <div className="bg-[var(--color-surface-1)] rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-[var(--color-border-subtle)]">
              <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('addGroup')}</h2>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-[var(--color-surface-2)] rounded-lg transition-colors"><X className="w-5 h-5 text-[var(--color-text-secondary)]" /></button>
            </div>
            <form onSubmit={handleAddGroup} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('groupName')}</label>
                <input
                  value={addForm.name}
                  onChange={e => setAddForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm text-[var(--color-text-primary)]"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('subject')}</label>
                <select
                  value={addForm.subjectId}
                  onChange={e => setAddForm(prev => ({ ...prev, subjectId: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm text-[var(--color-text-primary)]"
                  required
                  disabled={subjects.length === 0}
                >
                  {subjects.length === 0 ? (
                    <option value="" disabled>{t('add.noSubjectsPlaceholder')}</option>
                  ) : (
                    <option value="">{tCommon('select')}</option>
                  )}
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {subjects.length === 0 && (
                  <RouterLink
                    href="/settings/subjects"
                    className="mt-1.5 inline-block text-xs text-teal-600 hover:underline"
                  >
                    {t('add.createSubjectHelper')}
                  </RouterLink>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('feePerLesson')}</label>
                <input
                  name="fee_per_class"
                  value={addForm.fee_per_class}
                  onChange={e => setAddForm(prev => ({ ...prev, fee_per_class: e.target.value }))}
                  type="number"
                  min={0}
                  className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm font-mono text-[var(--color-text-primary)]"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{tCut('label')}</label>
                <input
                  value={addForm.centerCut}
                  onChange={e => setAddForm(prev => ({ ...prev, centerCut: e.target.value }))}
                  type="number"
                  min={0}
                  step={0.01}
                  className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm font-mono text-[var(--color-text-primary)]"
                />
                {addForm.centerCut.trim() !== '' && addForm.fee_per_class.trim() !== '' && Number(addForm.centerCut) >= Number(addForm.fee_per_class) && (
                  <p className="mt-1 text-xs text-[var(--color-danger)]">{tCut('mustBeLessThanFee')}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('maxCapacity', { defaultValue: 'السعة القصوى (اختياري)' })}</label>
                <input
                  value={addForm.maxCapacity}
                  onChange={e => setAddForm(prev => ({ ...prev, maxCapacity: e.target.value }))}
                  type="number"
                  min={0}
                  placeholder={t('optional', { defaultValue: 'اختياري' })}
                  className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm font-mono text-[var(--color-text-primary)]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('assignStudents')}</label>
                <div className="relative mb-2">
                  <Search size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-[var(--color-text-muted)]" />
                  <input
                    value={addSearch}
                    onChange={e => setAddSearch(e.target.value)}
                    placeholder={t('searchStudents')}
                    className="w-full ps-9 pe-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]"
                  />
                </div>
                <div className="max-h-32 overflow-y-auto border border-[var(--color-border)] rounded-lg p-2 space-y-1">
                  {studentsForAddModal.map(s => (
                    <label key={s.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-[var(--color-surface-2)] cursor-pointer">
                      <input type="checkbox" checked={addForm.studentIds.includes(s.id)} onChange={() => toggleAddFormStudent(s.id)} className="rounded accent-primary" />
                      <span className="flex flex-col min-w-0 flex-1">
                        <span className="text-sm text-[var(--color-text-primary)]">{s.name}</span>
                        {s.student_number ? (
                          <span className="text-xs text-[var(--color-text-muted)]" dir="ltr">{formatStudentNumberForDisplay(s.student_number)}</span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-end mt-4">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 rounded-lg text-sm border border-[var(--color-border)] text-[var(--color-text-secondary)]">{tCommon('cancel')}</button>
                <button type="submit" disabled={isAdding} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 transition-colors disabled:opacity-50">{tCommon('save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Group Detail Slide-over */}
      {detailGroup && (
        <div className="fixed inset-0 z-50" onClick={() => setDetailGroup(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute top-0 end-0 bottom-0 w-full max-w-md bg-[var(--color-surface-1)] border-s border-[var(--color-border)] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-[var(--color-border)] flex items-center justify-between">
              <h2 className="font-bold text-[var(--color-text-primary)] text-lg">{detailGroup.name}</h2>
              <button onClick={() => setDetailGroup(null)} className="p-1.5 rounded-lg hover:bg-[var(--color-surface-2)]"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div><p className="text-xs text-[var(--color-text-secondary)]">{t('subject')}</p><p className="font-semibold text-[var(--color-text-primary)]">{detailGroup.subject || tCommon('notSet')}</p></div>
                <div>
                  <p className="text-xs text-[var(--color-text-secondary)]">{t('feePerLesson')}</p>
                  <p className="font-semibold text-[var(--color-text-primary)] font-mono">
                    {detailGroup.fee_per_class != null ? formatCurrency(detailGroup.fee_per_class, locale) : tCommon('notSet')}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--color-text-secondary)]">{t('studentCount')}</p>
                  <p className="font-semibold text-[var(--color-text-primary)] font-mono tabular-nums">
                    {formatNumber(detailGroup.student_count ?? detailGroup.member_count ?? 0, locale)}
                    {detailGroup.max_capacity != null && detailGroup.max_capacity < 999
                      ? ` / ${formatNumber(detailGroup.max_capacity, locale)}`
                      : ''}
                  </p>
                </div>
              </div>
              {detailGroup.max_capacity != null && detailGroup.max_capacity < 999 && (
                <div className="flex gap-1 p-1 rounded-lg bg-[var(--color-surface-2)]/50">
                  <button type="button" onClick={() => setActiveTab('members')} className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium ${activeTab === 'members' ? 'bg-[var(--color-surface-0)] shadow text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>{t('members')}</button>
                  <button type="button" onClick={() => setActiveTab('waitlist')} className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium ${activeTab === 'waitlist' ? 'bg-[var(--color-surface-0)] shadow text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>{t('waitlist', { defaultValue: 'قائمة الانتظار' })} ({formatNumber(waitlist.length, locale)})</button>
                </div>
              )}
              <div className="border-t border-[var(--color-border)] pt-4">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setExpandedHeatmapId(expandedHeatmapId === detailGroup.id ? null : detailGroup.id); }}
                  className="text-sm text-teal-600 hover:text-teal-800 mt-2"
                >
                  {expandedHeatmapId === detailGroup.id ? tHeatmap('hide') : tHeatmap('show')}
                </button>
                {expandedHeatmapId === detailGroup.id && (
                  <AttendanceHeatmap
                    groupId={detailGroup.id}
                    groupSize={detailGroup.student_count ?? detailGroup.member_count ?? 0}
                    weeks={8}
                  />
                )}
              </div>

              {/* Per-session attendance breakdown (relocated from standalone Attendance page) */}
              <div className="border-t border-[var(--color-border)] pt-4">
                <h3 className="font-bold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
                  <ClipboardList size={16} /> {tAtt('sessionBreakdown')}
                </h3>
                {sessionsLoading ? (
                  <div className="flex justify-center py-6">
                    <div className="animate-spin h-5 w-5 border-2 border-teal-500 border-t-transparent rounded-full" />
                  </div>
                ) : sessionBreakdown.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-secondary)] py-2">{tAtt('noDataInPeriod')}</p>
                ) : (
                  (() => {
                    const sessionsCount = sessionBreakdown.length;
                    const totalPresent = sessionBreakdown.reduce((s, b) => s + b.present, 0);
                    const avg = sessionsCount > 0 ? totalPresent / sessionsCount : 0;
                    return (
                      <>
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          <div>
                            <p className="text-xs text-[var(--color-text-secondary)]">{tAtt('sessions')}</p>
                            <p className="font-semibold text-[var(--color-text-primary)] font-mono tabular-nums">
                              {formatNumber(sessionsCount, locale)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-[var(--color-text-secondary)]">{tAtt('avgAttendance')}</p>
                            <p className="font-semibold text-[var(--color-text-primary)] font-mono tabular-nums">
                              {formatNumber(Math.round(avg * 10) / 10, locale)}
                            </p>
                          </div>
                        </div>
                        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-0)]">
                                <th className="text-start py-2 px-3 text-xs font-semibold text-[var(--color-text-secondary)]">{tAtt('date')}</th>
                                <th className="text-start py-2 px-3 text-xs font-semibold text-[var(--color-text-secondary)]">{tAtt('studentsPresent')}</th>
                                <th className="text-start py-2 px-3 text-xs font-semibold text-[var(--color-text-secondary)]">{tAtt('attendanceRate')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sessionBreakdown.map((sb) => (
                                <tr key={sb.date} className="border-b border-[var(--color-border)] last:border-0">
                                  <td className="py-2 px-3 text-[var(--color-text-secondary)] text-start" dir="ltr">
                                    {formatDate(sb.date, locale, { dateStyle: 'short' })}
                                  </td>
                                  <td className="py-2 px-3 text-[var(--color-text-primary)] font-mono text-start">
                                    {formatNumber(sb.present, locale)}
                                  </td>
                                  <td className="py-2 px-3 text-start">
                                    {avg > 0 ? formatPercent(Math.round((sb.present / avg) * 100), locale) : tCommon('notSet')}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    );
                  })()
                )}
              </div>
              <div className="border-t border-[var(--color-border)] pt-4">
                {detailGroup.max_capacity != null && detailGroup.max_capacity < 999 && activeTab === 'waitlist' ? (
                  <>
                    <h3 className="font-bold text-[var(--color-text-primary)] mb-3">{t('waitlist', { defaultValue: 'قائمة الانتظار' })}</h3>
                    <div className="space-y-2 mb-4">
                      {waitlist.map((w, i) => (
                        <div key={w.id} className="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0">
                          <div>
                            <div className="text-sm font-medium text-[var(--color-text-primary)]"><bdi>#{i + 1}</bdi> {w.name}</div>
                            {w.student_number ? (
                              <div className="text-xs text-[var(--color-text-muted)] mt-0.5" dir="ltr">{formatStudentNumberForDisplay(w.student_number)}</div>
                            ) : w.parent_phone ? (
                              <div className="text-xs text-[var(--color-text-secondary)] font-mono mt-0.5" dir="ltr">{w.parent_phone}</div>
                            ) : (
                              <div className="text-xs text-[var(--color-text-secondary)] font-mono mt-0.5" dir="ltr">-</div>
                            )}
                          </div>
                        </div>
                      ))}
                      {waitlist.length === 0 && <p className="text-sm text-[var(--color-text-secondary)]">{t('noWaitlist', { defaultValue: 'لا يوجد في قائمة الانتظار' })}</p>}
                    </div>
                    <h4 className="text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('addToWaitlist', { defaultValue: 'إضافة لقائمة الانتظار' })}</h4>
                    <div className="flex flex-wrap gap-2">
                      {studentsForAddInDetail.filter(s => !waitlist.some(w => w.id === s.id)).slice(0, 10).map(s => (
                        <button key={s.id} type="button" onClick={async () => {
                          const { data: { session } } = await supabase.auth.getSession();
                          if (!session) return;
                          await fetch(`/api/groups/${detailGroup.id}/waitlist`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                            body: JSON.stringify({ student_id: s.id }),
                          });
                          loadWaitlist(detailGroup.id);
                        }} className="px-3 py-1.5 text-sm bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 transition-colors">
                          + {s.name}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                <h3 className="font-bold text-[var(--color-text-primary)] mb-3 flex items-center gap-2"><Users size={16} /> {t('members')}</h3>
                <div className="space-y-2 mb-4">
                  {members.map(m => (
                    <div key={m.student_id} className="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0">
                      <div>
                        <div className="text-sm font-medium text-[var(--color-text-primary)]">{m.student_name}</div>
                        {m.student_number ? (
                          <div className="text-xs text-[var(--color-text-muted)] mt-0.5" dir="ltr">{formatStudentNumberForDisplay(m.student_number)}</div>
                        ) : (
                          <div className="text-xs text-[var(--color-text-secondary)] font-mono mt-0.5" dir="ltr">-</div>
                        )}
                      </div>
                      <button type="button" onClick={() => handleRemoveMember(m.student_id)} className="text-xs text-[var(--color-danger)] hover:opacity-80 font-medium">
                        {t('remove')}
                      </button>
                    </div>
                  ))}
                  {members.length === 0 && <p className="text-sm text-[var(--color-text-secondary)]">{t('noMembers')}</p>}
                </div>
                <h4 className="text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('addStudent')}</h4>
                <div className="relative mb-2">
                  <Search size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-[var(--color-text-muted)]" />
                  <input
                    value={addMemberSearch}
                    onChange={e => setAddMemberSearch(e.target.value)}
                    placeholder={t('searchStudents')}
                    className="w-full ps-9 pe-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {studentsForAddInDetail.map(s => {
                    const otherGroups = studentOtherGroups[s.id] || [];
                    const suffix = otherGroups.length > 0 ? ` (${otherGroups.join(', ')})` : '';
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => handleAddMember(s.id)}
                        className="px-3 py-1.5 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
                      >
                        + {s.name}{suffix}
                      </button>
                    );
                  })}
                </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
