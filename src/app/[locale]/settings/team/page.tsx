'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import { dbSelect, dbDelete, auditLog } from '@/lib/db-proxy';
import Navbar from '@/components/Navbar';
import { Link } from '@/i18n/routing';

interface TeamMember {
  id: string;
  name: string | null;
  phone: string;
  role: string;
}

interface PendingInvite {
  id?: string;
  phone: string;
  role: string;
  status: string;
}

const PERMISSION_KEYS: { key: string; labelKey: string }[] = [
  { key: 'can_scan', labelKey: 'canScan' },
  { key: 'can_view_payments', labelKey: 'canViewPayments' },
  { key: 'can_record_payments', labelKey: 'canRecordPayments' },
  { key: 'can_view_dashboard', labelKey: 'canViewDashboard' },
  { key: 'can_view_revenue', labelKey: 'canViewRevenue' },
  { key: 'can_manage_students', labelKey: 'canManageStudents' },
  { key: 'can_manage_groups', labelKey: 'canManageGroups' },
  { key: 'can_allow_late_entry', labelKey: 'canAllowLateEntry' },
];

export default function TeamPage() {
  const t = useTranslations('settings');
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();
  const { user: currentUser } = useUser();
  const isRTL = locale === 'ar';

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savedMessage, setSavedMessage] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [lastInvitePassword, setLastInvitePassword] = useState<string | null>(null);

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRole, setInviteRole] = useState<'assistant' | 'teacher'>('assistant');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);

  const [assistantPermissions, setAssistantPermissions] = useState<Record<string, Record<string, boolean>>>({});
  const [editingPermissionsId, setEditingPermissionsId] = useState<string | null>(null);

  useEffect(() => {
    if (currentUser && (currentUser.role === 'assistant' || currentUser.role === 'teacher')) {
      router.replace('/dashboard');
    }
  }, [currentUser, router]);

  const loadData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setUserId(session.user.id);

    const meRes = await fetch('/api/me', {
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    });
    const meData = await meRes.json();
    if (!meData?.user?.center_id) return;
    setCenterId(meData.user.center_id);
    const cid = meData.user.center_id;

    const { data: membersData } = await dbSelect({
      table: 'users',
      select: 'id, name, phone, role',
      filters: [{ column: 'center_id', op: 'eq', value: cid }],
    });
    if (membersData) {
      setTeamMembers((membersData as TeamMember[]).map(m => ({
        id: m.id,
        name: m.name ?? null,
        phone: m.phone,
        role: m.role,
      })));
    }

    const { data: permData } = await dbSelect({
      table: 'permissions',
      select: 'user_id, permission_key, enabled',
      filters: [{ column: 'center_id', op: 'eq', value: cid }],
    });
    const permMap: Record<string, Record<string, boolean>> = {};
    (permData || []).forEach((p: { user_id: string; permission_key: string; enabled: boolean }) => {
      if (!permMap[p.user_id]) permMap[p.user_id] = {};
      permMap[p.user_id][p.permission_key] = p.enabled;
    });
    setAssistantPermissions(permMap);

    const { data: invitesData } = await dbSelect({
      table: 'center_invites',
      select: 'phone, role, status',
      filters: [
        { column: 'center_id', op: 'eq', value: cid },
        { column: 'status', op: 'eq', value: 'pending' },
      ],
    });
    if (invitesData) {
      setPendingInvites((invitesData as PendingInvite[]).map(inv => ({
        phone: inv.phone,
        role: inv.role,
        status: inv.status,
      })));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const showSaved = () => {
    setSavedMessage(t('saved'));
    setTimeout(() => setSavedMessage(''), 2000);
  };

  const handleInvite = async (e: React.FormEvent) => {
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

    setInviteSubmitting(true);
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
      const result = await res.json();

      if (!res.ok) {
        setInviteError(result.error || res.statusText || 'Failed to add member');
        return;
      }

      if (result.success && result.member) {
        setTeamMembers(prev => [...prev, result.member]);
        setInviteName('');
        setInvitePhone('');
        setInviteRole('assistant');
        setLastInvitePassword(result.tempPassword ?? null);
        setShowInviteModal(false);
        showSaved();
      } else if (result.success && result.pendingInvite) {
        setInviteName('');
        setInvitePhone('');
        setInviteRole('assistant');
        setPendingInvites(prev => [...prev, { phone, role: inviteRole, status: 'pending' }]);
        setShowInviteModal(false);
        setSavedMessage(result.message || t('inviteSuccess'));
        setTimeout(() => setSavedMessage(''), 5000);
      } else {
        setInviteError(result.error || 'Failed to add member');
      }
    } catch {
      setInviteError(t('error'));
    } finally {
      setInviteSubmitting(false);
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

  const handlePermissionToggle = async (targetId: string, key: string, enabled: boolean) => {
    if (!centerId) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const res = await fetch('/api/permissions', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ targetUserId: targetId, permissionKey: key, enabled, centerId }),
    });

    if (res.ok) {
      setAssistantPermissions(prev => ({
        ...prev,
        [targetId]: {
          ...prev[targetId],
          [key]: enabled,
        },
      }));
      showSaved();
    }
  };

  const getRoleBadgeClass = (role: string) => {
    if (role === 'owner') return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300';
    if (role === 'admin') return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
    if (role === 'teacher') return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300';
    return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
  };

  const getRoleLabel = (role: string) => {
    if (role === 'owner') return tNav('roleOwner');
    if (role === 'admin') return t('admin');
    if (role === 'teacher') return tNav('roleTeacher');
    return t('assistant');
  };

  const isOwner = (member: TeamMember) => member.role === 'owner' || member.role === 'admin';
  const canEditPermissions = (member: TeamMember) => !isOwner(member) && member.id !== userId;

  if (isLoading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
          <div className="animate-spin h-8 w-8 border-2 border-indigo-600 border-t-transparent rounded-full" />
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-6">
            <Link
              href="/settings"
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              ← {t('backToSettings')}
            </Link>
          </div>

          {/* Sub-navigation */}
          <div className="flex flex-wrap gap-2 mb-6">
            <Link
              href="/settings"
              className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium transition-colors"
            >
              {t('general')}
            </Link>
            <Link
              href="/settings/billing"
              className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium transition-colors"
            >
              {t('billing')}
            </Link>
            <span className="px-3 py-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-200 text-sm font-medium">
              {t('teamMembers')}
            </span>
          </div>

          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {t('teamMembers')}
            </h1>
            <button
              onClick={() => setShowInviteModal(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg"
            >
              {t('inviteMember', { defaultValue: 'Invite Member' })}
            </button>
          </div>

          {savedMessage && (
            <div className="mb-4 p-3 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg text-sm text-center">
              {savedMessage}
            </div>
          )}

          {lastInvitePassword && (
            <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-sm text-green-700 dark:text-green-400">
              <p className="font-medium">{t('inviteSuccess')}</p>
              <p className="mt-1">{t('passwordIs', { password: lastInvitePassword })}</p>
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('inviteName')}</th>
                    <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('invitePhone')}</th>
                    <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('role')}</th>
                    <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('status', { defaultValue: 'Status' })}</th>
                    <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{t('permissions', { defaultValue: 'Permissions' })}</th>
                    <th className="px-4 py-3 text-start font-medium text-gray-600 dark:text-gray-400">{tCommon('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {teamMembers.map((member) => {
                    const isSelf = member.id === userId;
                    const isPermReadOnly = isOwner(member) || isSelf;
                    const permChecked = (k: string) => isOwner(member) ? true : (assistantPermissions[member.id]?.[k] ?? false);

                    return (
                      <tr key={member.id} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                          {member.name || '—'}
                          {isSelf && <span className="text-xs text-gray-500 ml-1">({t('you')})</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400" dir="ltr">{member.phone}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${getRoleBadgeClass(member.role)}`}>
                            {getRoleLabel(member.role)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                            {t('activeStatus', { defaultValue: 'Active' })}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {editingPermissionsId === member.id ? (
                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-x-4 gap-y-1">
                                {PERMISSION_KEYS.map(({ key, labelKey }) => (
                                  <label
                                    key={key}
                                    className={`flex items-center gap-1.5 text-xs select-none ${isPermReadOnly ? 'cursor-default opacity-75' : 'cursor-pointer'}`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={permChecked(key)}
                                      onChange={(e) => !isPermReadOnly && handlePermissionToggle(member.id, key, e.target.checked)}
                                      disabled={isPermReadOnly}
                                      className="w-4 h-4 rounded text-indigo-600"
                                    />
                                    {t(labelKey)}
                                  </label>
                                ))}
                              </div>
                              <button
                                type="button"
                                onClick={() => setEditingPermissionsId(null)}
                                className="text-xs text-indigo-600 hover:underline"
                              >
                                {tCommon('cancel')}
                              </button>
                            </div>
                          ) : canEditPermissions(member) ? (
                            <button
                              type="button"
                              onClick={() => setEditingPermissionsId(member.id)}
                              className="text-indigo-600 dark:text-indigo-400 hover:underline text-xs"
                            >
                              {t('editPermissions', { defaultValue: 'Edit Permissions' })}
                            </button>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {!isSelf && (
                            <button
                              onClick={() => handleRemoveMember(member)}
                              className="text-red-600 dark:text-red-400 hover:underline text-xs"
                              title={t('removeMember', { defaultValue: 'Remove Member' })}
                            >
                              {t('removeMember', { defaultValue: 'Remove Member' })}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {pendingInvites.map((inv, idx) => (
                    <tr key={`pending-${idx}`} className="border-b border-gray-100 dark:border-gray-700/50">
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">—</td>
                      <td className="px-4 py-3 font-mono text-gray-600 dark:text-gray-400" dir="ltr">{inv.phone}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${getRoleBadgeClass(inv.role)}`}>
                          {getRoleLabel(inv.role)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300">
                          {t('pendingInvite', { defaultValue: 'Pending invite' })}
                        </span>
                      </td>
                      <td className="px-4 py-3">—</td>
                      <td className="px-4 py-3">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {teamMembers.length === 0 && pendingInvites.length === 0 && (
                <p className="p-8 text-center text-gray-500 dark:text-gray-400">{t('noTeamMembers')}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowInviteModal(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{t('inviteMember', { defaultValue: 'Invite Member' })}</h3>
            {inviteError && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{inviteError}</p>}
            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('inviteName')}</label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder={t('inviteName')}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('invitePhone')}</label>
                <input
                  type="tel"
                  value={invitePhone}
                  onChange={(e) => { setInvitePhone(e.target.value); setInviteError(''); }}
                  placeholder="01XXXXXXXXX"
                  dir="ltr"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('role')}</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'assistant' | 'teacher')}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                >
                  <option value="assistant">{t('assistant')}</option>
                  <option value="teacher">{t('roleTeacher', { defaultValue: 'Teacher' })}</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={inviteSubmitting || !invitePhone.trim()}
                  className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
                >
                  {inviteSubmitting ? tCommon('loading') : t('invite')}
                </button>
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded-lg text-sm"
                >
                  {tCommon('cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
