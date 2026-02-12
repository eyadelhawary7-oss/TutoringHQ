'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, dbDelete, auditLog } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import Navbar from '@/components/Navbar';
import { Link } from '@/i18n/routing';

interface Subject {
  id: string;
  name: string;
  monthly_fee: number;
}

interface TeamMember {
  id: string;
  name: string | null;
  phone: string;
  role: string;
}

const PERMISSION_KEYS = [
  { key: 'can_send_whatsapp' as const, labelKey: 'permWhatsApp' },
  { key: 'can_add_subjects' as const, labelKey: 'permSubjects' },
  { key: 'can_view_calendar' as const, labelKey: 'permCalendar' },
  { key: 'can_manage_payments' as const, labelKey: 'permPayments' },
];

interface CenterInfo {
  id: string;
  name: string;
  logo_url: string | null;
  scanner_default_mode: string;
  max_teachers?: number;
}

export default function SettingsPage() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { user: currentUser } = useUser();

  const [center, setCenter] = useState<CenterInfo | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savedMessage, setSavedMessage] = useState('');

  // Form states
  const [centerName, setCenterName] = useState('');
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectFee, setNewSubjectFee] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRole, setInviteRole] = useState('assistant');
  const [inviteError, setInviteError] = useState('');
  const [lastInvitePassword, setLastInvitePassword] = useState<string | null>(null);
  const [scannerMode, setScannerMode] = useState('camera');
  const [editingSubject, setEditingSubject] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editFee, setEditFee] = useState('');
  const [assistantPermissions, setAssistantPermissions] = useState<Record<string, Record<string, boolean>>>({});
  const [teacherLimits, setTeacherLimits] = useState({ current: 0, max: 8, canAdd: true });
  const [limitsLoading, setLimitsLoading] = useState(false);

  // Redirect assistants away from settings
  useEffect(() => {
    if (currentUser && currentUser.role === 'assistant') {
      router.replace('/dashboard');
    }
  }, [currentUser, router]);

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
      const userCenterId = meData.user.center_id;

      // Load center info (bypass RLS)
      const { data: centerData } = await dbSelect({
        table: 'centers',
        select: '*',
        filters: [{ column: 'id', op: 'eq', value: userCenterId }],
        single: true,
      });

      if (centerData) {
        setCenter(centerData as CenterInfo);
        setCenterName((centerData as CenterInfo).name || '');
        setScannerMode((centerData as CenterInfo).scanner_default_mode || 'camera');
      }

      // Load subjects (bypass RLS)
      const { data: subjectsData } = await dbSelect({
        table: 'subjects',
        select: '*',
        filters: [{ column: 'center_id', op: 'eq', value: userCenterId }],
        order: { column: 'name' },
      });

      if (subjectsData) setSubjects(subjectsData as Subject[]);

      // Load all team members (including current user for "You" display)
      const { data: membersData } = await dbSelect({
        table: 'users',
        select: 'id, name, phone, role',
        filters: [{ column: 'center_id', op: 'eq', value: userCenterId }],
      });

      if (membersData) {
        setTeamMembers((membersData as { id: string; name: string | null; phone: string; role: string }[]).map(m => ({
          id: m.id,
          name: m.name ?? null,
          phone: m.phone,
          role: m.role,
        })));
      }

      // Load permissions for assistants
      const { data: permData } = await dbSelect({
        table: 'permissions',
        select: 'user_id, permission_key, enabled',
        filters: [{ column: 'center_id', op: 'eq', value: userCenterId }],
      });

      const permMap: Record<string, Record<string, boolean>> = {};
      (permData || []).forEach((p: { user_id: string; permission_key: string; enabled: boolean }) => {
        if (!permMap[p.user_id]) permMap[p.user_id] = {};
        permMap[p.user_id][p.permission_key] = p.enabled;
      });
      setAssistantPermissions(permMap);

      setIsLoading(false);
    };
    load();
  }, []);

  useEffect(() => {
    const fetchLimits = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setLimitsLoading(true);
      try {
        const res = await fetch('/api/settings/limits', {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setTeacherLimits({
            current: data.currentTeachers ?? 0,
            max: data.maxTeachers ?? 8,
            canAdd: data.canAddTeacher ?? true,
          });
        }
      } catch (err) {
        console.error('Limits fetch error:', err);
      } finally {
        setLimitsLoading(false);
      }
    };
    if (centerId) fetchLimits();
  }, [centerId, teamMembers]);

  const showSaved = () => {
    setSavedMessage(t('saved'));
    setTimeout(() => setSavedMessage(''), 2000);
  };

  const handleSaveCenterName = async () => {
    if (!centerId || !userId || !centerName.trim()) return;
    const { error } = await dbUpdate({
      table: 'centers',
      data: { name: centerName.trim() },
      filters: [{ column: 'id', op: 'eq', value: centerId }],
    });
    if (!error) {
      await auditLog({ centerId, userId, action: 'center_update', entityType: 'centers', details: { field: 'name', value: centerName.trim() } });
      showSaved();
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !centerId || !userId) return;

    const ext = file.name.split('.').pop();
    const path = `${centerId}/logo.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('center-logos')
      .upload(path, file, { upsert: true });

    if (uploadError) {
      console.error('Logo upload error:', uploadError);
      return;
    }

    const { data: publicData } = supabase.storage.from('center-logos').getPublicUrl(path);
    const { error } = await dbUpdate({
      table: 'centers',
      data: { logo_url: publicData.publicUrl },
      filters: [{ column: 'id', op: 'eq', value: centerId }],
    });
    if (!error) {
      await auditLog({ centerId, userId, action: 'center_update', entityType: 'centers', details: { field: 'logo' } });
      setCenter(prev => prev ? { ...prev, logo_url: publicData.publicUrl } : null);
      showSaved();
    }
  };

  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId || !userId || !newSubjectName.trim()) return;

    const { data, error } = await dbInsert({
      table: 'subjects',
      data: {
        center_id: centerId,
        name: newSubjectName.trim(),
        monthly_fee: Number(newSubjectFee) || 0,
      },
      single: true,
    });

    if (!error && data) {
      const subject = data as Subject;
      await auditLog({
        centerId,
        userId,
        action: 'subject_create',
        entityType: 'subjects',
        entityId: subject.id,
        details: { name: subject.name, monthly_fee: subject.monthly_fee },
      });
      setSubjects(prev => [...prev, subject]);
      setNewSubjectName('');
      setNewSubjectFee('');
      showSaved();
    }
  };

  const handleUpdateSubject = async (id: string) => {
    if (!centerId || !userId) return;
    const { error } = await dbUpdate({
      table: 'subjects',
      data: { name: editName.trim(), monthly_fee: Number(editFee) || 0 },
      filters: [{ column: 'id', op: 'eq', value: id }],
    });

    if (!error) {
      await auditLog({
        centerId,
        userId,
        action: 'subject_update',
        entityType: 'subjects',
        entityId: id,
        details: { name: editName.trim(), monthly_fee: Number(editFee) || 0 },
      });
      setSubjects(prev => prev.map(s => s.id === id ? { ...s, name: editName.trim(), monthly_fee: Number(editFee) || 0 } : s));
      setEditingSubject(null);
      showSaved();
    }
  };

  const handleDeleteSubject = async (id: string) => {
    if (!confirm(t('deleteConfirm')) || !centerId || !userId) return;

    // Check if any students use this subject (by subject_name, not subject_id - students have subject_name string)
    const { data: studentsWithSubject } = await dbSelect({
      table: 'students',
      select: 'id',
      filters: [{ column: 'subject_name', op: 'eq', value: subjects.find(s => s.id === id)?.name ?? '' }],
      limit: 1,
    });
    if (studentsWithSubject && (studentsWithSubject as unknown[]).length > 0) {
      alert(t('subjectInUse'));
      return;
    }

    const { error } = await dbDelete({
      table: 'subjects',
      filters: [{ column: 'id', op: 'eq', value: id }],
    });
    if (!error) {
      await auditLog({
        centerId,
        userId,
        action: 'subject_delete',
        entityType: 'subjects',
        entityId: id,
        details: { name: subjects.find(s => s.id === id)?.name },
      });
      setSubjects(prev => prev.filter(s => s.id !== id));
    }
  };

  function generateTempPassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let pwd = '';
    for (let i = 0; i < 8; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pwd;
  }

  const handleInviteTeamMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError('');
    setLastInvitePassword(null);
    if (!centerId || !userId) return;

    const phone = invitePhone.trim();
    const phoneValid = /^01\d{9}$/.test(phone);
    if (!phoneValid) {
      setInviteError(t('invalidPhone'));
      return;
    }

    if (inviteRole === 'teacher' && !teacherLimits.canAdd) {
      setInviteError(t('limitReached'));
      return;
    }

    const tempPassword = generateTempPassword();
    const { data, error } = await dbInsert({
      table: 'users',
      data: {
        name: inviteName.trim() || null,
        phone,
        center_id: centerId,
        role: inviteRole,
      },
      select: 'id, name, phone, role',
      single: true,
    });

    if (!error && data) {
      const member = data as TeamMember;
      await auditLog({
        centerId,
        userId,
        action: 'team_member_invite',
        entityType: 'users',
        entityId: member.id,
        details: { name: member.name, phone: member.phone, role: member.role },
      });
      setTeamMembers(prev => [...prev, member]);
      setInviteName('');
      setInvitePhone('');
      setInviteRole('assistant');
      setLastInvitePassword(tempPassword);
      if (inviteRole === 'teacher') {
        setTeacherLimits(prev => ({ ...prev, current: prev.current + 1, canAdd: prev.current + 1 < prev.max }));
      }
      showSaved();
    } else {
      setInviteError('Failed to add member');
    }
  };

  const handleRemoveMember = async (member: TeamMember) => {
    if (!centerId || !userId || member.id === userId) return;
    const displayName = member.name || member.phone || '?';
    if (!confirm(t('confirmRemove', { name: displayName }))) return;

    const { error } = await dbDelete({
      table: 'users',
      filters: [{ column: 'id', op: 'eq', value: member.id }],
    });

    if (!error) {
      await auditLog({
        centerId,
        userId,
        action: 'team_member_remove',
        entityType: 'users',
        entityId: member.id,
        details: { name: member.name, phone: member.phone, role: member.role },
      });
      setTeamMembers(prev => prev.filter(m => m.id !== member.id));
      if (member.role === 'teacher') {
        setTeacherLimits(prev => ({
          ...prev,
          current: Math.max(0, prev.current - 1),
          canAdd: prev.current - 1 < prev.max,
        }));
      }
      setSavedMessage(t('memberRemoved'));
      setTimeout(() => setSavedMessage(''), 2000);
    }
  };

  const handlePermissionToggle = async (assistantId: string, key: string, enabled: boolean) => {
    if (!centerId) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const res = await fetch('/api/permissions', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ targetUserId: assistantId, permissionKey: key, enabled, centerId }),
    });

    if (res.ok) {
      setAssistantPermissions(prev => ({
        ...prev,
        [assistantId]: {
          ...prev[assistantId],
          [key]: enabled,
        },
      }));
    }
  };

  const handleScannerMode = async (mode: string) => {
    if (!centerId || !userId) return;
    setScannerMode(mode);
    const { error } = await dbUpdate({
      table: 'centers',
      data: { scanner_default_mode: mode },
      filters: [{ column: 'id', op: 'eq', value: centerId }],
    });
    if (!error) {
      await auditLog({ centerId, userId, action: 'center_update', entityType: 'centers', details: { field: 'scanner_mode', value: mode } });
      showSaved();
    }
  };

  if (isLoading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-48 mb-6 animate-pulse" />
            <div className="space-y-8">
              <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
                <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-32 mb-4 animate-pulse" />
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-16 bg-gray-100 dark:bg-gray-700/50 rounded-lg animate-pulse" />
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">{t('title')}</h1>

          {/* Success message */}
          {savedMessage && (
            <div className="mb-4 p-3 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-sm text-center">
              {savedMessage}
            </div>
          )}

          <div className="space-y-8">
            {/* Center Info */}
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('centerInfo')}</h2>
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  {center?.logo_url ? (
                    <img src={center.logo_url} alt="Logo" className="w-16 h-16 rounded-lg object-cover" />
                  ) : (
                    <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900 rounded-lg flex items-center justify-center">
                      <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">RG</span>
                    </div>
                  )}
                  <label className="cursor-pointer px-4 py-2 text-sm font-medium border border-indigo-600 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors">
                    {center?.logo_url ? t('logoChange') : t('logoUpload')}
                    <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('centerName')}</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={centerName}
                      onChange={(e) => setCenterName(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                    />
                    <button
                      onClick={handleSaveCenterName}
                      className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                      {tCommon('save')}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Subjects */}
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('subjects')}</h2>
              
              {/* Existing subjects */}
              <div className="space-y-2 mb-4">
                {subjects.map((subject) => (
                  <div key={subject.id} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                    {editingSubject === subject.id ? (
                      <>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-700 dark:text-white"
                        />
                        <input
                          type="number"
                          value={editFee}
                          onChange={(e) => setEditFee(e.target.value)}
                          className="w-24 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-700 dark:text-white"
                        />
                        <button onClick={() => handleUpdateSubject(subject.id)} className="text-green-600 text-sm font-medium">
                          {tCommon('save')}
                        </button>
                        <button onClick={() => setEditingSubject(null)} className="text-gray-400 text-sm">
                          {tCommon('cancel')}
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm text-gray-900 dark:text-white font-medium">{subject.name}</span>
                        <span className="text-sm text-gray-500 dark:text-gray-400">{subject.monthly_fee} EGP</span>
                        <button
                          onClick={() => { setEditingSubject(subject.id); setEditName(subject.name); setEditFee(String(subject.monthly_fee)); }}
                          className="text-indigo-600 dark:text-indigo-400 text-xs"
                        >
                          {tCommon('edit')}
                        </button>
                        <button
                          onClick={() => handleDeleteSubject(subject.id)}
                          className="text-red-600 dark:text-red-400 text-xs"
                        >
                          {tCommon('delete')}
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* Add subject form */}
              <form onSubmit={handleAddSubject} className="flex gap-2">
                <input
                  type="text"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  placeholder={t('subjectName')}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                  required
                />
                <input
                  type="number"
                  value={newSubjectFee}
                  onChange={(e) => setNewSubjectFee(e.target.value)}
                  placeholder={t('monthlyFee')}
                  className="w-28 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap"
                >
                  {t('addSubject')}
                </button>
              </form>
            </section>

            {/* Team Members */}
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('teamMembers')}</h2>

              {/* Teacher limit display with progress */}
              <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                {limitsLoading ? (
                  <div className="h-6 bg-gray-200 dark:bg-gray-600 rounded animate-pulse w-32" />
                ) : (
                  <>
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className={`font-medium ${
                        teacherLimits.current >= teacherLimits.max
                          ? 'text-red-600 dark:text-red-400'
                          : teacherLimits.current >= teacherLimits.max - 1
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-green-600 dark:text-green-400'
                      }`}>
                        {t('teacherLimit', { current: teacherLimits.current, max: teacherLimits.max })}
                      </span>
                    </div>
                    <div className="h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          teacherLimits.current >= teacherLimits.max
                            ? 'bg-red-500'
                            : teacherLimits.current >= teacherLimits.max - 1
                            ? 'bg-amber-500'
                            : 'bg-green-500'
                        }`}
                        style={{ width: `${teacherLimits.max > 0 ? Math.min(100, (teacherLimits.current / teacherLimits.max) * 100) : 0}%` }}
                      />
                    </div>
                    {!teacherLimits.canAdd && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-2">{t('limitReached')}. {t('upgradeToAddMore')}</p>
                    )}
                  </>
                )}
              </div>

              {/* Team members list - grouped by role with section headers */}
              <div className="space-y-4 mb-6">
                {teamMembers.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-6 text-center">{t('noTeamMembers')}</p>
                ) : (
                  <>
                    {[
                      { role: 'admin', label: t('admins'), members: teamMembers.filter(m => m.role === 'admin' || m.role === 'owner') },
                      { role: 'assistant', label: t('assistants'), members: teamMembers.filter(m => m.role === 'assistant') },
                      { role: 'teacher', label: t('teachers'), members: teamMembers.filter(m => m.role === 'teacher') },
                    ].map(({ label, members }) =>
                      members.length > 0 ? (
                        <div key={label}>
                          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">{label}</h3>
                          <div className="space-y-3">
                            {members.map((member) => {
                              const isSelf = member.id === userId;
                              const roleBadgeClass =
                                member.role === 'admin' || member.role === 'owner'
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300'
                                  : member.role === 'assistant'
                                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                                  : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300';
                              const permKeys =
                                member.role === 'teacher'
                                  ? [PERMISSION_KEYS.find(k => k.key === 'can_view_calendar') ?? { key: 'can_view_calendar', labelKey: 'permCalendar' }]
                                  : PERMISSION_KEYS;
                              const isPermReadOnly =
                                member.role === 'admin' || member.role === 'owner' || member.role === 'teacher' || isSelf;
                              const permChecked =
                                member.role === 'admin' || member.role === 'owner'
                                  ? true
                                  : member.role === 'teacher'
                                  ? (k: string) => k === 'can_view_calendar'
                                  : (k: string) => assistantPermissions[member.id]?.[k] ?? false;

                              return (
                                <div
                          key={member.id}
                          className="p-4 bg-gray-50 dark:bg-gray-700/30 rounded-lg space-y-3"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium text-gray-900 dark:text-white">
                                {member.name || member.phone}
                              </span>
                              {member.name && (
                                <span className="text-xs text-gray-500 dark:text-gray-400 ml-2" dir="ltr">
                                  {member.phone}
                                </span>
                              )}
                              {isSelf && (
                                <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">{t('you')}</span>
                              )}
                            </div>
                            <span className={`px-2.5 py-1 text-xs font-medium rounded-full shrink-0 ${roleBadgeClass}`}>
                              {member.role === 'owner' ? t('admin') : member.role === 'admin' ? t('admin') : member.role === 'teacher' ? t('teacher') : t('assistant')}
                            </span>
                            {!isSelf && (
                              <button
                                type="button"
                                onClick={() => handleRemoveMember(member)}
                                className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                title={t('removeMember')}
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            )}
                          </div>
                          {permKeys.length > 0 && (
                            <div className="flex flex-wrap gap-4 pt-2 border-t border-gray-200 dark:border-gray-600">
                              {permKeys.map(({ key, labelKey }) => (
                                <label
                                  key={key}
                                  className={`flex items-center gap-1.5 text-xs ${isPermReadOnly ? 'cursor-default opacity-75' : 'cursor-pointer'}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={typeof permChecked === 'function' ? permChecked(key) : permChecked}
                                    onChange={(e) => !isPermReadOnly && handlePermissionToggle(member.id, key, e.target.checked)}
                                    disabled={isPermReadOnly}
                                    className="w-3.5 h-3.5 rounded text-indigo-600 disabled:opacity-60"
                                  />
                                  {t(labelKey)}
                                </label>
                              ))}
                            </div>
                          )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null
                    )}
                  </>
                )}
              </div>

              {/* Invite form */}
              <form onSubmit={handleInviteTeamMember} className="space-y-3">
                {inviteError && (
                  <p className="text-sm text-red-600 dark:text-red-400">{inviteError}</p>
                )}
                {lastInvitePassword && (
                  <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-sm text-green-700 dark:text-green-400">
                    <p className="font-medium">{t('inviteSuccess')}</p>
                    <p className="mt-1">{t('passwordIs', { password: lastInvitePassword })}</p>
                  </div>
                )}
                <div className="flex flex-wrap gap-3">
                  <input
                    type="text"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder={t('inviteName')}
                    className="flex-1 min-w-[120px] px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                  />
                  <input
                    type="tel"
                    value={invitePhone}
                    onChange={(e) => { setInvitePhone(e.target.value); setInviteError(''); }}
                    placeholder={t('invitePhone')}
                    dir="ltr"
                    className="flex-1 min-w-[120px] px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                    required
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                  >
                    <option value="assistant">{t('assistant')}</option>
                    <option value="teacher">{t('teacher')}</option>
                  </select>
                  <button
                    type="submit"
                    disabled={inviteRole === 'teacher' && !teacherLimits.canAdd}
                    title={inviteRole === 'teacher' && !teacherLimits.canAdd ? t('upgradeToAddMore') : undefined}
                    className="px-4 py-2 bg-indigo-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap"
                  >
                    {t('invite')}
                  </button>
                </div>
              </form>
            </section>

            {/* Scanner Config */}
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('scanner')}</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{t('defaultMode')}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleScannerMode('camera')}
                  className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium border-2 transition-colors ${
                    scannerMode === 'camera'
                      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300'
                      : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {t('camera')}
                </button>
                <button
                  onClick={() => handleScannerMode('bluetooth')}
                  className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium border-2 transition-colors ${
                    scannerMode === 'bluetooth'
                      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300'
                      : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {t('bluetooth')}
                </button>
              </div>
            </section>

            {/* Reminders link */}
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('reminders')}</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{t('remindersDesc')}</p>
              <Link
                href="/settings/reminders"
                className="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg"
              >
                {t('remindersLink')} →
              </Link>
            </section>

            {/* Billing link */}
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('billing')}</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{t('billingDesc')}</p>
              <Link
                href="/settings/billing"
                className="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg"
              >
                {t('billingLink')} →
              </Link>
            </section>

            {/* WhatsApp Settings link */}
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('whatsappSettings')}</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{t('whatsappSettingsDesc')}</p>
              <Link
                href="/settings/whatsapp"
                className="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg"
              >
                {t('whatsappSettingsLink')} →
              </Link>
            </section>

            {/* WhatsApp Integration */}
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                    <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 01-4.243-1.217l-.271-.162-2.87.853.853-2.87-.162-.271A8 8 0 1112 20z"/>
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">WhatsApp Business API</h2>
              </div>
              
              <div className="space-y-4">
                <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">Setup Instructions</h3>
                  <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-2 list-decimal list-inside">
                    <li>Create a Meta Business App at <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 underline">developers.facebook.com</a></li>
                    <li>Add WhatsApp product to your app</li>
                    <li>Get your permanent access token and Phone Number ID</li>
                    <li>Create a message template named <code className="px-1 bg-gray-200 dark:bg-gray-600 rounded text-xs">payment_reminder</code></li>
                    <li>Add the env vars to your deployment (Vercel)</li>
                    <li>Set webhook URL to: <code className="px-1 bg-gray-200 dark:bg-gray-600 rounded text-xs break-all">{typeof window !== 'undefined' ? window.location.origin : ''}/api/whatsapp/webhook</code></li>
                  </ol>
                </div>

                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <h3 className="text-sm font-medium text-green-800 dark:text-green-300 mb-2">Required Environment Variables</h3>
                  <div className="space-y-1 font-mono text-xs text-green-700 dark:text-green-400">
                    <p>WHATSAPP_ACCESS_TOKEN=your_token</p>
                    <p>WHATSAPP_PHONE_NUMBER_ID=your_phone_id</p>
                    <p>WHATSAPP_VERIFY_TOKEN=your_verify_token</p>
                  </div>
                </div>

                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <h3 className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2">Template Format</h3>
                  <p className="text-sm text-blue-700 dark:text-blue-400">
                    Create a template named <strong>payment_reminder</strong> with 4 body parameters:
                  </p>
                  <div className="mt-2 text-xs text-blue-600 dark:text-blue-400 font-mono">
                    {'{{1}}'} = Student Name<br/>
                    {'{{2}}'} = Center Name<br/>
                    {'{{3}}'} = Amount Due<br/>
                    {'{{4}}'} = Subject Name
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
