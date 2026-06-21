'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';
import { getAdminSession, getAdminAuthHeaders } from '@/lib/adminAuth-client';
import { PlanBadge } from '@/components/shared';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { ArrowLeft, RefreshCw, CheckCircle, XCircle, MessageCircle } from 'lucide-react';
import { formatDate } from '@/lib/formatNumber';

interface PendingSignup {
  id: string;
  name: string;
  phone?: string;
  email?: string | null;
  plan?: string;
  owner_name?: string | null;
  created_at?: string;
  referral_code_used?: string | null;
  referring_center_name?: string | null;
}

function contactViaWhatsApp(phone: string, centerName: string) {
  let normalized = phone.replace(/\D/g, '');
  if (normalized.startsWith('0')) normalized = '2' + normalized;
  if (!normalized.startsWith('20')) normalized = '20' + normalized;
  const message = encodeURIComponent(
    `السلام عليكم 👋\n\n` +
      `شكراً لتسجيلكم في TutoringHQ!\n\n` +
      `نود التواصل معكم لإتمام إعداد حساب "${centerName}" والتعرف على احتياجاتكم.\n\n` +
      `متى يناسبكم التحدث؟ 🙏`,
  );
  window.open(`https://wa.me/${normalized}?text=${message}`, '_blank', 'noopener,noreferrer');
}

export default function AdminPendingSignupsPage() {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();

  const [signups, setSignups] = useState<PendingSignup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showRejectReason, setShowRejectReason] = useState<PendingSignup | null>(null);

  const loadData = useCallback(async () => {
    const session = await getAdminSession();
    if (!session) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/pending-signups', {
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
      setSignups(Array.isArray(data?.signups) ? (data.signups as PendingSignup[]) : []);
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

  const handleAction = async (centerId: string, action: 'approve' | 'reject') => {
    const headers = await getAdminAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/centers', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ centerId, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || tCommon('errorGeneric'));
      }
      if (action === 'approve' && data?.whatsappUrl) {
        window.open(data.whatsappUrl, '_blank');
      }
      setShowRejectReason(null);
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
        <AdminSidebar activeRoute="/admin/pending-signups" />
        <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 overflow-auto lg:ms-56">
          <div className="flex items-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => router.push('/admin')}
              className="p-1.5 rounded-lg hover:bg-muted"
              aria-label={tCommon('back')}
            >
              <DirectionalIcon icon={ArrowLeft} className="h-5 w-5" />
            </button>
            <h1 className="text-xl font-bold">{t('pendingSignups')}</h1>
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
            <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden min-w-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px]">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{t('center')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{t('owner')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('phone')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden md:table-cell">{t('email')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{t('plan')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden md:table-cell">{t('referredBy')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{t('createdAt')}</th>
                      <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider min-w-[220px] whitespace-nowrap">{tCommon('actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {signups.map((ps) => (
                      <tr key={ps.id} className="hover:bg-[var(--color-surface-0)] transition-colors">
                        <td className="py-3.5 px-4 text-sm text-[var(--color-text-primary)] font-medium">{ps.name}</td>
                        <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)]">
                          {ps.owner_name ?? tCommon('notAvailable')}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs text-[var(--color-text-secondary)]" dir="ltr">
                          {ps.phone ?? tCommon('notSet')}
                        </td>
                        <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)] hidden md:table-cell">
                          {ps.email ?? tCommon('notSet')}
                        </td>
                        <td className="py-3.5 px-4"><PlanBadge plan={ps.plan} /></td>
                        <td className="py-3.5 px-4 font-mono text-xs text-[var(--color-text-secondary)] hidden md:table-cell">
                          {ps.referral_code_used ?? ps.referring_center_name ?? tCommon('notSet')}
                        </td>
                        <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)]">
                          {ps.created_at ? formatDate(ps.created_at, locale) : tCommon('notSet')}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-2 flex-nowrap">
                            <button
                              type="button"
                              onClick={() => contactViaWhatsApp(ps.phone ?? '', ps.name ?? '')}
                              className="inline-flex items-center gap-1.5 px-3 py-2 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold rounded-lg whitespace-nowrap transition-all shadow-sm"
                              title={t('contactWhatsApp')}
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">WhatsApp</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAction(ps.id, 'approve')}
                              disabled={actionLoading}
                              className="inline-flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg whitespace-nowrap transition-all shadow-sm disabled:opacity-50"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              {t('approve')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowRejectReason(ps)}
                              className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg whitespace-nowrap transition-all shadow-sm"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              {t('reject')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {signups.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-8 px-4 text-center text-[var(--color-text-secondary)]">
                          {t('noPending')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      {showRejectReason && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowRejectReason(null)}
        >
          <div
            className="rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6 max-w-sm mx-4 w-full bg-[var(--color-surface-1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-[var(--color-text-primary)] mb-3">{t('rejectionReason')}</h3>
            <textarea
              placeholder={t('rejectReasonPlaceholder')}
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm h-24 resize-none mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowRejectReason(null)}
                className="px-4 py-2 rounded-lg text-sm border border-border"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                onClick={() => handleAction(showRejectReason.id, 'reject')}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {t('reject')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
