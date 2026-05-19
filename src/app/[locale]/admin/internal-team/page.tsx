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

type RoleKey =
  | 'internal_viewer'
  | 'internal_admin'
  | 'sales_rep'
  | 'support_agent'
  | 'accountant'
  | 'custom';

const ROLE_OPTIONS: RoleKey[] = [
  'internal_viewer',
  'internal_admin',
  'sales_rep',
  'support_agent',
  'accountant',
  'custom',
];

const ROLE_LABEL_KEY: Record<RoleKey, string> = {
  internal_viewer: 'internalTeamRoleViewer',
  internal_admin: 'internalTeamRoleInternalAdmin',
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
      loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : tCommon('errorGeneric'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemove = async (memberId: string) => {
    if (!confirm(t('confirmRemoveTeamMember'))) return;
    const headers = await getAdminAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/team', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ memberId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || tCommon('errorGeneric'));
      }
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
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700"
            >
              {t('addAdmin')}
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm flex items-center justify-between gap-3">
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
                            <button
                              type="button"
                              onClick={() => handleRemove(m.id)}
                              disabled={actionLoading}
                              className="px-2 py-1 rounded text-xs font-semibold border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                              {t('remove')}
                            </button>
                          ) : (
                            <span className="text-[var(--color-text-muted)]">{tCommon('notAvailable')}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>

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
