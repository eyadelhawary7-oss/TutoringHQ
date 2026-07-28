'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';
import { getAdminSession, getAdminAuthHeaders } from '@/lib/adminAuth-client';
import { STATUS_STYLES } from '@/lib/adminUtils';
import { PlanBadge } from '@/components/shared';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { ArrowLeft, RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import { formatDate } from '@/lib/formatNumber';

interface PlanRequest {
  id: string;
  center_id: string;
  centerName: string;
  current_plan?: string;
  requested_plan: string;
  status: string;
  requested_at?: string;
  priceDiffFormatted?: string;
}

export default function AdminPlanRequestsPage() {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();

  const [requests, setRequests] = useState<PlanRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const loadData = useCallback(async () => {
    const session = await getAdminSession();
    if (!session) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/plan-requests', {
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
      setRequests(Array.isArray(data?.requests) ? data.requests : []);
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

  const handleAction = async (requestId: string, action: 'approve' | 'reject') => {
    const headers = await getAdminAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/plan-requests', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ requestId, action }),
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
        <AdminSidebar activeRoute="/admin/plan-requests" />
        <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 overflow-auto lg:ms-56">
          <div className="flex items-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => router.push('/admin')}
              className="p-1.5 rounded-lg hover:bg-tile"
              aria-label={tCommon('back')}
            >
              <DirectionalIcon icon={ArrowLeft} className="h-5 w-5" />
            </button>
            <h1 className="text-xl font-bold">{t('planRequests')}</h1>
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
          ) : requests.length === 0 ? (
            <div className="text-center py-16 text-[var(--color-text-muted)]">
              {t('noPlanRequests')}
            </div>
          ) : (
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('name')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{t('planChangeHeader')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{t('createdAt')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('status')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {requests
                      .filter((pr) => pr && typeof pr.id === 'string' && pr.id.length > 0)
                      .map((pr) => (
                        <tr key={pr.id} className="hover:bg-[var(--color-surface-0)] transition-colors">
                          <td className="py-3.5 px-4 text-sm text-[var(--color-text-primary)] font-medium">
                            {pr.centerName ?? tCommon('notAvailable')}
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2">
                              <PlanBadge plan={pr.current_plan} />
                              <span className="text-[var(--color-text-secondary)] rtl:scale-x-[-1] inline-block" aria-hidden>→</span>
                              <PlanBadge plan={pr.requested_plan} />
                              {pr.priceDiffFormatted && (
                                <span className="text-xs text-[var(--color-text-secondary)]">{pr.priceDiffFormatted}</span>
                              )}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)]">
                            {pr.requested_at ? formatDate(pr.requested_at, locale) : tCommon('notSet')}
                          </td>
                          <td className="py-3.5 px-4">
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                pr.status === 'pending'
                                  ? STATUS_STYLES.pending
                                  : pr.status === 'approved'
                                    ? STATUS_STYLES.active
                                    : STATUS_STYLES.rejected
                              }`}
                            >
                              {pr.status === 'pending'
                                ? t('pending')
                                : pr.status === 'approved'
                                  ? t('approved')
                                  : t('rejected')}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            {pr.status === 'pending' && (
                              <div className="flex items-center gap-2 flex-nowrap">
                                <button
                                  type="button"
                                  onClick={() => handleAction(pr.id, 'approve')}
                                  disabled={actionLoading}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg whitespace-nowrap transition-all shadow-sm disabled:opacity-50"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                  {t('approve')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleAction(pr.id, 'reject')}
                                  disabled={actionLoading}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg whitespace-nowrap transition-all shadow-sm disabled:opacity-50"
                                >
                                  <XCircle className="w-4 h-4" />
                                  {t('reject')}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
