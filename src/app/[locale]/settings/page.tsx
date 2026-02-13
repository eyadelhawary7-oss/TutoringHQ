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
  monthly_fee?: number; // deprecated - fee is now on groups
}

interface TeamMember {
  id: string;
  name: string | null;
  phone: string;
  role: string;
}

const PERMISSION_KEYS = [
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
  const tReferral = useTranslations('referral');
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
  const [inviteName, setInviteName] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRole, setInviteRole] = useState('assistant');
  const [inviteError, setInviteError] = useState('');
  const [lastInvitePassword, setLastInvitePassword] = useState<string | null>(null);
  const [scannerMode, setScannerMode] = useState('camera');
  const [editingSubject, setEditingSubject] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [assistantPermissions, setAssistantPermissions] = useState<Record<string, Record<string, boolean>>>({});
  const [referralData, setReferralData] = useState<{ referralCode: string; rewards: { id: string; referred_center_name: string; referred_center_plan: string; reward_amount: number; reward_status: string; created_at: string }[]; totalEarned: number } | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);

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
    const fetchReferral = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !centerId) return;
      try {
        const res = await fetch('/api/referral', {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setReferralData(data);
        }
      } catch (err) {
        console.error('Referral fetch error:', err);
      }
    };
    if (centerId) fetchReferral();
  }, [centerId]);

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
        details: { name: subject.name },
      });
      setSubjects(prev => [...prev, { ...subject, monthly_fee: 0 }]);
      setNewSubjectName('');
      showSaved();
    }
  };

  const handleUpdateSubject = async (id: string) => {
    if (!centerId || !userId) return;
    const { error } = await dbUpdate({
      table: 'subjects',
      data: { name: editName.trim() },
      filters: [{ column: 'id', op: 'eq', value: id }],
    });

    if (!error) {
      await auditLog({
        centerId,
        userId,
        action: 'subject_update',
        entityType: 'subjects',
        entityId: id,
        details: { name: editName.trim() },
      });
      setSubjects(prev => prev.map(s => s.id === id ? { ...s, name: editName.trim() } : s));
      setEditingSubject(null);
      showSaved();
    }
  };

  const handleDeleteSubject = async (id: string) => {
    if (!confirm(t('deleteConfirm')) || !centerId || !userId) return;

    // Check if any students use this subject (by subject, not subject_id - students have subject string)
    const { data: studentsWithSubject } = await dbSelect({
      table: 'students',
      select: 'id',
      filters: [{ column: 'subject', op: 'eq', value: subjects.find(s => s.id === id)?.name ?? '' }],
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


    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setInviteError(t('error'));
      return;
    }

    let result: { success?: boolean; member?: TeamMember; tempPassword?: string; error?: string } = {};
    try {
      const res = await fetch('/api/invite-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          name: inviteName.trim() || '',
          phone,
          role: inviteRole,
        }),
      });
      result = await res.json();
      if (!res.ok) {
        setInviteError(result.error || res.statusText || 'Failed to add member');
        return;
      }
    } catch (fetchError) {
      setInviteError(t('error'));
      return;
    }

    if (result.success && result.member) {
      const member = result.member;
      setTeamMembers(prev => [...prev, member]);
      setInviteName('');
      setInvitePhone('');
      setInviteRole('assistant');
      setLastInvitePassword(result.tempPassword ?? null);
      showSaved();
    } else {
      setInviteError(result.error || 'Failed to add member');
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
      showSaved();
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
                        <button
                          onClick={() => { setEditingSubject(subject.id); setEditName(subject.name); }}
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

              {/* Add subject form - subjects are categories only, fee is set per group */}
              <form onSubmit={handleAddSubject} className="flex gap-2">
                <input
                  type="text"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  placeholder={t('subjectName')}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                  required
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

              {/* Team members list - grouped by role with section headers */}
              <div className="space-y-4 mb-6">
                {teamMembers.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-6 text-center">{t('noTeamMembers')}</p>
                ) : (
                  <>
                    {[
                      { role: 'admin', label: t('admins'), members: teamMembers.filter(m => m.role === 'admin' || m.role === 'owner') },
                      { role: 'assistant', label: t('assistants'), members: teamMembers.filter(m => m.role === 'assistant') },
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
                                  : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
                              const permKeys = PERMISSION_KEYS;
                              const isPermReadOnly = member.role === 'admin' || member.role === 'owner' || isSelf;
                              const permChecked =
                                member.role === 'admin' || member.role === 'owner'
                                  ? true
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
                              {member.role === 'owner' ? t('admin') : member.role === 'admin' ? t('admin') : t('assistant')}
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
                                  className={`flex items-center gap-1.5 text-xs select-none ${isPermReadOnly ? 'cursor-default opacity-75' : 'cursor-pointer hover:opacity-90'}`}
                                  style={!isPermReadOnly ? { pointerEvents: 'auto' } : undefined}
                                >
                                  <input
                                    type="checkbox"
                                    checked={typeof permChecked === 'function' ? permChecked(key) : permChecked}
                                    onChange={(e) => !isPermReadOnly && handlePermissionToggle(member.id, key, e.target.checked)}
                                    disabled={isPermReadOnly}
                                    className="w-4 h-4 rounded text-indigo-600 disabled:opacity-60 cursor-pointer"
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
                  </select>
                  <button
                    type="submit"
                    disabled={false}
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

            {/* Referral */}
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{tReferral('title')}</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4" dir="ltr">
                {tReferral('shareText')}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4" dir="rtl">
                {tReferral('shareTextAr')}
              </p>
              {referralData && (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <code className="text-2xl font-mono font-bold text-indigo-600 dark:text-indigo-400 tracking-widest bg-gray-100 dark:bg-gray-700 px-4 py-2 rounded-lg">
                      {referralData.referralCode || '—'}
                    </code>
                    <button
                      type="button"
                      onClick={async () => {
                        if (referralData.referralCode) {
                          await navigator.clipboard.writeText(referralData.referralCode);
                          setReferralCopied(true);
                          setTimeout(() => setReferralCopied(false), 2000);
                        }
                      }}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg"
                    >
                      {referralCopied ? tReferral('copied') : tReferral('copyCode')}
                    </button>
                  </div>
                  <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <span className="text-sm text-gray-600 dark:text-gray-400">{tReferral('totalEarned')}</span>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">
                      {Number(referralData.totalEarned || 0).toLocaleString('ar-EG')} EGP
                    </p>
                  </div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{tReferral('rewardsTable')}</h3>
                  {referralData.rewards.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">{tReferral('noRewards')}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-gray-600">
                            <th className="text-start py-2 font-medium text-gray-600 dark:text-gray-400">{tReferral('referredCenter')}</th>
                            <th className="text-start py-2 font-medium text-gray-600 dark:text-gray-400">{tReferral('plan')}</th>
                            <th className="text-start py-2 font-medium text-gray-600 dark:text-gray-400">{tReferral('rewardAmount')}</th>
                            <th className="text-start py-2 font-medium text-gray-600 dark:text-gray-400">{tReferral('status')}</th>
                            <th className="text-start py-2 font-medium text-gray-600 dark:text-gray-400">{tReferral('date')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {referralData.rewards.map((r) => (
                            <tr key={r.id || r.created_at + r.referred_center_name} className="border-b border-gray-100 dark:border-gray-700/50">
                              <td className="py-2 text-gray-900 dark:text-white">{r.referred_center_name}</td>
                              <td className="py-2 text-gray-600 dark:text-gray-400">{r.referred_center_plan}</td>
                              <td className="py-2 text-gray-900 dark:text-white">{Number(r.reward_amount).toLocaleString('ar-EG')} EGP</td>
                              <td className="py-2">
                                <span className={`px-2 py-0.5 text-xs rounded-full ${
                                  r.reward_status === 'paid' ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300' :
                                  r.reward_status === 'pending' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300' :
                                  'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                                }`}>
                                  {r.reward_status}
                                </span>
                              </td>
                              <td className="py-2 text-gray-600 dark:text-gray-400">
                                {new Date(r.created_at).toLocaleDateString('ar-EG')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
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

            {/* WhatsApp Integration Placeholder */}
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
              <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-700">
                <p className="text-amber-800 dark:text-amber-200 text-sm" dir="ltr">
                  For WhatsApp integration, contact our support team: support@centerhq.com
                </p>
                <p className="text-amber-700 dark:text-amber-300 text-sm mt-2" dir="rtl">
                  لتفعيل خدمة الواتساب، تواصل مع فريق الدعم: support@centerhq.com
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
