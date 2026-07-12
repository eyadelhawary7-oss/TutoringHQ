'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';
import { getAdminSession, getAdminAuthHeaders } from '@/lib/adminAuth-client';
import { PlanBadge, BillingStatusBadge, SectionHeader, KpiCard } from '@/components/shared';
import PasswordConfirmModal from '@/components/PasswordConfirmModal';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import {
  ArrowLeft,
  RefreshCw,
  BadgeCheck,
  Bell,
  CheckCircle,
  XCircle,
  ExternalLink,
  X,
} from 'lucide-react';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';

interface BillingRow {
  id: string;
  ownerType?: 'center' | 'teacher';
  name: string;
  phone?: string;
  plan?: string;
  amount?: number;
  billing_period?: string;
  nextDue?: string;
  next_payment_due?: string;
  billing_status?: string;
  status?: string;
}

type OwnerFilter = 'center' | 'teacher' | 'all';

function normalizeOwnerFilter(raw: string | null | undefined): OwnerFilter {
  return raw === 'teacher' ? 'teacher' : raw === 'all' ? 'all' : 'center';
}

interface PaymentRow {
  centerName: string;
  amount: number;
  paid_at?: string;
  billing_period?: string;
  recorded_by?: string;
  proof_type?: string;
  proof_reference?: string;
}

interface PendingInvoice {
  id: string;
  centerName: string;
  payment_amount?: number;
  center_id: string;
}

function sendWhatsAppReminder(
  centerPhone: string,
  centerName: string,
  amount: number,
  nextDue: string,
  locale: string,
) {
  let phone = centerPhone.replace(/\D/g, '');
  if (phone.startsWith('0')) phone = '2' + phone;
  if (!phone.startsWith('20')) phone = '20' + phone;
  const formattedAmount = formatNumber(amount, 'ar');
  const formattedDue = formatDate(nextDue, 'ar');
  const message = encodeURIComponent(
    `السلام عليكم ${centerName} 👋\n\n` +
      `نود تذكيركم بأن دفعة اشتراككم في TutoringHQ بقيمة *${formattedAmount} ${locale === 'ar' ? 'ج.م' : 'EGP'}* مستحقة بتاريخ *${formattedDue}*.\n\n` +
      `يمكنكم تسوية الدفع ورفع إثبات الدفع من خلال:\n` +
      `🔗 https://tutoringhq.app/settings/billing\n\n` +
      `شكراً لثقتكم بـ TutoringHQ 🙏`,
  );
  window.open(`https://wa.me/${phone}?text=${message}`, '_blank', 'noopener,noreferrer');
}

export default function AdminBillingPage() {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const ownerFilter = normalizeOwnerFilter(searchParams?.get('owner_type'));
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();

  const setOwnerFilter = useCallback(
    (next: OwnerFilter) => {
      router.replace(next === 'center' ? '/admin/billing' : `/admin/billing?owner_type=${next}`);
    },
    [router],
  );

  const [billingData, setBillingData] = useState<BillingRow[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<PaymentRow[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<PendingInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [viewingProof, setViewingProof] = useState<string | null>(null);
  const [passwordConfirm, setPasswordConfirm] = useState<{
    inv: { id: string; centerName: string; payment_amount: number };
  } | null>(null);

  const loadData = useCallback(async () => {
    const session = await getAdminSession();
    if (!session) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = ownerFilter === 'center' ? '' : `?owner_type=${ownerFilter}`;
      const res = await fetch(`/api/admin/billing${qs}`, {
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
      const data = (await res.json().catch(() => ({}))) as {
        centers?: unknown;
        paymentHistory?: unknown;
        pendingInvoices?: unknown;
      };
      setBillingData(Array.isArray(data.centers) ? (data.centers as BillingRow[]) : []);
      setPaymentHistory(Array.isArray(data.paymentHistory) ? (data.paymentHistory as PaymentRow[]) : []);
      setPendingInvoices(
        Array.isArray(data.pendingInvoices) ? (data.pendingInvoices as PendingInvoice[]) : [],
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : tCommon('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }, [router, tCommon, ownerFilter]);

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

  const handleMarkPaid = async (centerId: string, amount: number, billingPeriod: string) => {
    const headers = await getAdminAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/billing', {
        method: 'POST',
        headers,
        body: JSON.stringify({ center_id: centerId, amount, billing_period: billingPeriod }),
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

  const handleInvoiceAction = async (
    invoiceId: string,
    action: 'approve' | 'reject',
    password?: string,
  ) => {
    const headers = await getAdminAuthHeaders();
    if (!headers) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/billing', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ invoiceId, action, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || tCommon('errorGeneric'));
      }
      setPasswordConfirm(null);
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
        <AdminSidebar activeRoute="/admin/billing" />
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
            <h1 className="text-xl font-bold">{t('billing')}</h1>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {(['center', 'teacher', 'all'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setOwnerFilter(f)}
                className={`px-3 py-1.5 rounded-badge text-xs font-medium transition-all duration-fast ease-out ${
                  ownerFilter === f
                    ? 'bg-[var(--color-brand-500)] text-white'
                    : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] border border-[var(--color-border-default)]'
                }`}
              >
                {f === 'center' ? t('ownerFilterCenters') : f === 'teacher' ? t('ownerFilterTeachers') : t('ownerFilterAll')}
              </button>
            ))}
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
            <div className="space-y-4" aria-busy="true" aria-live="polite">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-24 rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] chq-skeleton"
                  />
                ))}
              </div>
              <div className="chq-skeleton h-72 w-full rounded-xl" />
            </div>
          ) : (
            <>
              <div className="mb-3"><SectionHeader title={tCommon('sectionAtAGlance')} /></div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <KpiCard
                  label={t('totalCenters')}
                  value={formatNumber(billingData.filter((b) => b && b.id).length, locale)}
                />
                <KpiCard
                  label={t('pendingInvoices')}
                  value={formatNumber(pendingInvoices.length, locale)}
                  tone={pendingInvoices.length > 0 ? 'warning' : 'muted'}
                />
                <KpiCard
                  label={t('outstandingInvoices')}
                  value={formatCurrency(
                    pendingInvoices.reduce((sum, inv) => sum + (inv.payment_amount ?? 0), 0),
                    locale,
                  )}
                  tone="danger"
                />
                <KpiCard
                  label={t('collectedThisMonth')}
                  value={formatCurrency(
                    paymentHistory
                      .filter((p) => {
                        if (!p.paid_at) return false;
                        const d = new Date(p.paid_at);
                        const now = new Date();
                        return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
                      })
                      .reduce((sum, p) => sum + Number(p.amount ?? 0), 0),
                    locale,
                  )}
                  tone="success"
                />
              </div>

              <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden mb-6">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                        <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('name')}</th>
                        <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{t('plan')}</th>
                        <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden md:table-cell">{t('billingPeriod')}</th>
                        <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('amount')}</th>
                        <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden md:table-cell">{t('nextDue')}</th>
                        <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('status')}</th>
                        <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border-subtle)]">
                      {billingData.filter((b) => b && typeof b.id === 'string' && b.id.length > 0).length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 px-4 text-center text-[var(--color-text-secondary)] text-sm">
                            {t('noBillingRows')}
                          </td>
                        </tr>
                      ) : null}
                      {billingData
                        .filter((b) => b && typeof b.id === 'string' && b.id.length > 0)
                        .map((b) => {
                          const isPaid = b.billing_status === 'paid';
                          const isTeacher = b.ownerType === 'teacher';
                          const nextDueStr = b.nextDue ?? b.next_payment_due ?? '';
                          const billingStatus = b.billing_status ?? b.status ?? 'active';
                          return (
                            <tr key={`${b.ownerType ?? 'center'}:${b.id}`} className="hover:bg-[var(--color-surface-0)] transition-colors">
                              <td className="py-3.5 px-4 text-sm text-[var(--color-text-primary)] font-medium">
                                <span className="flex items-center gap-2">
                                  {b.name}
                                  {ownerFilter !== 'center' && (
                                    <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]">
                                      {isTeacher ? t('rowOwnerTeacher') : t('rowOwnerCenter')}
                                    </span>
                                  )}
                                </span>
                              </td>
                              <td className="py-3.5 px-4"><PlanBadge plan={b.plan} /></td>
                              <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)] hidden md:table-cell">
                                {b.billing_period ?? tCommon('notSet')}
                              </td>
                              <td className="py-3.5 px-4 font-mono font-bold text-[var(--color-text-primary)]">
                                {formatCurrency(b.amount ?? 0, locale)}
                              </td>
                              <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)] hidden md:table-cell">
                                {nextDueStr || tCommon('notSet')}
                              </td>
                              <td className="py-3.5 px-4">
                                <BillingStatusBadge
                                  status={isPaid ? 'paid' : billingStatus === 'overdue' ? 'overdue' : 'active'}
                                  nextDue={nextDueStr || new Date().toISOString()}
                                />
                              </td>
                              <td className="py-3.5 px-4 min-w-[280px]">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {!isPaid && !isTeacher && (
                                    <button
                                      type="button"
                                      onClick={() => handleMarkPaid(b.id, b.amount ?? 0, b.billing_period ?? 'monthly')}
                                      disabled={actionLoading}
                                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg whitespace-nowrap transition-all shadow-sm disabled:opacity-50"
                                    >
                                      <BadgeCheck className="w-4 h-4" />
                                      {t('markAsPaid')}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      sendWhatsAppReminder(b.phone ?? '', b.name ?? '', b.amount ?? 0, nextDueStr || '', locale)
                                    }
                                    disabled={actionLoading}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 border border-[var(--color-border-default)] hover:bg-[var(--color-surface-0)] hover:border-[var(--color-border-strong)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg whitespace-nowrap transition-all disabled:opacity-50"
                                  >
                                    <Bell className="w-4 h-4" />
                                    {t('sendReminder')}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>

              {pendingInvoices.length > 0 && (
                <>
                  <div className="mt-6 mb-3"><SectionHeader title={t('pendingInvoices')} /></div>
                  <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden mb-6">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                            <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('name')}</th>
                            <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('amount')}</th>
                            <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('actions')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-border-subtle)]">
                          {pendingInvoices.map((inv) => (
                            <tr key={inv.id} className="hover:bg-[var(--color-surface-0)] transition-colors">
                              <td className="py-3.5 px-4 text-sm text-[var(--color-text-primary)] font-medium">{inv.centerName}</td>
                              <td className="py-3.5 px-4 font-mono font-bold text-[var(--color-text-primary)]">
                                {formatCurrency(inv.payment_amount ?? 0, locale)}
                              </td>
                              <td className="py-3.5 px-4 min-w-[360px]">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if ((inv.payment_amount ?? 0) > 50000) {
                                        setPasswordConfirm({
                                          inv: {
                                            id: inv.id,
                                            centerName: inv.centerName,
                                            payment_amount: inv.payment_amount ?? 0,
                                          },
                                        });
                                      } else {
                                        handleInvoiceAction(inv.id, 'approve');
                                      }
                                    }}
                                    disabled={actionLoading}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white text-sm font-semibold rounded-lg whitespace-nowrap transition-all shadow-sm hover:shadow-md disabled:opacity-50"
                                  >
                                    <CheckCircle className="w-4 h-4" />
                                    {t('approvePay')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleInvoiceAction(inv.id, 'reject')}
                                    disabled={actionLoading}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-sm font-semibold rounded-lg whitespace-nowrap transition-all shadow-sm hover:shadow-md disabled:opacity-50"
                                  >
                                    <XCircle className="w-4 h-4" />
                                    {t('rejectPayment')}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              <div className="mt-6 mb-3"><SectionHeader title={t('paymentHistory')} /></div>
              <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                        <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{t('createdAt')}</th>
                        <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('name')}</th>
                        <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('amount')}</th>
                        <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden md:table-cell">{t('billingPeriod')}</th>
                        <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden lg:table-cell">{t('recordedBy')}</th>
                        <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden xl:table-cell">{t('paymentProofTypeCol')}</th>
                        <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden xl:table-cell">{t('paymentProofReferenceCol')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border-subtle)]">
                      {paymentHistory.map((p, i) => {
                        const proofUrl =
                          p.proof_type === 'paymob'
                            ? (p.proof_reference || '').trim()
                            : '';
                        const proofRefDisplay =
                          proofUrl.length > 48
                            ? `${proofUrl.slice(0, 45)}…`
                            : (p.proof_reference ?? tCommon('notSet'));
                        const typeLabel =
                          p.proof_type === 'paymob'
                            ? t('proofTypePaymob')
                            : p.proof_type === 'manual'
                              ? t('proofTypeManual')
                              : p.proof_type === 'record'
                                ? t('proofTypeRecord')
                                : t('proofTypeNone');
                        return (
                          <tr key={i} className="hover:bg-[var(--color-surface-0)] transition-colors">
                            <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)]">
                              {p.paid_at ? formatDate(p.paid_at, locale) : tCommon('notSet')}
                            </td>
                            <td className="py-3.5 px-4 text-sm text-[var(--color-text-primary)] font-medium">
                              {(() => {
                                const cleaned = (p.centerName ?? '').replace(/[\s,]/g, '');
                                return cleaned.length > 0 ? p.centerName : tCommon('notAvailable');
                              })()}
                            </td>
                            <td className="py-3.5 px-4 font-mono font-bold text-[var(--color-text-primary)]">
                              {formatCurrency(Number(p.amount ?? 0), locale)}
                            </td>
                            <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)] hidden md:table-cell">
                              {p.billing_period ?? tCommon('notSet')}
                            </td>
                            <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)] hidden lg:table-cell">
                              {p.recorded_by ?? tCommon('notSet')}
                            </td>
                            <td className="py-3.5 px-4 text-sm hidden xl:table-cell">
                              <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-[var(--color-surface-0)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]">
                                {typeLabel}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)] hidden xl:table-cell max-w-[280px]">
                              {proofUrl ? (
                                <button
                                  type="button"
                                  onClick={() => setViewingProof(proofUrl)}
                                  className="text-start text-blue-600 hover:underline font-mono text-xs truncate block max-w-full"
                                  title={proofUrl}
                                >
                                  {proofRefDisplay}
                                </button>
                              ) : (
                                <span className="font-mono text-xs break-all" title={p.proof_reference ?? undefined}>
                                  {p.proof_reference ?? tCommon('notSet')}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {viewingProof && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setViewingProof(null)}
        >
          <div className="relative max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-white font-semibold">{t('paymentProof')}</span>
              <div className="flex items-center gap-2">
                <a
                  href={viewingProof}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-surface-1)]/20 hover:bg-[var(--color-surface-1)]/30 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> {t('openOriginal')}
                </a>
                <button
                  type="button"
                  onClick={() => setViewingProof(null)}
                  className="p-2 bg-[var(--color-surface-1)]/20 hover:bg-[var(--color-surface-1)]/30 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={viewingProof}
              alt={t('paymentProofAlt')}
              className="w-full rounded-xl shadow-2xl max-h-[80vh] object-contain bg-[var(--color-surface-1)]"
            />
          </div>
        </div>
      )}

      {passwordConfirm && (
        <PasswordConfirmModal
          isOpen={!!passwordConfirm}
          onClose={() => setPasswordConfirm(null)}
          title={t('confirmApprovePayment')}
          onConfirm={async (password) => {
            await handleInvoiceAction(passwordConfirm.inv.id, 'approve', password);
            setPasswordConfirm(null);
          }}
        />
      )}
    </div>
  );
}
