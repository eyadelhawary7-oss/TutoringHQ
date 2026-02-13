'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbDelete, auditLog } from '@/lib/db-proxy';
import Navbar from '@/components/Navbar';
import { useUser } from '@/contexts/UserContext';

interface Group {
  id: string;
  name: string;
  description: string | null;
  subject: string | null;
  fee?: number;
  member_count?: number;
}

interface Student {
  id: string;
  name: string;
  subject_name: string | null;
}

interface Subject {
  id: string;
  name: string;
}

export default function GroupsPage() {
  const t = useTranslations('groups');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { user } = useUser();
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [newGroupSubject, setNewGroupSubject] = useState('');
  const [newGroupFee, setNewGroupFee] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [members, setMembers] = useState<{ student_id: string; student_name: string }[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const meRes = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const meData = await meRes.json();
      if (!meData?.user?.center_id) return;
      setCenterId(meData.user.center_id);
      setUserId(meData.user.id);

      const [groupsRes, studentsRes, subjectsRes] = await Promise.all([
        dbSelect({
          table: 'student_groups',
          select: 'id, name, description, subject, fee',
          filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
          order: { column: 'name' },
        }),
        dbSelect({
          table: 'students',
          select: 'id, name, subject_name',
          filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
          order: { column: 'name' },
        }),
        dbSelect({
          table: 'subjects',
          select: 'id, name',
          filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
          order: { column: 'name' },
        }),
      ]);

      if (groupsRes.data) {
        const groupsData = groupsRes.data as Group[];
        const withCount = await Promise.all(
          groupsData.map(async (g) => {
            const { data: membersData } = await dbSelect({
              table: 'student_group_members',
              select: 'id',
              filters: [{ column: 'group_id', op: 'eq', value: g.id }],
            });
            return { ...g, subject: (g as Group).subject ?? null, member_count: (membersData || []).length };
          })
        );
        setGroups(withCount);
      }
      if (studentsRes.data) setStudents(studentsRes.data as Student[]);
      if (subjectsRes.data) setSubjects(subjectsRes.data as Subject[]);
      setIsLoading(false);
    };
    load();
  }, []);

  useEffect(() => {
    if (!selectedGroup) { setMembers([]); return; }
    const loadMembers = async () => {
      const { data } = await dbSelect({
        table: 'student_group_members',
        select: 'student_id',
        filters: [{ column: 'group_id', op: 'eq', value: selectedGroup }],
      });
      const ids = (data || []).map((m: { student_id: string }) => m.student_id);
      const names = students.filter(s => ids.includes(s.id));
      setMembers(ids.map((id: string) => ({ student_id: id, student_name: names.find(s => s.id === id)?.name || '' })));
    };
    loadMembers();
  }, [selectedGroup, students]);

  const handleAddGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    if (!centerId || !userId) {
      setAddError('Please wait, loading...');
      return;
    }
    if (!newGroupName.trim()) {
      setAddError('Group name is required');
      return;
    }
    if (!newGroupSubject) {
      setAddError('Subject is required');
      return;
    }
    const fee = Number(newGroupFee);
    if (isNaN(fee) || fee < 0) {
      setAddError('Valid monthly fee is required');
      return;
    }
    const subjectName = subjects.find((s) => s.id === newGroupSubject)?.name ?? '';
    setIsAdding(true);
    try {
      const { data, error } = await dbInsert({
        table: 'student_groups',
        data: { center_id: centerId, name: newGroupName.trim(), subject: subjectName, fee: Number(newGroupFee) || 0 },
        single: true,
      });
      if (error) {
        const msg = typeof error === 'object' && error?.message ? String(error.message) : 'Failed to create group';
        setAddError(msg);
        return;
      }
      const inserted = Array.isArray(data) ? data[0] : data;
      if (inserted && inserted.id) {
        try {
          await auditLog({
            centerId,
            userId,
            action: 'group_create',
            entityType: 'student_groups',
            entityId: inserted.id,
            details: { name: inserted.name },
          });
        } catch {}
        setGroups(prev => [...prev, { id: inserted.id, name: inserted.name, description: newGroupDesc.trim() || null, subject: subjectName, fee: Number(newGroupFee) || 0, member_count: 0 }]);
        setNewGroupName('');
        setNewGroupDesc('');
        setNewGroupSubject('');
        setNewGroupFee('');
      } else {
        setAddError('Group created but could not refresh. Please reload the page.');
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to create group');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteGroup = async (id: string) => {
    if (!centerId || !userId || !confirm(t('deleteConfirm'))) return;
    await dbDelete({
      table: 'student_group_members',
      filters: [{ column: 'group_id', op: 'eq', value: id }],
    });
    await dbDelete({
      table: 'student_groups',
      filters: [{ column: 'id', op: 'eq', value: id }],
    });
    await auditLog({ centerId, userId, action: 'group_delete', entityType: 'student_groups', entityId: id });
    setGroups(prev => prev.filter(g => g.id !== id));
    if (selectedGroup === id) setSelectedGroup(null);
  };

  const handleAddMember = async (studentId: string) => {
    if (!selectedGroup || !centerId || !userId) return;
    const student = students.find(s => s.id === studentId);
    const { error } = await dbInsert({
      table: 'student_group_members',
      data: { group_id: selectedGroup, student_id: studentId },
      select: false,
    });
    if (!error) {
      setMembers(prev => [...prev, { student_id: studentId, student_name: student?.name || '' }]);
    }
  };

  const filteredGroups = subjectFilter
    ? groups.filter((g) => g.subject === subjectFilter)
    : groups;

  const selectedGroupData = selectedGroup ? groups.find((g) => g.id === selectedGroup) : null;
  const studentsForGroup = selectedGroupData?.subject
    ? students.filter((s) => s.subject_name === selectedGroupData.subject)
    : students;

  const handleRemoveMember = async (studentId: string) => {
    if (!selectedGroup || !centerId) return;
    await dbDelete({
      table: 'student_group_members',
      filters: [
        { column: 'group_id', op: 'eq', value: selectedGroup },
        { column: 'student_id', op: 'eq', value: studentId },
      ],
    });
    setMembers(prev => prev.filter(m => m.student_id !== studentId));
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">{t('title')}</h1>

          {/* Subject filter pills */}
          {!isLoading && (
            <div className="mb-6 flex flex-wrap gap-2">
              <button
                onClick={() => setSubjectFilter(null)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  subjectFilter === null
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                {t('all')} ({groups.length})
              </button>
              {subjects.map((sub) => {
                const count = groups.filter((g) => g.subject === sub.name).length;
                if (count === 0) return null;
                return (
                  <button
                    key={sub.id}
                    onClick={() => setSubjectFilter(sub.name)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                      subjectFilter === sub.name
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    {sub.name} ({count})
                  </button>
                );
              })}
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-16">
              <svg className="animate-spin h-8 w-8 text-indigo-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="space-y-4">
                <form onSubmit={handleAddGroup} className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
                  <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('createGroup')}</h2>
                  <div className="mb-3">
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">{t('subject')} *</label>
                    <select
                      value={newGroupSubject}
                      onChange={(e) => { setNewGroupSubject(e.target.value); setAddError(''); }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                      required
                    >
                      <option value="">—</option>
                      {subjects.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={(e) => { setNewGroupName(e.target.value); setAddError(''); }}
                    placeholder={t('groupName')}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white mb-3"
                    required
                  />
                  <input
                    type="text"
                    value={newGroupDesc}
                    onChange={(e) => setNewGroupDesc(e.target.value)}
                    placeholder={t('description')}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white mb-3"
                  />
                  <div className="mb-3">
                    <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">{t('monthlyFee')} *</label>
                    <input
                      type="number"
                      value={newGroupFee}
                      onChange={(e) => setNewGroupFee(e.target.value)}
                      placeholder="0"
                      min={0}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                      required
                    />
                  </div>
                  {addError && (
                    <p className="mb-3 text-sm text-red-600 dark:text-red-400">{addError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={isAdding}
                    className="w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {tCommon('add')}
                  </button>
                </form>

                <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
                  <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('allGroups')}</h2>
                  <div className="space-y-2">
                    {filteredGroups.map((g) => (
                      <div
                        key={g.id}
                        className={`flex items-center justify-between p-3 rounded-lg cursor-pointer ${
                          selectedGroup === g.id ? 'bg-indigo-100 dark:bg-indigo-900/50' : 'bg-gray-50 dark:bg-gray-700/30'
                        }`}
                        onClick={() => setSelectedGroup(g.id)}
                      >
                        <span className="font-medium text-gray-900 dark:text-white">{g.name}</span>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          {(g.fee ?? 0).toLocaleString()} {t('feePerLessonShort', { defaultValue: 'EGP/lesson' })} · {(g as Group & { member_count?: number }).member_count ?? 0} {t('members')}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteGroup(g.id); }}
                          className="text-red-600 text-xs"
                        >
                          {tCommon('delete')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl shadow p-6">
                {selectedGroup ? (
                  <>
                    <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('members')}</h2>
                    <div className="space-y-2 mb-6">
                      {members.map((m) => (
                        <div key={m.student_id} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700/30 rounded">
                          <span>{m.student_name}</span>
                          <button onClick={() => handleRemoveMember(m.student_id)} className="text-red-600 text-xs">
                            {t('remove')}
                          </button>
                        </div>
                      ))}
                    </div>
                    <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">{t('addStudent')}</h3>
                    <div className="flex flex-wrap gap-2">
                      {studentsForGroup
                        .filter(s => !members.some(m => m.student_id === s.id))
                        .map((s) => (
                          <button
                            key={s.id}
                            onClick={() => handleAddMember(s.id)}
                            className="px-3 py-1 text-sm bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-200"
                          >
                            + {s.name}
                          </button>
                        ))}
                    </div>
                  </>
                ) : (
                  <p className="text-gray-500 dark:text-gray-400">{t('selectGroup')}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
