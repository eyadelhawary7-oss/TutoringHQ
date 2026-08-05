'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';
import { getAdminSession, getAdminAuthHeaders } from '@/lib/adminAuth-client';
import { ALL_ADMIN_PERMISSIONS, getPermissionsForRole } from '@/lib/admin-roles';
import { RoleBadge, EmptyState } from '@/components/shared';
import { ListRow } from '@/components/patterns';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { ArrowLeft, RefreshCw, Users } from 'lucide-react';
import { formatDate, formatNumber, formatRelativeMinutesAgo } from '@/lib/formatNumber';
import { initialsOf } from '@/lib/initials';
import { normalizePhone } from '@/lib/utils/phone';

interface TeamMember {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  role: string;
  custom_permissions?: string[];
  created_at?: string;
  /**
   * `auth.users.last_sign_in_at`. Named for what it is: the design's §02 caption
   * says "Last active", but no activity column exists on `admin_users` and a
   * sign-in is not activity — see the note on `fetchLastSignInAt` in
   * `/api/admin/team`.
   */
  last_sign_in_at?: string | null;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const [selectedRole, setSelectedRole] = useState<RoleKey>('internal_viewer');
  const [customPerms, setCustomPerms] = useState<string[]>([]);

  // Merged-Admin-Accounts §02 member detail — the permission sheet the design
  // draws behind a team row.
  const [detailMember, setDetailMember] = useState<TeamMember | null>(null);
  const [detailPerms, setDetailPerms] = useState<string[]>([]);
  const [detailPassword, setDetailPassword] = useState('');
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailSaved, setDetailSaved] = useState(false);

  const [detailRole, setDetailRole] = useState<RoleKey>('internal_viewer');
  const [deactivateMember, setDeactivateMember] = useState<TeamMember | null>(null);
  // Set-PIN link surfaced after provisioning a brand-new employee login.
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
      const res = await fetch('/api/admin/team', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 403) {
        router.replace('/dashboard');
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err?.error || tCommon('errorGeneric'));
        return;
      }
      const data = await res.json();
      setTeam(Array.isArray(data?.team) ? (data.team as TeamMember[]) : []);
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

  const handleAdd = async () => {
    const headers = await getAdminAuthHeaders();
    if (!headers || !form.name.trim() || !form.phone.trim()) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/team', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.replace(/\D/g, ''),
          email: form.email.trim() || undefined,
          role: selectedRole,
          custom_permissions: selectedRole === 'custom' ? customPerms : [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || tCommon('errorGeneric'));
      setShowAdd(false);
      setForm({ name: '', phone: '', email: '' });
      setSelectedRole('internal_viewer');
      setCustomPerms([]);
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

  const visibleTeam = team.filter((m) => m && typeof m.id === 'string' && m.id.length > 0);

  /**
   * The design's sub-line: the owner shows an email, everyone else shows what
   * their role can reach. "Last active 2 hours ago" is NOT here —
   * `admin_users` has no last-active column (id, name, email, role,
   * created_at, phone, custom_permissions; confirmed 29 July), so the join
   * date takes that slot rather than a number nobody could verify.
   */
  const memberSubline = (m: TeamMember): string => {
    if (m.role === 'super_admin' || m.role === 'admin') {
      return m.email || (m.phone ? normalizePhone(m.phone) : tCommon('notSet'));
    }
    const perms = getPermissionsForRole(m.role, m.custom_permissions ?? []);
    return t('internalTeam.permissionSummary', { count: formatNumber(perms.length, locale) });
  };

  const openMember = (m: TeamMember) => {
    setDetailMember(m);
    setDetailRole((ROLE_OPTIONS as readonly string[]).includes(m.role) ? (m.role as RoleKey) : 'internal_viewer');
    setDetailPerms(getPermissionsForRole(m.role, m.custom_permissions ?? []));
    setDetailPassword('');
    setDetailError(null);
    setDetailSaved(false);
  };

  /**
   * Ticking a box that the chosen named role does not grant is a bespoke set,
   * and the endpoint only stores a bespoke set under the `custom` role. So the
   * role that gets written is `custom` exactly when the toggles have drifted
   * from what the selected role confers.
   */
  const roleToWrite = (): RoleKey => {
    const fromRole = getPermissionsForRole(detailRole, detailPerms);
    const same =
      fromRole.length === detailPerms.length && fromRole.every((k) => detailPerms.includes(k));
    return same ? detailRole : 'custom';
  };

  /**
   * Permission toggles persist through the existing team PUT, which only
   * writes `custom_permissions` when the role is `custom`. So saving a bespoke
   * permission set moves the member to the custom role — that is the honest
   * behaviour of the endpoint, not a shortcut around it. Role changes stay
   * password-confirmed and super_admin stays unassignable, both enforced
   * server-side.
   */
  const handleSavePermissions = async () => {
    if (!detailMember) return;
    const headers = await getAdminAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    setDetailError(null);
    setDetailSaved(false);
    try {
      const res = await fetch('/api/admin/team', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          memberId: detailMember.id,
          role: roleToWrite(),
          custom_permissions: detailPerms,
          password: detailPassword,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || tCommon('errorGeneric'));
      }
      setDetailSaved(true);
      setDetailPassword('');
      await loadData();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : tCommon('errorGeneric'));
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

  // Merged-Admin-Accounts §02, second frame: the member sheet.
  if (detailMember) {
    const locked = detailMember.role === 'super_admin' || detailMember.role === 'admin';
    return (
      <div className="flex flex-col flex-1 min-h-0 min-h-screen w-full bg-[var(--color-surface-0)]">
        <AdminHeader />
        <div className="flex flex-1">
          <AdminSidebar activeRoute="/admin/internal-team" />
          <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 overflow-auto lg:ms-56 max-w-2xl">
            <div className="mb-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDetailMember(null)}
                className="rounded-lg p-1.5 hover:bg-tile chq-focus"
                aria-label={tCommon('back')}
              >
                <DirectionalIcon icon={ArrowLeft} className="h-5 w-5" />
              </button>
              <h1 className="text-xl font-bold">{t('internalTeam.memberTitle')}</h1>
            </div>

            <div className="mb-5 flex items-center gap-3">
              <span
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--color-mint)] text-base font-semibold text-[var(--color-accent-deep)]"
                aria-hidden
              >
                {initialsOf(detailMember.name)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-[var(--color-text-primary)]">
                  {detailMember.name}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <RoleBadge role={detailMember.role} />
                  {detailMember.created_at && (
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {t('internalTeam.joinedOn', { date: formatDate(detailMember.created_at, locale) })}
                    </span>
                  )}
                  {/* §02's recency line. Absent for a member who has never
                      signed in — no line beats "never", which reads as a
                      finding when it is really just an empty column. */}
                  {detailMember.last_sign_in_at && (
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {t('internalTeam.lastSignedIn', {
                        ago: formatRelativeMinutesAgo(detailMember.last_sign_in_at, locale),
                      })}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {!locked && (
              <div className="mb-5">
                <label
                  htmlFor="member-role"
                  className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
                >
                  {t('internalTeamRoleLabel')}
                </label>
                <select
                  id="member-role"
                  value={detailRole}
                  onChange={(e) => {
                    const next = e.target.value as RoleKey;
                    setDetailRole(next);
                    if (next !== 'custom') setDetailPerms(getPermissionsForRole(next, detailPerms));
                  }}
                  className="chq-focus w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {t(ROLE_LABEL_KEY[role])}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              {t('internalTeamPermissionsHeading')}
            </h2>
            <div className="overflow-hidden rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]">
              {ALL_ADMIN_PERMISSIONS.map((p, i) => (
                <label
                  key={p.key}
                  className={`flex min-h-[44px] cursor-pointer items-center justify-between gap-3 px-4 py-3 ${
                    i > 0 ? 'border-t border-[var(--color-border-subtle)]' : ''
                  } ${locked ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  <span className="text-sm text-[var(--color-text-primary)]">
                    {locale === 'ar' ? p.labelAr : p.labelEn}
                  </span>
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={detailPerms.includes(p.key)}
                    onChange={(e) =>
                      setDetailPerms((prev) =>
                        e.target.checked ? [...prev, p.key] : prev.filter((k) => k !== p.key),
                      )
                    }
                    className="chq-focus h-5 w-5 rounded border-[var(--color-border-default)] text-teal-600"
                  />
                </label>
              ))}
            </div>

            {locked ? (
              <p className="mt-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
                {t('internalTeam.lockedRoleNote')}
              </p>
            ) : (
              <>
                <p className="mt-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
                  {t('internalTeam.customRoleNote')}
                </p>
                <input
                  type="password"
                  value={detailPassword}
                  onChange={(e) => setDetailPassword(e.target.value)}
                  placeholder={tCommon('passwordPlaceholder')}
                  className="mt-3 w-full rounded-lg border border-border bg-[var(--color-surface-2)] px-3 py-2.5 text-sm text-[var(--color-text-primary)]"
                />
                {detailError && (
                  <p className="mt-2 text-sm text-red-600" role="alert">
                    {detailError}
                  </p>
                )}
                {detailSaved && (
                  <p className="mt-2 text-sm text-emerald-700" role="status">
                    {t('internalTeam.permissionsSaved')}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleSavePermissions}
                  disabled={actionLoading || !detailPassword}
                  className="btn-press chq-focus mt-3 min-h-[44px] w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  {actionLoading ? tCommon('saving') : t('internalTeam.savePermissions')}
                </button>
                <button
                  type="button"
                  onClick={() => setDeactivateMember(detailMember)}
                  disabled={actionLoading}
                  className="btn-press chq-focus mt-2 min-h-[44px] w-full rounded-lg border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {t('internalTeam.removeAccess')}
                </button>
              </>
            )}
          </main>
        </div>

        {deactivateMember && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={() => setDeactivateMember(null)}
          >
            <div
              className="mx-4 w-full max-w-sm rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6 shadow-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="mb-3 font-bold text-[var(--color-text-primary)]">
                {t('internalTeam.deactivateConfirmTitle')}
              </h3>
              <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
                {t('internalTeam.deactivateConfirmMessage')}
              </p>
              <p className="mb-4 text-sm font-medium text-[var(--color-text-primary)]">
                {deactivateMember.name}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeactivateMember(null)}
                  className="rounded-lg border border-border px-4 py-2 text-sm"
                >
                  {tCommon('cancel')}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await handleDeactivateConfirm();
                    setDetailMember(null);
                  }}
                  disabled={actionLoading}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {t('internalTeam.deactivateConfirmCta')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

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
                className="p-1.5 rounded-lg hover:bg-tile"
                aria-label={tCommon('back')}
              >
                <DirectionalIcon icon={ArrowLeft} className="h-5 w-5" />
              </button>
              <h1 className="text-xl font-bold">{t('internalTeam.title')}</h1>
            </div>
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700"
            >
              {t('addAdmin')}
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
              {/* Merged-Admin-Accounts §02 — the team list the design draws. */}
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                {t('internalTeam.memberCount', { count: formatNumber(visibleTeam.length, locale) })}
              </p>
              {visibleTeam.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title={t('internalTeamEmptyState')}
                  description={t('internalTeam.emptyBody')}
                  alt={t('internalTeam.emptyAlt')}
                />
              ) : (
                <div className="space-y-2">
                  {visibleTeam.map((m) => (
                    <ListRow
                      key={m.id}
                      avatar={initialsOf(m.name)}
                      title={m.name}
                      meta={memberSubline(m)}
                      badge={<RoleBadge role={m.role} />}
                      onOpen={() => openMember(m)}
                    />
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
                {t('internalTeam.ownerNote')}
              </p>
            </>
          )}
        </main>
      </div>

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

      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowAdd(false)}
        >
          <div
            className="rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6 max-w-sm mx-4 w-full max-h-[90vh] overflow-y-auto bg-[var(--color-surface-1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-[var(--color-text-primary)] mb-4">{t('inviteTeamMember')}</h3>
            <p className="text-xs text-[var(--color-text-secondary)] mb-3">{t('internalTeamUserMustSignUp')}</p>
            <div className="space-y-3">
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={tCommon('name')}
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm"
              />
              <input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder={tCommon('phone')}
                type="tel"
                dir="ltr"
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm"
              />
              <input
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder={tCommon('email')}
                type="email"
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm"
              />
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                  {t('internalTeamRoleLabel')}
                </label>
                <select
                  value={selectedRole}
                  onChange={(e) => {
                    setSelectedRole(e.target.value as RoleKey);
                    setCustomPerms([]);
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
              {selectedRole === 'custom' && (
                <div className="border border-[var(--color-border-subtle)] rounded-lg p-3 space-y-2">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {t('internalTeamPermissionsHeading')}
                  </p>
                  {ALL_ADMIN_PERMISSIONS.map((p) => (
                    <label key={p.key} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={customPerms.includes(p.key)}
                        onChange={(e) =>
                          setCustomPerms((prev) =>
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
                onClick={() => setShowAdd(false)}
                className="px-4 py-2 rounded-lg text-sm border border-border"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={actionLoading || !form.name.trim() || !form.phone.trim()}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-50"
              >
                {t('invite')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
