'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbDelete, auditLog } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { Plus, BookOpen, X, Users, ChevronRight, Search } from 'lucide-react';

interface Group {
  id: string;
  name: string;
  subject: string | null;
  fee?: number;
  member_count?: number;
  teacher_name?: string | null;
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
  const locale = useLocale();
  const isRTL = locale === 'ar';
  const { user } = useUser();
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [detailGroup, setDetailGroup] = useState<Group | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', subjectId: '', fee: '', studentIds: [] as string[] });
  const [addSearch, setAddSearch] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [members, setMembers] = useState<{ student_id: string; student_name: string; student_number?: string }[]>([]);
  const [studentOtherGroups, setStudentOtherGroups] = useState<Record<string, string[]>>({});
  const [addMemberSearch, setAddMemberSearch] = useState('');

  const loadData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
    const meData = await meRes.json();
    if (!meData?.user?.center_id) return;
    const cid = meData.user.center_id;
    setCenterId(cid);
    setUserId(meData.user.id);

    const [groupsRes, studentsRes, subjectsRes, slotsRes] = await Promise.all([
      dbSelect({
        table: 'student_groups',
        select: 'id, name, subject, fee',
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

    setGroups(groupsData.map((g, i) => ({
      ...g,
      subject: g.subject ?? null,
      member_count: memberCounts[i],
      teacher_name: groupToTeacher[g.id] ?? null,
    })));
    setStudents(studentsData);
    setSubjects(subjectsData);
    setIsLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (!detailGroup) { setMembers([]); setStudentOtherGroups({}); return; }
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
  }, [detailGroup, students, groups]);

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
    setAddError('');
    if (!centerId || !userId) {
      setAddError(t('pleaseWait', { defaultValue: 'Please wait, loading...' }));
      return;
    }
    if (!addForm.name.trim()) {
      setAddError(t('groupNameRequired', { defaultValue: 'Group name is required' }));
      return;
    }
    if (!addForm.subjectId) {
      setAddError(t('subjectRequired', { defaultValue: 'Subject is required' }));
      return;
    }
    const fee = Number(addForm.fee);
    if (isNaN(fee) || fee < 0) {
      setAddError(t('validFeeRequired', { defaultValue: 'Valid fee is required' }));
      return;
    }
    const subjectName = subjects.find(s => s.id === addForm.subjectId)?.name ?? '';
    setIsAdding(true);
    try {
      const { data, error } = await dbInsert({
        table: 'student_groups',
        data: { center_id: centerId, name: addForm.name.trim(), subject: subjectName, fee: fee },
        single: true,
      });
      if (error) {
        setAddError(typeof error === 'object' && error?.message ? String(error.message) : 'Failed to create group');
        setIsAdding(false);
        return;
      }
      const inserted = Array.isArray(data) ? data[0] : data;
      if (inserted?.id) {
        try {
          await auditLog({ centerId, userId, action: 'group_create', entityType: 'student_groups', entityId: inserted.id, details: { name: inserted.name } });
        } catch {}
        for (const sid of addForm.studentIds) {
          await dbInsert({ table: 'student_group_members', data: { group_id: inserted.id, student_id: sid }, select: false });
        }
        setGroups(prev => [...prev, { id: inserted.id, name: inserted.name, subject: subjectName, fee, member_count: addForm.studentIds.length, teacher_name: null }]);
        setShowAddModal(false);
        setAddForm({ name: '', subjectId: '', fee: '', studentIds: [] });
      } else {
        setAddError(t('groupCreatedRefresh', { defaultValue: 'Group created but could not refresh.' }));
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to create group');
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
      setGroups(prev => prev.map(g => g.id === detailGroup.id ? { ...g, member_count: (g.member_count ?? 0) + 1 } : g));
    }
  };

  const handleRemoveMember = async (studentId: string) => {
    if (!detailGroup || !centerId) return;
    await dbDelete({
      table: 'student_group_members',
      filters: [{ column: 'group_id', op: 'eq', value: detailGroup.id }, { column: 'student_id', op: 'eq', value: studentId }],
    });
    setMembers(prev => prev.filter(m => m.student_id !== studentId));
    setGroups(prev => prev.map(g => g.id === detailGroup.id ? { ...g, member_count: Math.max(0, (g.member_count ?? 1) - 1) } : g));
  };

  const toggleAddFormStudent = (studentId: string) => {
    setAddForm(prev => ({
      ...prev,
      studentIds: prev.studentIds.includes(studentId) ? prev.studentIds.filter(x => x !== studentId) : [...prev.studentIds, studentId],
    }));
  };

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{groups.length} {t('title')}</p>
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
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map(g => (
            <div
              key={g.id}
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition-shadow cursor-pointer group"
              onClick={() => setDetailGroup(g)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="p-2 bg-teal-100 rounded-lg">
                  <BookOpen className="w-5 h-5 text-teal-600" />
                </div>
                <span className="text-xs text-slate-400">{g.member_count ?? 0} {tCommon('students')}</span>
              </div>
              <h3 className="font-semibold text-slate-900 mb-1">{g.name}</h3>
              <p className="text-sm text-slate-500 mb-3">{g.subject ?? '\u2014'}</p>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900 font-mono">EGP {(g.fee ?? 0).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')}</span>
                <span className="text-xs text-slate-400">per lesson</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Group Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">{t('addGroup')}</h2>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors"><X className="w-5 h-5 text-slate-500" /></button>
            </div>
            <form onSubmit={handleAddGroup} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t('groupName')}</label>
                <input
                  value={addForm.name}
                  onChange={e => setAddForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm text-foreground"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t('subject')}</label>
                <select
                  value={addForm.subjectId}
                  onChange={e => setAddForm(prev => ({ ...prev, subjectId: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm text-foreground"
                  required
                >
                  <option value="">{tCommon('select')}</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t('feePerLesson')}</label>
                <input
                  value={addForm.fee}
                  onChange={e => setAddForm(prev => ({ ...prev, fee: e.target.value }))}
                  type="number"
                  min={0}
                  className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-sm font-mono text-foreground"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t('assignStudents')}</label>
                <div className="relative mb-2">
                  <Search size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
                  <input
                    value={addSearch}
                    onChange={e => setAddSearch(e.target.value)}
                    placeholder={t('searchStudents')}
                    className="w-full ps-9 pe-3 py-2 rounded-lg border border-input bg-background text-sm text-foreground placeholder:text-slate-400"
                  />
                </div>
                <div className="max-h-32 overflow-y-auto border border-border rounded-lg p-2 space-y-1">
                  {studentsForAddModal.map(s => (
                    <label key={s.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted cursor-pointer">
                      <input type="checkbox" checked={addForm.studentIds.includes(s.id)} onChange={() => toggleAddFormStudent(s.id)} className="rounded accent-primary" />
                      <span className="text-sm text-foreground">{s.name}</span>
                      <span className="text-xs text-muted-foreground font-mono ms-auto" dir="ltr">{s.student_number ?? '\u2014'}</span>
                    </label>
                  ))}
                </div>
              </div>
              {addError && <p className="text-sm text-red-600">{addError}</p>}
              <div className="flex gap-2 justify-end mt-4">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 rounded-lg text-sm border border-border text-muted-foreground">{tCommon('cancel')}</button>
                <button type="submit" disabled={isAdding} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'hsl(var(--primary))' }}>{tCommon('save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Group Detail Slide-over */}
      {detailGroup && (
        <div className="fixed inset-0 z-50" onClick={() => setDetailGroup(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute top-0 end-0 bottom-0 w-full max-w-md bg-card border-s border-border overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h2 className="font-bold text-foreground text-lg">{detailGroup.name}</h2>
              <button onClick={() => setDetailGroup(null)} className="p-1.5 rounded-lg hover:bg-muted"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div><p className="text-xs text-muted-foreground">{t('subject')}</p><p className="font-semibold text-foreground">{detailGroup.subject ?? '\u2014'}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('feePerLesson')}</p><p className="font-semibold text-foreground font-mono">{(detailGroup.fee ?? 0).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')} {tCommon('egp')}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('studentCount')}</p><p className="font-semibold text-foreground font-mono">{detailGroup.member_count ?? 0}</p></div>
              </div>
              <div className="border-t border-border pt-4">
                <h3 className="font-bold text-foreground mb-3 flex items-center gap-2"><Users size={16} /> {t('members')}</h3>
                <div className="space-y-2 mb-4">
                  {members.map(m => (
                    <div key={m.student_id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <div>
                        <div className="text-sm font-medium text-foreground">{m.student_name}</div>
                        <div className="text-xs text-muted-foreground font-mono" dir="ltr">{m.student_number ?? '\u2014'}</div>
                      </div>
                      <button type="button" onClick={() => handleRemoveMember(m.student_id)} className="text-xs text-red-600 hover:text-red-700 font-medium">
                        {t('remove')}
                      </button>
                    </div>
                  ))}
                  {members.length === 0 && <p className="text-sm text-muted-foreground">{t('noMembers')}</p>}
                </div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">{t('addStudent')}</h4>
                <div className="relative mb-2">
                  <Search size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
                  <input
                    value={addMemberSearch}
                    onChange={e => setAddMemberSearch(e.target.value)}
                    placeholder={t('searchStudents')}
                    className="w-full ps-9 pe-3 py-2 rounded-lg border border-input bg-background text-sm text-foreground placeholder:text-slate-400"
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
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
