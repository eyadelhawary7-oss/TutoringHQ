'use client';

import { useUser } from '@/contexts/UserContext';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { formatCurrency, formatDate } from '@/lib/formatNumber';
import { PLANS, normalizeBillingPeriod, type PlanKey } from '@/lib/pricing';
import { BLAST_PRICE_PER_PARENT, todayISO } from '@/lib/parentPack';
import { supabase } from '@/lib/supabase';
import { FEATURES } from '@/lib/features';
import { isSubscriptionPastDueBanner } from '@/lib/subscriptionPastDue';
import { PaymobInvoiceModal } from '@/components/billing/PaymobInvoiceModal';
import { useToast } from '@/hooks/useToast';

type DashboardPayload = {
  gracePeriodDays: number;
  center: {
    plan: PlanKey;
    billing_period: string | null;
    status: string | null;
    subscription_status: string | null;
    billing_status: string | null;
    next_payment_due: string | null;
    auto_suspend_at: string | null;
    billing_amount: number | null;
    all_in_price: number | null;
    is_early_adopter: boolean;
    weekly_student_limit: number;
    parent_pack_enabled: boolean;
    parent_pack_active_parents: number;
    pack_price_per_parent: number;
    announcement_balance: number;
  };
  studentCount: number;
  payNowInvoiceId: string | null;
  payNowAmount: number;
  invoices: Record<string, unknown>[];
  invoicePagination: { page: number; perPage: number; total: number; totalPages: number };
  addons: {
    blastMonthParents: number;
    blastMonthSpend: number;
    cardOrders: { openPipeline: number };
  };
};

function relativeDuePhrase(ymd: string, locale: string): string {
  const today = todayISO();
  const d0 = Date.UTC(
    parseInt(ymd.slice(0, 4), 10),
    parseInt(ymd.slice(5, 7), 10) - 1,
    parseInt(ymd.slice(8, 10), 10),
  );
  const t0 = Date.UTC(
    parseInt(today.slice(0, 4), 10),
    parseInt(today.slice(5, 7), 10) - 1,
    parseInt(today.slice(8, 10), 10),
  );
  const diffDays = Math.round((d0 - t0) / (24 * 60 * 60 * 1000));
  const rtf = new Intl.RelativeTimeFormat(locale === 'ar' || locale.startsWith('ar') ? 'ar-EG' : 'en-US', {
    numeric: 'auto',
  });
  return rtf.format(diffDays, 'day');
}

function subscriptionStatusKey(
  raw: string | null | undefined,
): 'active' | 'pending' | 'suspended' | 'pastDue' | 'cancelled' | 'trial' {
  const v = (raw ?? '').toLowerCase();
  if (v === 'suspended') return 'suspended';
  if (v === 'pending') return 'pending';
  if (v === 'cancelled') return 'cancelled';
  if (v === 'trial') return 'trial';
  if (v === 'overdue') return 'pastDue';
  return 'active';
}

function StatusPill({
  subscriptionStatus,
  t,
}: {
  subscriptionStatus: string | null | undefined;
  t: (key: string) => string;
}) {
  const k = subscriptionStatusKey(subscriptionStatus);
  const label =
    k === 'active'
      ? t('status.active')
      : k === 'pending'
        ? t('status.pending')
        : k === 'suspended'
          ? t('status.suspended')
          : k === 'pastDue'
            ? t('status.pastDue')
            : k === 'cancelled'
              ? t('status.cancelled')
              : t('status.trial');
  return (
    <span className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-3 py-1 text-xs font-medium text-[var(--color-text-primary)]">
      {label}
    </span>
  );
}
export default function BillingPageClient() {
  const t = useTranslations('billing.sub');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { user } = useUser();

  const ownerOk = user?.role === 'owner' || user?.role === 'super_admin';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [page, setPage] = useState(1);
  const [paymobUrl, setPaymobUrl] = useState<string | null>(null);
  const [paymobSessionId, setPaymobSessionId] = useState<string | null>(null);
  const [pollInvoiceId, setPollInvoiceId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    if (!ownerOk) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Unauthorized');
      const qs = new URLSearchParams();
      qs.set('page', String(page));
      qs.set('limit', '12');
      const res = await fetch(`/api/billing/dashboard?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = (await res.json()) as DashboardPayload & { error?: string };
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Error');
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('loadError'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ownerOk, page, t]);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    const p = searchParams?.get('paid');
    if (p === '1') {
      toast.success(t('nextPayment.paySuccess'));
      void fetchDashboard();
    }
  }, [searchParams, toast, t, fetchDashboard]);

  const handlePayNow = async () => {
    if (!ownerOk || !data?.payNowInvoiceId || !FEATURES.PAYMOB_ENABLED) {
      if (!FEATURES.PAYMOB_ENABLED) toast.info(t('nextPayment.payDisabled'));
      return;
    }
    setPaying(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Unauthorized');
      const res = await fetch(`/api/invoices/${data.payNowInvoiceId}/pay`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = (await res.json()) as { iframeUrl?: string; orderId?: string; error?: string };
      if (!res.ok) {
        toast.error(typeof j.error === 'string' ? j.error : t('nextPayment.payFailed'));
        return;
      }
      const iframeUrl = j.iframeUrl;
      const orderId = typeof j.orderId === 'string' ? j.orderId : '';
      if (iframeUrl) {
        setPaymobUrl(iframeUrl);
        setPaymobSessionId(orderId || null);
        setPollInvoiceId(orderId ? null : data.payNowInvoiceId);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('nextPayment.payFailed'));
    } finally {
      setPaying(false);
    }
  };

  const handlePdf = async (invoiceId: string, invoiceNumber: string | null) => {
    setPdfLoadingId(invoiceId);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;
      const res = await fetch(`/api/invoices/${invoiceId}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        toast.error(t('loadError'));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safe =
        (invoiceNumber && invoiceNumber.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80)) ||
        `invoice-${invoiceId.slice(0, 8)}`;
      a.download = `${safe}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setPdfLoadingId(null);
    }
  };

  const invoiceTypeLabel = (raw: string | null | undefined) => {
    const v = (raw ?? '').toLowerCase();
    if (v === 'subscription') return t('history.typeRenewal');
    if (v === 'subscription_initial' || v === 'base_subscription') return t('history.typeInitial');
    if (v === 'pack_billing') return t('history.typeAddon');
    return t('history.typeOther');
  };

  const invoiceStatusLabel = (raw: string | null | undefined) => {
    const v = (raw ?? '').toLowerCase();
    if (v === 'paid' || v === 'approved') return t('history.invoiceStatusPaid');
    if (v === 'pending') return t('history.invoiceStatusPending');
    if (v === 'failed') return t('history.invoiceStatusFailed');
    if (v === 'overdue') return t('history.invoiceStatusOverdue');
    return raw ?? '—';
  };

  const showPagination = (data?.invoicePagination.total ?? 0) > 20;

  const addonsVisible = useMemo(() => {
    if (!data?.center) return false;
    const c = data.center;
    return (
      (c.parent_pack_enabled && c.parent_pack_active_parents > 0) ||
      data.addons.blastMonthParents > 0 ||
      data.addons.cardOrders.openPipeline > 0
    );
  }, [data]);

  if (!ownerOk) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-[var(--color-text-secondary)]">{t('ownerOnly')}</p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-[var(--color-text-secondary)]">{t('loading')}</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-red-600 dark:text-red-400">{error ?? t('loadError')}</p>
      </div>
    );
  }

  if (!data.center) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-red-600 dark:text-red-400">{t('loadError')}</p>
      </div>
    );
  }

  const center = data.center;

  const planCfg = PLANS[center.plan];
  const planNameAr = planCfg?.arabicName ?? '';
  const planNameEn = planCfg?.englishName ?? '';

  const bp = normalizeBillingPeriod(center.billing_period ?? undefined);
  const periodLabel =
    bp === 'monthly'
      ? t('currentPlan.periodMonthly')
      : bp === 'annual'
        ? t('currentPlan.periodAnnual')
        : t('currentPlan.periodQuarterly');

  const displayAmount =
    center.billing_amount != null && Number.isFinite(center.billing_amount)
      ? Number(center.billing_amount)
      : Number(center.all_in_price ?? 0);

  const npd = center.next_payment_due?.slice(0, 10);
  const pastDueUi = isSubscriptionPastDueBanner({
    status: center.status,
    subscription_status: center.subscription_status,
    billing_status: center.billing_status,
    next_payment_due: center.next_payment_due,
  });

  const cap = center.weekly_student_limit ?? 0;
  const usage = data.studentCount ?? 0;
  const progressPct =
    cap > 0 ? Math.min(100, Math.round((usage / Math.max(cap, 1)) * 100)) : 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
      </header>

      <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
          {t('currentPlan.title')}
        </h2>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xl font-semibold text-[var(--color-text-primary)]" dir="auto">
              {planNameAr}
            </p>
            <p className="text-sm text-[var(--color-text-secondary)]">{planNameEn}</p>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              {t('currentPlan.priceLine', {
                amount: formatCurrency(displayAmount, locale),
                period: periodLabel,
              })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill subscriptionStatus={center.subscription_status} t={t} />
            {center.is_early_adopter ? (
              <span className="rounded-full bg-teal-600/15 px-3 py-1 text-xs font-semibold text-teal-700 dark:text-teal-300">
                {t('currentPlan.earlyAdopter')}
              </span>
            ) : null}
          </div>
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-sm text-[var(--color-text-secondary)] mb-1">
            <span>
              {cap > 0
                ? t('currentPlan.studentsUsage', { current: usage, cap })
                : t('currentPlan.studentsUsageUnlimited', { current: usage })}
            </span>
            <span className="tabular-nums">{progressPct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-0)]">
            <div
              className="h-full rounded-full bg-teal-600 transition-[width]"
              style={{ width: `${cap > 0 ? progressPct : 100}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            {t('currentPlan.planCap')}: {cap > 0 ? cap : '—'}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
          {t('nextPayment.title')}
        </h2>
        {pastDueUi ? (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-red-500/50 bg-red-600/15 px-4 py-3 text-sm text-red-800 dark:text-red-100"
          >
            {t('nextPayment.pastDueBanner')}
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-[var(--color-text-secondary)]">
              {t('nextPayment.dueDate')}
            </p>
            <p className="text-base font-semibold text-[var(--color-text-primary)]">
              {npd
                ? `${formatDate(`${npd}T12:00:00`, locale, 'long')} · ${t('nextPayment.relative', {
                    relative: relativeDuePhrase(npd, locale),
                  })}`
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-[var(--color-text-secondary)]">
              {t('nextPayment.amount')}
            </p>
            <p className="text-base font-semibold tabular-nums text-[var(--color-text-primary)]">
              {formatCurrency(data.payNowAmount || displayAmount, locale)}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handlePayNow()}
            disabled={
              paying ||
              !FEATURES.PAYMOB_ENABLED ||
              !data.payNowInvoiceId ||
              (center.subscription_status ?? '').toLowerCase() === 'cancelled'
            }
            className="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
          >
            {paying ? t('nextPayment.paying') : t('nextPayment.payNow')}
          </button>
          {!FEATURES.PAYMOB_ENABLED ? (
            <span className="text-sm text-[var(--color-text-secondary)]">{t('nextPayment.payDisabled')}</span>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
          {t('history.title')}
        </h2>
        {data.invoices.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">{t('history.empty')}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)] text-start text-[var(--color-text-secondary)]">
                    <th className="py-2 pe-3">{t('history.colDate')}</th>
                    <th className="py-2 pe-3">{t('history.colType')}</th>
                    <th className="py-2 pe-3">{t('history.colAmount')}</th>
                    <th className="py-2 pe-3">{t('history.colStatus')}</th>
                    <th className="py-2">{t('history.colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.map((inv) => {
                    const id = String(inv.id ?? '');
                    const created = inv.created_at ? formatDate(String(inv.created_at), locale) : '—';
                    const amt = Number(inv.total_amount ?? 0);
                    return (
                      <tr key={id} className="border-b border-[var(--color-border-subtle)]/60">
                        <td className="py-2 pe-3 whitespace-nowrap">{created}</td>
                        <td className="py-2 pe-3">{invoiceTypeLabel(inv.invoice_type as string)}</td>
                        <td className="py-2 pe-3 tabular-nums">{formatCurrency(amt, locale)}</td>
                        <td className="py-2 pe-3">{invoiceStatusLabel(inv.status as string)}</td>
                        <td className="py-2">
                          <button
                            type="button"
                            className="text-teal-600 hover:underline text-xs font-medium disabled:opacity-50"
                            disabled={pdfLoadingId === id}
                            onClick={() =>
                              void handlePdf(id, inv.invoice_number ? String(inv.invoice_number) : null)
                            }
                          >
                            {pdfLoadingId === id ? '…' : t('history.download')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {showPagination ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-[var(--color-text-secondary)]">
                  {t('history.pageIndicator', {
                    page: data.invoicePagination.page,
                    totalPages: data.invoicePagination.totalPages,
                  })}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1 disabled:opacity-40"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {t('history.pagePrev')}
                  </button>
                  <button
                    type="button"
                    disabled={page >= data.invoicePagination.totalPages}
                    className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1 disabled:opacity-40"
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t('history.pageNext')}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>

      {addonsVisible ? (
        <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
            {t('addons.title')}
          </h2>
          <ul className="space-y-2 text-sm text-[var(--color-text-secondary)]">
            {data.center.parent_pack_enabled ? (
              <li>
                {t('addons.parentPack', {
                  parents: data.center.parent_pack_active_parents,
                  price: data.center.pack_price_per_parent,
                })}
              </li>
            ) : (
              <li>{t('addons.parentPackOff')}</li>
            )}
            <li>
              {t('addons.blastLine', {
                messages: data.addons.blastMonthParents,
                amount: formatCurrency(data.addons.blastMonthSpend || BLAST_PRICE_PER_PARENT * data.addons.blastMonthParents, locale),
              })}
            </li>
            <li>
              {t('addons.cardOrders', { count: data.addons.cardOrders.openPipeline })}{' '}
              <Link href="/orders" className="text-teal-600 hover:underline font-medium">
                {t('addons.ordersLink')}
              </Link>
            </li>
          </ul>
        </section>
      ) : null}

      <footer className="text-center text-xs text-[var(--color-text-secondary)] pb-8">
        {t('cancellation.footer')}
      </footer>

      {paymobUrl ? (
        <PaymobInvoiceModal
          iframeUrl={paymobUrl}
          sessionId={paymobSessionId}
          invoicePollId={pollInvoiceId}
          title={t('pastDue.modalTitle')}
          iframeTitle={t('pastDue.modalIframeTitle')}
          closeLabel={t('pastDue.modalClose')}
          onClose={() => {
            setPaymobUrl(null);
            setPaymobSessionId(null);
            setPollInvoiceId(null);
          }}
          onSuccess={() => {
            setPaymobUrl(null);
            setPaymobSessionId(null);
            setPollInvoiceId(null);
            toast.success(t('nextPayment.paySuccess'));
            void fetchDashboard();
          }}
          onError={() => {
            setPaymobUrl(null);
            setPaymobSessionId(null);
            setPollInvoiceId(null);
            toast.error(t('nextPayment.payFailed'));
          }}
        />
      ) : null}
    </div>
  );
}
