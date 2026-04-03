'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/useToast';
import { normalizeBillingPeriod, PLANS, isPlanKey, type PlanKey } from '@/lib/pricing';
import { FEATURES } from '@/lib/features';

const SUGGESTED_RESALE_EGP = 25;

type CenterRow = {
  plan?: string;
  subscription_billing_period?: string | null;
  billing_period?: string | null;
  next_payment_due?: string | null;
  all_in_price?: number | null;
  billing_status?: string;
  subscription_status?: string;
  status?: string;
  parent_pack_enabled?: boolean;
  pack_request_status?: string | null;
  pack_price_per_parent?: number | string | null;
  parent_pack_active_parents?: number | null;
  announcement_balance?: number | string | null;
};

type InvoiceRow = {
  id: string;
  invoice_number?: string | null;
  invoice_type?: string | null;
  total_amount?: number | string | null;
  billing_period_start?: string | null;
  billing_period_end?: string | null;
  status?: string | null;
  created_at?: string | null;
};

type PlanRequestRow = {
  id: string;
  current_plan: string;
  requested_plan: string;
  status: string;
  requested_at?: string | null;
};

function formatNum(n: number | null | undefined): string {
  return (Number(n) || 0).toLocaleString('en-US');
}

function PaymobModal({
  iframeUrl,
  title,
  closeLabel,
  onClose,
}: {
  iframeUrl: string;
  title: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 p-4">
          <span className="font-semibold text-slate-800 dark:text-slate-100">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            aria-label={closeLabel}
          >
            ✕
          </button>
        </div>
        <iframe src={iframeUrl} className="w-full" style={{ height: '600px' }} title="Paymob Payment" />
      </div>
    </div>
  );
}

export default function BillingPage() {
  const t = useTranslations('billing');
  const locale = useLocale();
  const toast = useToast();

  const [center, setCenter] = useState<CenterRow | null>(null);
  const [userRole, setUserRole] = useState<string>('');
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [planRequests, setPlanRequests] = useState<PlanRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [packRequestLoading, setPackRequestLoading] = useState(false);
  const [paymobIframeUrl, setPaymobIframeUrl] = useState<string | null>(null);
  const [pollInvoiceId, setPollInvoiceId] = useState<string | null>(null);
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) return;
    const h = { Authorization: `Bearer ${session.access_token}` };
    const [meRes, invRes] = await Promise.all([
      fetch('/api/me', { headers: h }),
      fetch('/api/billing/invoices', { headers: h }),
    ]);
    if (meRes.ok) {
      const meJson = (await meRes.json()) as {
        user?: { role?: string; center_id?: string | null; center?: CenterRow | null };
      };
      setUserRole(String(meJson.user?.role ?? ''));
      setCenter(meJson.user?.center ?? null);
      const cid = meJson.user?.center_id ?? null;
      if (cid) {
        const { data: pr } = await supabase
          .from('plan_requests')
          .select('id, current_plan, requested_plan, status, requested_at')
          .eq('center_id', cid)
          .order('requested_at', { ascending: false })
          .limit(20);
        setPlanRequests((pr as PlanRequestRow[]) ?? []);
      }
    }
    if (invRes.ok) {
      const invJson = (await invRes.json()) as { invoices?: InvoiceRow[] };
      setInvoices(invJson.invoices ?? []);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData.session;
        if (!session) {
          if (!cancelled) {
            setError(t('loadError'));
            setLoading(false);
          }
          return;
        }
        const h = { Authorization: `Bearer ${session.access_token}` };
        const [meRes, invRes] = await Promise.all([
          fetch('/api/me', { headers: h }),
          fetch('/api/billing/invoices', { headers: h }),
        ]);
        if (!meRes.ok) {
          const j = await meRes.json().catch(() => ({}));
          if (!cancelled) setError(typeof j.error === 'string' ? j.error : t('loadError'));
          return;
        }
        const meJson = (await meRes.json()) as {
          user?: { role?: string; center_id?: string | null; center?: CenterRow | null };
        };
        const cid = meJson.user?.center_id ?? null;
        if (!cancelled) {
          setUserRole(String(meJson.user?.role ?? ''));
          setCenter(meJson.user?.center ?? null);
        }
        if (invRes.ok) {
          const invJson = (await invRes.json()) as { invoices?: InvoiceRow[] };
          if (!cancelled) setInvoices(invJson.invoices ?? []);
        }
        if (cid) {
          const { data: pr } = await supabase
            .from('plan_requests')
            .select('id, current_plan, requested_plan, status, requested_at')
            .eq('center_id', cid)
            .order('requested_at', { ascending: false })
            .limit(20);
          if (!cancelled) setPlanRequests((pr as PlanRequestRow[]) ?? []);
        } else if (!cancelled) {
          setPlanRequests([]);
        }
      } catch {
        if (!cancelled) setError(t('loadError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (!paymobIframeUrl || !pollInvoiceId) return;
    const tick = async () => {
      try {
        const r = await fetch(`/api/paymob/invoice-status?invoiceId=${encodeURIComponent(pollInvoiceId)}`);
        const j = (await r.json()) as { paid?: boolean; failed?: boolean };
        if (j.paid) {
          setPaymobIframeUrl(null);
          setPollInvoiceId(null);
          toast.success(t('paymentSuccess'));
          await refresh();
        }
        if (j.failed) {
          setPaymobIframeUrl(null);
          setPollInvoiceId(null);
          toast.error(t('paymentFailed'));
        }
      } catch {
        /* keep polling */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, [paymobIframeUrl, pollInvoiceId, refresh, t, toast]);

  const ownerOk = userRole === 'owner';

  const planKey: PlanKey = useMemo(() => {
    const p = center?.plan ?? 'starter';
    return isPlanKey(p) ? p : 'starter';
  }, [center?.plan]);

  const bp = useMemo(
    () => normalizeBillingPeriod(center?.subscription_billing_period ?? center?.billing_period),
    [center?.subscription_billing_period, center?.billing_period],
  );

  const npdYmd = center?.next_payment_due?.slice(0, 10) ?? '';

  const daysUntilDue = useMemo(() => {
    if (!npdYmd) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(`${npdYmd}T12:00:00`);
    due.setHours(0, 0, 0, 0);
    return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }, [npdYmd]);

  const bsLower = (center?.billing_status ?? '').toLowerCase();
  const subLower = (center?.subscription_status ?? '').toLowerCase();
  const isSuspendedCenter = (center?.status ?? '').toLowerCase() === 'suspended';
  const isOverdue = bsLower === 'overdue';
  const showSuspendBanner = isOverdue || subLower === 'suspended' || isSuspendedCenter;

  const secondaryPlanName = useMemo(() => {
    const pk = planKey;
    return locale === 'ar' ? PLANS[pk].englishName : PLANS[pk].arabicName;
  }, [planKey, locale]);

  const filteredInvoices = useMemo(
    () => invoices.filter((inv) => (inv.invoice_type ?? '').toLowerCase() !== 'payment_proof'),
    [invoices],
  );

  const packPrice = Number(center?.pack_price_per_parent ?? 0) || 0;
  const packParents = Number(center?.parent_pack_active_parents ?? 0) || 0;
  const announcementBal = Number(center?.announcement_balance ?? 0) || 0;
  const packEnabled = center?.parent_pack_enabled === true;
  const packReq = (center?.pack_request_status ?? 'none').toLowerCase();
  const profitPerParent = SUGGESTED_RESALE_EGP - packPrice;
  const monthlyPackCost = packParents * packPrice;

  const handlePackRequest = async () => {
    if (!ownerOk) return;
    setPackRequestLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error(t('loadError'));
      const res = await fetch('/api/parent-pack/request', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof j.error === 'string' ? j.error : t('paymentFailed'));
        return;
      }
      toast.success(t('pack.requestSuccess'));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('paymentFailed'));
    } finally {
      setPackRequestLoading(false);
    }
  };

  const handleInvoicePay = async (invoiceId: string) => {
    if (!ownerOk || !FEATURES.PAYMOB_ENABLED) {
      toast.info(t('history.payDisabled'));
      return;
    }
    setPayingInvoiceId(invoiceId);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error(t('loadError'));
      const res = await fetch(`/api/invoices/${invoiceId}/pay`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof j.error === 'string' ? j.error : t('paymentFailed'));
        return;
      }
      const iframeUrl = j.iframeUrl as string | undefined;
      if (iframeUrl) {
        setPaymobIframeUrl(iframeUrl);
        setPollInvoiceId(invoiceId);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('paymentFailed'));
    } finally {
      setPayingInvoiceId(null);
    }
  };

  const billingStatusChip = useMemo(() => {
    if (isSuspendedCenter || subLower === 'suspended') {
      return {
        cls: 'border-red-400/60 bg-red-500/20 text-white animate-pulse',
        label: t('status.suspended'),
        icon: '🔴' as const,
      };
    }
    if (bsLower === 'paid' || bsLower === 'active') {
      return { cls: 'border-emerald-400/50 bg-emerald-500/20 text-emerald-50', label: t('status.paid'), icon: null };
    }
    if (bsLower === 'due_soon') {
      return {
        cls: 'border-amber-400/60 bg-amber-500/25 text-amber-50 animate-pulse',
        label: t('statusLabel.due_soon'),
        icon: null,
      };
    }
    if (bsLower === 'overdue') {
      return { cls: 'border-red-400/60 bg-red-500/20 text-red-50 animate-pulse', label: t('status.overdue'), icon: null };
    }
    return { cls: 'border-white/30 bg-white/10 text-white', label: t('status.active'), icon: null };
  }, [bsLower, subLower, isSuspendedCenter, t]);

  const invoiceStatusDisplay = (raw: string | null | undefined) => {
    const v = (raw ?? '').toLowerCase();
    if (v === 'paid' || v === 'approved') return t('status.paid');
    if (v === 'pending') return t('status.pending');
    if (v === 'overdue') return t('status.overdue');
    if (v === 'cancelled' || v === 'canceled') return t('status.cancelled');
    return raw || '—';
  };

  const planRequestStatusBadge = (st: string) => {
    const v = st.toLowerCase();
    if (v === 'approved') return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    if (v === 'rejected') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200';
  };

  const packHeaderBadge = () => {
    if (packReq === 'pending') {
      return {
        cls: 'border-amber-400/60 bg-amber-500/15 text-amber-800 dark:text-amber-200',
        label: t('pack.badgeRequested'),
      };
    }
    if (packEnabled) {
      return {
        cls: 'border-[#0D9488]/50 bg-[#0D9488]/15 text-[#0D9488] dark:text-teal-300',
        label: t('pack.badgeActive'),
      };
    }
    return {
      cls: 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-300',
      label: t('pack.badgeInactive'),
    };
  };

  const cairoFont = { fontFamily: 'var(--font-cairo), Cairo, sans-serif' } as const;
  const numFont = { fontFamily: 'ui-sans-serif, system-ui, sans-serif' } as const;

  const renderInvoiceStatusBadge = (st: string) => {
    const base = 'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold';
    if (st === 'paid' || st === 'approved') {
      return (
        <span
          className={`${base} bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400`}
          style={cairoFont}
        >
          {t('status.paid')}
        </span>
      );
    }
    if (st === 'pending') {
      return (
        <span className={`${base} bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300`} style={cairoFont}>
          {t('status.pending')}
        </span>
      );
    }
    if (st === 'overdue') {
      return (
        <span className={`${base} bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300`} style={cairoFont}>
          {t('status.overdue')}
        </span>
      );
    }
    if (st === 'cancelled' || st === 'canceled') {
      return (
        <span className={`${base} bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400`} style={cairoFont}>
          {t('status.cancelled')}
        </span>
      );
    }
    return (
      <span className={`${base} bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300`} style={cairoFont}>
        {st || '—'}
      </span>
    );
  };

  const renderInvoiceActionCell = (inv: InvoiceRow, st: string) => {
    if (st === 'pending' || st === 'overdue') {
      return (
        <button
          type="button"
          disabled={!ownerOk || payingInvoiceId === inv.id}
          onClick={() => void handleInvoicePay(inv.id)}
          className="rounded-lg border-2 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          style={{ borderColor: '#0D9488', color: '#0D9488' }}
        >
          {payingInvoiceId === inv.id ? t('loadingShort') : t('history.payNow')}
        </button>
      );
    }
    if (st === 'paid' || st === 'approved') {
      return (
        <button
          type="button"
          disabled
          title={t('history.pdfComingSoon')}
          className="cursor-not-allowed rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-400 dark:border-slate-600"
        >
          {t('history.downloadPdf')}
        </button>
      );
    }
    if (st === 'cancelled' || st === 'canceled') {
      return <span className="text-slate-400">—</span>;
    }
    return <span className="text-slate-400">—</span>;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 pb-10 dark:bg-slate-950 md:p-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <div className="h-10 w-48 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
          <div className="h-56 animate-pulse rounded-2xl bg-gradient-to-br from-teal-200 to-slate-300 dark:from-teal-900/40 dark:to-slate-800" />
          <div className="h-48 animate-pulse rounded-2xl bg-white dark:bg-slate-800" />
          <div className="h-64 animate-pulse rounded-2xl bg-white dark:bg-slate-800" />
          <div className="h-48 animate-pulse rounded-2xl bg-white dark:bg-slate-800" />
        </div>
      </div>
    );
  }

  const badge = packHeaderBadge();

  return (
    <div
      className="min-h-screen bg-slate-50 p-4 pb-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:p-8"
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-xl font-bold md:text-2xl" style={cairoFont}>
            {t('page.title')}
          </h1>
          <Link
            href="/settings"
            className="text-sm font-medium hover:underline"
            style={{ color: '#0D9488' }}
          >
            {t('backToSettings')}
          </Link>
        </div>

        {error && (
          <div
            className="rounded-xl border border-red-500/40 bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200"
            role="alert"
          >
            {error}
          </div>
        )}

        {!ownerOk && (
          <div
            className="rounded-xl border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
            style={cairoFont}
          >
            {t('ownerOnly')}
          </div>
        )}

        {/* SECTION 1: CURRENT PLAN HERO */}
        <section
          className="rounded-2xl bg-gradient-to-br from-teal-600 to-slate-800 p-5 text-white shadow-lg dark:from-teal-800 dark:to-slate-900 md:p-6"
          aria-labelledby="billing-hero-heading"
        >
          <div className="flex flex-col gap-4 border-b border-white/15 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p id="billing-hero-heading" className="text-2xl font-bold leading-tight md:text-3xl" style={cairoFont}>
                  {t(`planNames.${planKey}` as 'billing.planNames.starter')}
                </p>
                <p className="mt-1 text-sm opacity-70" style={cairoFont}>
                  {secondaryPlanName}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="rounded-full px-3 py-1 text-xs font-semibold text-white"
                  style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
                >
                  {t('billingPeriod')}: {t(`period.${bp}` as 'billing.period.monthly')}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${billingStatusChip.cls}`}
                >
                  {billingStatusChip.icon ? <span aria-hidden>{billingStatusChip.icon}</span> : null}
                  {billingStatusChip.label}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 border-y border-white/10 md:grid-cols-3">
            <div className="flex flex-col gap-1 border-b border-white/15 py-4 md:border-b-0 md:border-e md:py-3 md:pe-4">
              <span className="text-xs font-medium uppercase tracking-wide text-teal-100/90" style={cairoFont}>
                {t('currentPlan.monthlyPrice')}
              </span>
              <span className="text-lg font-semibold tabular-nums text-white" style={numFont}>
                {formatNum(Number(center?.all_in_price ?? 0))} {t('egp')}
              </span>
            </div>
            <div className="flex flex-col gap-1 border-b border-white/15 py-4 md:border-b-0 md:border-e md:py-3 md:px-4">
              <span className="text-xs font-medium uppercase tracking-wide text-teal-100/90" style={cairoFont}>
                {t('currentPlan.nextPayment')}
              </span>
              <span className="text-lg font-semibold tabular-nums text-white" style={numFont}>
                {npdYmd ? new Date(`${npdYmd}T12:00:00`).toLocaleDateString('en-US') : '—'}
              </span>
            </div>
            <div className="flex flex-col gap-1 py-4 md:py-3 md:ps-4">
              <span className="text-xs font-medium uppercase tracking-wide text-teal-100/90" style={cairoFont}>
                {t('currentPlan.status')}
              </span>
              <span className="text-lg font-semibold text-white" style={cairoFont}>
                {invoiceStatusDisplay(center?.billing_status)}
              </span>
            </div>
          </div>

          {showSuspendBanner && (
            <div
              className="mt-4 flex flex-col gap-3 rounded-xl border border-red-400/50 bg-red-950/40 px-4 py-3 text-sm text-red-50 dark:bg-red-950/60"
              style={cairoFont}
            >
              <p className="flex items-start gap-2">
                <span aria-hidden>⚠️</span>
                <span>{t('currentPlan.overdue')}</span>
              </p>
              {ownerOk && (
                <button
                  type="button"
                  className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-sm md:w-auto"
                  style={{ backgroundColor: '#F59E0B' }}
                  onClick={() => toast.info(t('page.reactivateSoon'))}
                >
                  {t('currentPlan.reactivate')}
                </button>
              )}
            </div>
          )}

          {daysUntilDue != null && daysUntilDue > 0 && daysUntilDue <= 7 && !isOverdue && !showSuspendBanner && (
            <div
              className="mt-4 rounded-xl border border-amber-400/50 px-4 py-3 text-sm text-amber-50"
              style={{ backgroundColor: 'rgba(245, 158, 11, 0.2)' }}
            >
              <span aria-hidden>⚠️ </span>
              {t('currentPlan.dueSoon', { days: String(daysUntilDue) })}
            </div>
          )}
        </section>

        {/* SECTION 5: WA PACK */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white" style={cairoFont}>
              {t('pack.title')}
            </h2>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${badge.cls}`}>{badge.label}</span>
          </div>

          {packEnabled || packReq === 'approved' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <span className="text-sm text-slate-500 dark:text-slate-400" style={cairoFont}>
                  {t('pack.pricePerParent')}
                </span>
                <span className="tabular-nums font-semibold text-slate-900 dark:text-white" style={numFont}>
                  {formatNum(packPrice)} {t('egp')}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-slate-500 dark:text-slate-400" style={cairoFont}>
                  {t('pack.suggestedResale')}
                </span>
                <span className="tabular-nums font-semibold text-slate-900 dark:text-white" style={numFont}>
                  {t('pack.suggestedResalePerMonth', { amount: formatNum(SUGGESTED_RESALE_EGP) })}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-slate-500 dark:text-slate-400" style={cairoFont}>
                  {t('pack.yourProfit')}
                </span>
                <span className="tabular-nums font-semibold text-slate-900 dark:text-white" style={numFont}>
                  {formatNum(profitPerParent)} {t('egp')}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-slate-500 dark:text-slate-400" style={cairoFont}>
                  {t('pack.subscribedParents')}
                </span>
                <span className="tabular-nums font-semibold text-slate-900 dark:text-white" style={numFont}>
                  {formatNum(packParents)}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-slate-500 dark:text-slate-400" style={cairoFont}>
                  {t('pack.monthlyCost')}
                </span>
                <span className="tabular-nums font-semibold text-slate-900 dark:text-white" style={numFont}>
                  {formatNum(monthlyPackCost)} {t('egp')}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-slate-500 dark:text-slate-400" style={cairoFont}>
                  {t('pack.announcementBalance')}
                </span>
                <span className="tabular-nums font-semibold text-slate-900 dark:text-white" style={numFont}>
                  {formatNum(announcementBal)} {t('egp')}
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 dark:border-slate-600 dark:bg-slate-900/40">
              <p className="text-sm text-slate-600 dark:text-slate-300" style={cairoFont}>
                {t('pack.enableDescription')}
              </p>
              {packReq === 'pending' ? (
                <p className="mt-3 text-sm font-medium text-amber-700 dark:text-amber-300" style={cairoFont}>
                  {t('pack.pendingApproval')}
                </p>
              ) : (
                <button
                  type="button"
                  disabled={!ownerOk || packRequestLoading}
                  onClick={() => void handlePackRequest()}
                  className="mt-4 w-full rounded-xl border-2 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50 md:w-auto"
                  style={{ borderColor: '#0D9488', backgroundColor: '#0D9488' }}
                >
                  {packRequestLoading ? t('loadingShort') : t('pack.request')}
                </button>
              )}
            </div>
          )}
        </section>

        {/* SECTION 6: INVOICE HISTORY */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white" style={cairoFont}>
            {t('history.title')}
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400" style={cairoFont}>
            {t('history.subtitle')}
          </p>

          {filteredInvoices.length === 0 ? (
            <div className="mt-8 flex flex-col items-center justify-center py-10 text-center text-slate-500 dark:text-slate-400">
              <span className="mb-2 text-3xl" aria-hidden>
                📄
              </span>
              <p style={cairoFont}>{t('history.empty')}</p>
            </div>
          ) : (
            <>
              <div className="mt-4 space-y-3 md:hidden">
                {filteredInvoices.map((inv) => {
                  const st = (inv.status ?? '').toLowerCase();
                  const periodStr =
                    inv.billing_period_start && inv.billing_period_end
                      ? `${inv.billing_period_start} → ${inv.billing_period_end}`
                      : '—';
                  const ref = inv.invoice_number ?? inv.id.slice(0, 8);
                  return (
                    <div
                      key={inv.id}
                      className="rounded-xl border border-slate-200 p-4 dark:border-slate-600"
                    >
                      <div className="flex justify-between gap-2 text-sm">
                        <span className="text-slate-500">{t('history.date')}</span>
                        <span className="tabular-nums text-slate-900 dark:text-white" style={numFont}>
                          {inv.created_at ? new Date(inv.created_at).toLocaleDateString('en-US') : '—'}
                        </span>
                      </div>
                      <div className="mt-2 flex justify-between gap-2 text-sm">
                        <span className="text-slate-500">{t('history.reference')}</span>
                        <span className="font-mono text-slate-900 dark:text-white">{ref}</span>
                      </div>
                      <div className="mt-2 flex justify-between gap-2 text-sm">
                        <span className="text-slate-500">{t('history.amount')}</span>
                        <span className="tabular-nums" style={numFont}>
                          {formatNum(Number(inv.total_amount ?? 0))} {t('egp')}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">{periodStr}</div>
                      <div className="mt-2">{renderInvoiceStatusBadge(st)}</div>
                      <div className="mt-3">{renderInvoiceActionCell(inv, st)}</div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 hidden overflow-x-auto md:block">
                <table className="w-full min-w-[640px] border-collapse text-start text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-600 dark:text-slate-400">
                      <th className="py-2 pe-4 font-medium" style={cairoFont}>
                        {t('history.date')}
                      </th>
                      <th className="py-2 pe-4 font-medium" style={cairoFont}>
                        {t('history.reference')}
                      </th>
                      <th className="py-2 pe-4 font-medium" style={cairoFont}>
                        {t('history.amount')}
                      </th>
                      <th className="py-2 pe-4 font-medium" style={cairoFont}>
                        {t('history.period')}
                      </th>
                      <th className="py-2 pe-4 font-medium" style={cairoFont}>
                        {t('history.status')}
                      </th>
                      <th className="py-2 font-medium" style={cairoFont}>
                        {t('history.action')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInvoices.map((inv) => {
                      const st = (inv.status ?? '').toLowerCase();
                      const periodStr =
                        inv.billing_period_start && inv.billing_period_end
                          ? `${inv.billing_period_start} → ${inv.billing_period_end}`
                          : '—';
                      const ref = inv.invoice_number ?? inv.id.slice(0, 8);
                      return (
                        <tr key={inv.id} className="border-b border-slate-100 dark:border-slate-700/80">
                          <td className="py-3 pe-4 tabular-nums text-slate-900 dark:text-white" style={numFont}>
                            {inv.created_at ? new Date(inv.created_at).toLocaleDateString('en-US') : '—'}
                          </td>
                          <td className="py-3 pe-4 font-mono text-slate-800 dark:text-slate-200">{ref}</td>
                          <td className="py-3 pe-4 tabular-nums text-slate-900 dark:text-white" style={numFont}>
                            {formatNum(Number(inv.total_amount ?? 0))} {t('egp')}
                          </td>
                          <td className="py-3 pe-4 text-xs text-slate-500 dark:text-slate-400">{periodStr}</td>
                          <td className="py-3 pe-4">{renderInvoiceStatusBadge(st)}</td>
                          <td className="py-3">{renderInvoiceActionCell(inv, st)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {/* SECTION 7: PLAN CHANGE HISTORY */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white" style={cairoFont}>
            {t('planHistory.title')}
          </h2>
          {planRequests.length === 0 ? (
            <div className="mt-8 flex flex-col items-center py-10 text-center text-slate-500 dark:text-slate-400">
              <p style={cairoFont}>{t('planHistory.empty')}</p>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[480px] text-start text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-600 dark:text-slate-400">
                    <th className="py-2 pe-4 font-medium" style={cairoFont}>
                      {t('planHistory.date')}
                    </th>
                    <th className="py-2 pe-4 font-medium" style={cairoFont}>
                      {t('planHistory.from')}
                    </th>
                    <th className="py-2 pe-4 font-medium" style={cairoFont}>
                      {t('planHistory.to')}
                    </th>
                    <th className="py-2 font-medium" style={cairoFont}>
                      {t('planHistory.status')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {planRequests.map((req) => (
                    <tr key={req.id} className="border-b border-slate-100 dark:border-slate-700/80">
                      <td className="py-3 pe-4 tabular-nums text-slate-700 dark:text-slate-300" style={numFont}>
                        {req.requested_at ? new Date(req.requested_at).toLocaleDateString('en-US') : '—'}
                      </td>
                      <td className="py-3 pe-4 text-slate-900 dark:text-white">
                        {isPlanKey(req.current_plan)
                          ? t(`planNames.${req.current_plan}` as 'billing.planNames.starter')
                          : req.current_plan}
                      </td>
                      <td className="py-3 pe-4 text-slate-900 dark:text-white">
                        {isPlanKey(req.requested_plan)
                          ? t(`planNames.${req.requested_plan}` as 'billing.planNames.starter')
                          : req.requested_plan}
                      </td>
                      <td className="py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${planRequestStatusBadge(req.status)}`}
                        >
                          {req.status.toLowerCase() === 'approved'
                            ? t('planHistory.approved')
                            : req.status.toLowerCase() === 'rejected'
                              ? t('planHistory.rejected')
                              : t('planHistory.pending')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {paymobIframeUrl && (
        <PaymobModal
          iframeUrl={paymobIframeUrl}
          title={t('completePayment')}
          closeLabel={t('close')}
          onClose={() => {
            setPaymobIframeUrl(null);
            setPollInvoiceId(null);
          }}
        />
      )}
    </div>
  );
}
