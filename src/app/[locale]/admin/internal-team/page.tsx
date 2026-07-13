'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';
import { getAdminSession, getAdminAuthHeaders } from '@/lib/adminAuth-client';
import { ALL_ADMIN_PERMISSIONS } from '@/lib/admin-roles';
import { RoleBadge } from '@/components/shared';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { formatDate } from '@/lib/formatNumber';
import { normalizePhone } from '@/lib/utils/phone';

interface TeamMember {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  role: string;
  custom_permissions?: string[];
  created_at?: string;
}

interface StaffRequest {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  role: string;
  custom_permissions?: string[];
  created_at?: string;
}

type RoleKey =
  | 'internal_viewer'
  | 'internal_admin'
  | 'sales_manager'
  | 'sales_rep'
  | 'support_agent'
  | 'accountant'
  | 'custom';

const ROLE_OPTIONS: RoleKey[] = [
  'internal_viewer',
  'internal_admin',
  'sales_manager',
  'sales_rep',
  'support_agent',
  'accountant',
  'custom',
];

const ROLE_LABEL_KEY: Record<RoleKey, string> = {
  internal_viewer: 'internalTeamRoleViewer',
  internal_admin: 'internalTeamRoleInternalAdmin',
  sales_manager: 'internalTeamRoleSalesManager',
  sales_rep: 'internalTeamRoleSalesRep',
  support_agent: 'internalTeamRoleSupportAgent',
  accountant: 'internalTeamRoleAccountant',
  custom: 'internalTeamRoleCustom',
};

export default function AdminInternalTeamPage() {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();

  const [team, setTeam] = useState<TeamMember[]>([]);
  const [pending, setPending] = useState<StaffRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Generate-invite modal (replaces the old direct add-member form).
  const [showInvite, setShowInvite] = useState(false);
  const [inviteRole, setInviteRole] = useState<RoleKey>('internal_viewer');
  const [inviteCustomPerms, setInviteCustomPerms] = useState<string[]>([]);
  // The freshly minted invite URL, surfaced in a copyable modal.
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);

  const [editRoleMember, setEditRoleMember] = useState<TeamMember | null>(null);
  const [editRoleSelection, setEditRoleSelection] = useState<RoleKey>('internal_viewer');
  const [editRolePassword, setEditRolePassword] = useState('');
  const [deactivateMember, setDeactivateMember] = useState<TeamMember | null>(null);
  const [declineRequest, setDeclineRequest] = useState<StaffRequest | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  // Set-PIN link surfaced after APPROVING and provisioning a brand-new employee login.
  const [pinSetupLink, setPinSetupLink] = useState<string | null>(null);
  const [pinLinkCopied, setPinLinkCopied] = useState(false);

  const loadData = useCallback(async () => {
    const session = await getAdminSession();
    if (!session) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const authHeader = { Authorization: `Bearer ${session.access_token}` };
      const [teamRes, pendingRes] = await Promise.all([
        fetch('/api/admin/team', { headers: authHeader }),
        fetch('/api/admin/staff-requests', { headers: authHeader }),
      ]);
      if (teamRes.status === 403) {
        router.replace('/dashboard');
        return;
      }
      if (!teamRes.ok) {
        const err = await teamRes.json().catch(() => ({}));
        setError(err?.error || tCommon('errorGeneric'));
        return;
      }
      const data = await teamRes.json();
      setTeam(Array.isArray(data?.team) ? (data.team as TeamMember[]) : []);
      // Pending queue is super_admin-only; a 403 just means an empty queue for this viewer.
      if (pendingRes.ok) {
        const pd = await pendingRes.json().catch(() => ({}));
        setPending(Array.isArray(pd?.requests) ? (pd.requests as StaffRequest[]) : []);
      } else {
        setPending([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : tCommon('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }, [router, tCommon]);

  useEffect(() => {
    setHideShell(true);
    return () => setHideShell(false);
  }, [setHideShell]);

  useEffect(() => {
    closeMainSidebar?.();
  }, [closeMainSidebar]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleGenerateInvite = async () => {
    const headers = await getAdminAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/staff-invites', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          role: inviteRole,
          custom_permissions: inviteRole === 'custom' ? inviteCustomPerms : [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || tCommon('errorGeneric'));
      setShowInvite(false);
      setInviteRole('internal_viewer');
      setInviteCustomPerms([]);
      if (typeof data?.inviteUrl === 'string' && data.inviteUrl) {
        setInviteCopied(false);
        setInviteUrl(data.inviteUrl as string);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : tCommon('errorGeneric'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async (req: StaffRequest) => {
    const headers = await getAdminAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/staff-requests/${req.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ action: 'approve' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || tCommon('errorGeneric'));
      // A freshly provisioned employee returns a one-time set-PIN link to share.
      if (typeof data?.setupUrl === 'string' && data.setupUrl) {
        setPinLinkCopied(false);
        setPinSetupLink(data.setupUrl as string);
      }
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : tCommon('errorGeneric'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeclineConfirm = async () => {
    if (!declineRequest) return;
    const headers = await getAdminAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/staff-requests/${declineRequest.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ action: 'decline', decline_reason: declineReason.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || tCommon('errorGeneric'));
      setDeclineRequest(null);
      setDeclineReason('');
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : tCommon('errorGeneric'));
    } finally {
      setActionLoading(false);
    }
  };

  const openEditRole = (member: TeamMember) => {
    setEditRoleMember(member);
    const roleAsKey = (ROLE_OPTIONS as readonly string[]).includes(member.role)
      ? (member.role as RoleKey)
      : 'internal_viewer';
    setEditRoleSelection(roleAsKey);
    setEditRolePassword('');
  };

  const handleEditRoleSave = async () => {
    if (!editRoleMember) return;
    const headers = await getAdminAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/team', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          memberId: editRoleMember.id,
          role: editRoleSelection,
          password: editRolePassword,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || tCommon('errorGeneric'));
      }
      setEditRoleMember(null);
      setEditRolePassword('');
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : tCommon('errorGeneric'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeactivateConfirm = async () => {
    if (!deactivateMember) return;
    const headers = await getAdminAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/team', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ memberId: deactivateMember.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || tCommon('errorGeneric'));
      }
      setDeactivateMember(null);
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : tCommon('errorGeneric'));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 min-h-screen w-full bg-[var(--color-surface-0)]">
      <AdminHeader />
      <div className="flex flex-1">
        <AdminSidebar activeRoute="/admin/internal-team" />
        <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 overflow-auto lg:ms-56">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => router.push('/admin')}
                className="p-1.5 rounded-lg hover:bg-muted"
                aria-label={tCommon('back')}
              >
                <DirectionalIcon icon={ArrowLeft} className="h-5 w-5" />
              </button>
              <h1 className="text-xl font-bold">{t('internalTeam.title')}</h1>
            </div>
            <button
              type="button"
              onClick={() => setShowInvite(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700"
            >
              {t('internalTeam.generateInvite')}
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-100 text-red-700 text-sm flex items-center justify-between gap-3">
              <span>{error}</span>
              <button
                type="button"
                onClick={loadData}
                className="px-3 py-1 rounded bg-red-600 text-white text-xs font-medium"
              >
                {t('retry')}
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="animate-spin text-[var(--color-text-secondary)]" size={24} />
            </div>
          ) : (
            <>
              {/* Pending intake queue (super_admin only; hidden when empty). */}
              {pending.length > 0 && (
                <div className="mb-6">
                  <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                    {t('internalTeam.pendingTitle')}
                  </h2>
                  <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                          <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)] min-w-[160px]">{tCommon('name')}</th>
                          <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)]">{tCommon('phone')}</th>
                          <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)]">{t('internalTeamRoleLabel')}</th>
                          <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)]">{t('internalTeam.pendingSubmittedLabel')}</th>
                          <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)] min-w-[160px]">{tCommon('actions')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-border-subtle)]">
                        {pending.map((r) => (
                          <tr key={r.id} className="hover:bg-[var(--color-surface-0)] transition-colors">
                            <td className="py-3.5 px-4 text-sm text-[var(--color-text-primary)] font-medium">{r.name}</td>
                            <td className="py-3.5 px-4 font-mono text-xs text-[var(--color-text-secondary)]" dir="ltr">
                              {r.phone ? normalizePhone(r.phone) : (r.email ?? tCommon('notSet'))}
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <RoleBadge role={r.role} />
                            </td>
                            <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)]">
                              {r.created_at ? formatDate(r.created_at, locale) : tCommon('notSet')}
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-2 flex-nowrap">
                                <button
                                  type="button"
                                  onClick={() => handleApprove(r)}
                                  disabled={actionLoading}
                                  className="px-2.5 py-1 rounded text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50"
                                >
                                  {t('internalTeam.approve')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setDeclineRequest(r); setDeclineReason(''); }}
                                  disabled={actionLoading}
                                  className="px-2.5 py-1 rounded text-xs font-semibold border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
                                >
                                  {t('internalTeam.decline')}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                      <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)] min-w-[180px]">{tCommon('name')}</th>
                      <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)]">{tCommon('phone')}</th>
                      <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)]">{t('internalTeamRoleLabel')}</th>
                      <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)]">{t('joinedDate')}</th>
                      <th className="text-start py-3 px-4 text-xs font-medium text-[var(--color-text-muted)] min-w-[120px]">{tCommon('actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {team.filter((m) => m && typeof m.id === 'string' && m.id.length > 0).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 px-4 text-center text-[var(--color-text-secondary)] text-sm">
                          {t('internalTeamEmptyState')}
                        </td>
                      </tr>
                    ) : null}
                    {team
                      .filter((m) => m && typeof m.id === 'string' && m.id.length > 0)
                      .map((m) => (
                        <tr key={m.id} className="hover:bg-[var(--color-surface-0)] transition-colors">
                          <td className="py-3.5 px-4 text-sm text-[var(--color-text-primary)] font-medium min-w-[180px] max-w-[240px] truncate" title={m.name}>{m.name}</td>
                          <td className="py-3.5 px-4 font-mono text-xs text-[var(--color-text-secondary)]" dir="ltr">
                            {m.phone ? normalizePhone(m.phone) : (m.email ?? tCommon('notSet'))}
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <RoleBadge role={m.role} />
                          </td>
                          <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)]">
                            {m.created_at ? formatDate(m.created_at, locale) : tCommon('notSet')}
                          </td>
                          <td className="py-3.5 px-4">
                            {!['super_admin', 'admin'].includes(m.role) ? (
                              <div className="flex items-center gap-2 flex-nowrap">
                                <button
                                  type="button"
                                  onClick={() => openEditRole(m)}
                                  disabled={actionLoading}
                                  className="px-2 py-1 rounded text-xs font-semibold border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-0)] disabled:opacity-50"
                                >
                                  {t('internalTeam.editRole')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeactivateMember(m)}
                                  disabled={actionLoading}
                                  className="px-2 py-1 rounded text-xs font-semibold border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
                                >
                                  {t('internalTeam.deactivate')}
                                </button>
                              </div>
                            ) : (
                              <span className="text-[var(--color-text-muted)]">{tCommon('notAvailable')}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </main>
      </div>

      {editRoleMember && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setEditRoleMember(null)}
        >
          <div
            className="rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6 max-w-sm mx-4 w-full bg-[var(--color-surface-1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-[var(--color-text-primary)] mb-4">
              {t('internalTeam.editRoleTitle')}
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-3">{editRoleMember.name}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                  {t('internalTeamRoleLabel')}
                </label>
                <select
                  value={editRoleSelection}
                  onChange={(e) => setEditRoleSelection(e.target.value as RoleKey)}
                  className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-[var(--color-surface-2)] text-[var(--color-text-primary)]"
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {t(ROLE_LABEL_KEY[role])}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="password"
                value={editRolePassword}
                onChange={(e) => setEditRolePassword(e.target.value)}
                placeholder={tCommon('passwordPlaceholder')}
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm"
              />
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button
                type="button"
                onClick={() => setEditRoleMember(null)}
                className="px-4 py-2 rounded-lg text-sm border border-border"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                onClick={handleEditRoleSave}
                disabled={actionLoading || !editRolePassword}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50"
              >
                {t('internalTeam.editRoleSave')}
              </button>
            </div>
          </div>
        </div>
      )}

      {deactivateMember && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setDeactivateMember(null)}
        >
          <div
            className="rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6 max-w-sm mx-4 w-full bg-[var(--color-surface-1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-[var(--color-text-primary)] mb-3">
              {t('internalTeam.deactivateConfirmTitle')}
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">
              {t('internalTeam.deactivateConfirmMessage')}
            </p>
            <p className="text-sm font-medium text-[var(--color-text-primary)] mb-4">
              {deactivateMember.name}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setDeactivateMember(null)}
                className="px-4 py-2 rounded-lg text-sm border border-border"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                onClick={handleDeactivateConfirm}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {t('internalTeam.deactivateConfirmCta')}
              </button>
            </div>
          </div>
        </div>
      )}

      {declineRequest && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setDeclineRequest(null)}
        >
          <div
            className="rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6 max-w-sm mx-4 w-full bg-[var(--color-surface-1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-[var(--color-text-primary)] mb-3">
              {t('internalTeam.declineTitle')}
            </h3>
            <p className="text-sm font-medium text-[var(--color-text-primary)] mb-3">
              {declineRequest.name}
            </p>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
              {t('internalTeam.declineReasonLabel')}
            </label>
            <textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder={t('internalTeam.declineReasonPlaceholder')}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm"
            />
            <div className="flex gap-2 justify-end mt-4">
              <button
                type="button"
                onClick={() => setDeclineRequest(null)}
                className="px-4 py-2 rounded-lg text-sm border border-border"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                onClick={handleDeclineConfirm}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {t('internalTeam.declineConfirmCta')}
              </button>
            </div>
          </div>
        </div>
      )}

      {inviteUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setInviteUrl(null)}
        >
          <div
            className="rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6 max-w-md mx-4 w-full bg-[var(--color-surface-1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-[var(--color-text-primary)] mb-2">
              {t('internalTeam.inviteLinkTitle')}
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-3">
              {t('internalTeam.inviteLinkHelper')}
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] p-2 mb-4">
              <input
                type="text"
                readOnly
                value={inviteUrl}
                dir="ltr"
                className="chq-focus min-w-0 flex-1 bg-transparent text-xs text-[var(--color-text-primary)]"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(inviteUrl);
                    setInviteCopied(true);
                  } catch {
                    setInviteCopied(false);
                  }
                }}
                className="shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700"
              >
                {inviteCopied ? t('internalTeam.inviteLinkCopied') : t('internalTeam.inviteLinkCopy')}
              </button>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setInviteUrl(null)}
                className="px-4 py-2 rounded-lg text-sm font-semibold border border-border"
              >
                {t('internalTeam.inviteLinkDone')}
              </button>
            </div>
          </div>
        </div>
      )}

      {pinSetupLink && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setPinSetupLink(null)}
        >
          <div
            className="rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6 max-w-md mx-4 w-full bg-[var(--color-surface-1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-[var(--color-text-primary)] mb-2">
              {t('internalTeam.pinLinkTitle')}
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-3">
              {t('internalTeam.pinLinkHelper')}
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] p-2 mb-4">
              <input
                type="text"
                readOnly
                value={pinSetupLink}
                dir="ltr"
                className="chq-focus min-w-0 flex-1 bg-transparent text-xs text-[var(--color-text-primary)]"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(pinSetupLink);
                    setPinLinkCopied(true);
                  } catch {
                    setPinLinkCopied(false);
                  }
                }}
                className="shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700"
              >
                {pinLinkCopied ? t('internalTeam.pinLinkCopied') : t('internalTeam.pinLinkCopy')}
              </button>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setPinSetupLink(null)}
                className="px-4 py-2 rounded-lg text-sm font-semibold border border-border"
              >
                {t('internalTeam.pinLinkDone')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showInvite && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowInvite(false)}
        >
          <div
            className="rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6 max-w-sm mx-4 w-full max-h-[90vh] overflow-y-auto bg-[var(--color-surface-1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-[var(--color-text-primary)] mb-1">{t('internalTeam.inviteModalTitle')}</h3>
            <p className="text-xs text-[var(--color-text-secondary)] mb-3">{t('internalTeam.inviteModalHelper')}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                  {t('internalTeamRoleLabel')}
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => {
                    setInviteRole(e.target.value as RoleKey);
                    setInviteCustomPerms([]);
                  }}
                  className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {t(ROLE_LABEL_KEY[role])}
                    </option>
                  ))}
                </select>
              </div>
              {inviteRole === 'custom' && (
                <div className="border border-[var(--color-border-subtle)] rounded-lg p-3 space-y-2">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {t('internalTeamPermissionsHeading')}
                  </p>
                  {ALL_ADMIN_PERMISSIONS.map((p) => (
                    <label key={p.key} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={inviteCustomPerms.includes(p.key)}
                        onChange={(e) =>
                          setInviteCustomPerms((prev) =>
                            e.target.checked ? [...prev, p.key] : prev.filter((k) => k !== p.key),
                          )
                        }
                        className="rounded border-[var(--color-border-default)] text-teal-600"
                      />
                      <span>{locale === 'ar' ? p.labelAr : p.labelEn}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button
                type="button"
                onClick={() => setShowInvite(false)}
                className="px-4 py-2 rounded-lg text-sm border border-border"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                onClick={handleGenerateInvite}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50"
              >
                {actionLoading ? t('internalTeam.inviteCreating') : t('internalTeam.inviteCreateCta')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
