'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import {
  getDailyRate,
  getReactivationAmount,
  getReactivationTier,
  getUpgradeCost,
  getUpgradeLimit,
} from '@/lib/billingEngine';
import {
  PLANS,
  getChargeFromQuarterlyAllIn,
  isPlanKey,
  normalizeBillingPeriod,
  type BillingPeriod,
  type PlanKey,
} from '@/lib/pricing';

const PLAN_RANK: Record<string, number> = {
  nano: 1,
  starter: 2,
  pro: 3,
  business: 4,
  enterprise: 5,
  top_centers: 6,
};

const PLAN_ARABIC: Record<string, string> = {
  nano: 'ناشئ',
  starter: 'أساسي',
  pro: 'محترف',
  business: 'أعمال',
  enterprise: 'مؤسسات',
  top_centers: 'كبار السناتر',
};

const PERIOD_DAYS: Record<string, number> = {
  monthly: 30,
  quarterly: 90,
  annual: 365,
};

const PLANS_LIST: PlanKey[] = ['nano', 'starter', 'pro', 'business', 'enterprise', 'top_centers'];

type CenterData = {
  plan?: string;
  subscription_billing_period?: string | null;
  billing_period?: string | null;
  next_payment_due?: string | null;
  billing_amount?: number | null;
  all_in_price?: number | null;
  billing_status?: string;
  subscription_status?: string;
  status?: string;
  credit_balance?: number | null;
  instapay_number?: string | null;
  upgrade_count_this_period?: number | null;
  suspended_at?: string | null;
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
  due_date?: string | null;
};

function formatNum(n: number | null | undefined): string {
  return (Number(n) || 0).toLocaleString('en-US');
}

function todayYmdLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isWithdrawalWindow(ymd: string): boolean {
  const [, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  return [1, 4, 7, 10].includes(m) && d >= 1 && d <= 14;
}

function nextQuarterFirstOnOrAfter(ymd: string): string {
  const [y0, m0, d0] = ymd.split('-').map((x) => parseInt(x, 10));
  for (let i = 0; i < 500; i++) {
    const dt = new Date(Date.UTC(y0, m0 - 1, d0 + i));
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    if ([1, 4, 7, 10].includes(m) && d === 1) {
      return `${y}-${String(m).padStart(2, '0')}-01`;
    }
  }
  return ymd;
}

function maskInstapay(s: string): string {
  const t = s.replace(/\D/g, '');
  if (t.length < 6) return '•••••';
  return `${t.slice(0, 3)}XXXXX${t.slice(-3)}`;
}

function planBadgeClass(plan: string): string {
  switch (plan) {
    case 'nano':
      return 'bg-slate-600';
    case 'starter':
      return 'bg-blue-700';
    case 'pro':
      return 'bg-teal-700';
    case 'business':
      return 'bg-purple-700';
    case 'enterprise':
      return 'bg-amber-700';
    case 'top_centers':
      return 'bg-rose-700';
    default:
      return 'bg-slate-600';
  }
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
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <span className="font-semibold text-slate-800" style={{ fontFamily: 'Georgia, serif' }}>
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-800"
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
  const toast = useToast();

  const [center, setCenter] = useState<CenterData | null>(null);
  const [userRole, setUserRole] = useState<string>('');
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [upgradeTab, setUpgradeTab] = useState<'upgrade' | 'downgrade'>('upgrade');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  const [selectedPlan, setSelectedPlan] = useState<string>('');
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [downgradeLoading, setDowngradeLoading] = useState(false);
  const [downgradeError, setDowngradeError] = useState<string | null>(null);

  const [showReactivationModal, setShowReactivationModal] = useState(false);
  const [paymobIframeUrl, setPaymobIframeUrl] = useState<string | null>(null);
  const [pollPaymobOrderId, setPollPaymobOrderId] = useState<string | null>(null);
  const [pollInvoiceId, setPollInvoiceId] = useState<string | null>(null);
  const [useCreditsForReactivation, setUseCreditsForReactivation] = useState(false);
  const [reactivationLoading, setReactivationLoading] = useState(false);
  const [reactivationError, setReactivationError] = useState<string | null>(null);

  const [withdrawalAmount, setWithdrawalAmount] = useState<number>(2000);
  const [withdrawalLoading, setWithdrawalLoading] = useState(false);
  const [withdrawalSuccess, setWithdrawalSuccess] = useState(false);
  const [withdrawalError, setWithdrawalError] = useState<string | null>(null);
  const [withdrawalDetail, setWithdrawalDetail] = useState<{
    cashAmount: number;
    instapay: string;
    processingDate: string;
  } | null>(null);

  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);
  const [invoicePayError, setInvoicePayError] = useState<string | null>(null);

  const historyRef = useCallback((el: HTMLElement | null) => {
    if (typeof window !== 'undefined' && el && window.location.hash === '#invoices') {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  const refreshData = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) return;
    const h = { Authorization: `Bearer ${session.access_token}` };
    const [meRes, invRes] = await Promise.all([
      fetch('/api/me', { headers: h }),
      fetch('/api/billing/invoices', { headers: h }),
    ]);
    const meJson = (await meRes.json()) as {
      user?: { role?: string; center?: CenterData | null };
      error?: string;
    };
    if (meJson.user?.center) {
      setCenter(meJson.user.center);
      setUserRole(String(meJson.user.role ?? ''));
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
          if (!cancelled) {
            setError(typeof j.error === 'string' ? j.error : t('loadError'));
          }
          return;
        }
        const meJson = (await meRes.json()) as {
          user?: { role?: string; center?: CenterData | null };
        };
        if (!cancelled) {
          setCenter(meJson.user?.center ?? null);
          setUserRole(String(meJson.user?.role ?? ''));
        }
        if (invRes.ok) {
          const invJson = (await invRes.json()) as { invoices?: InvoiceRow[] };
          if (!cancelled) setInvoices(invJson.invoices ?? []);
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
    if (!center) return;
    setSelectedPeriod((prev) => {
      if (prev) return prev;
      return normalizeBillingPeriod(center.subscription_billing_period ?? center.billing_period);
    });
  }, [center]);

  useEffect(() => {
    setSelectedPlan('');
    setUpgradeError(null);
    setDowngradeError(null);
  }, [upgradeTab]);

  useEffect(() => {
    if (!paymobIframeUrl || (!pollPaymobOrderId && !pollInvoiceId)) return;
    const tick = async () => {
      const q = pollPaymobOrderId
        ? `paymobOrderId=${encodeURIComponent(pollPaymobOrderId)}`
        : `invoiceId=${encodeURIComponent(pollInvoiceId!)}`;
      try {
        const r = await fetch(`/api/paymob/invoice-status?${q}`);
        const j = (await r.json()) as { paid?: boolean; failed?: boolean };
        if (j.paid) {
          setPaymobIframeUrl(null);
          setPollPaymobOrderId(null);
          setPollInvoiceId(null);
          toast.toast(t('paymentSuccess'), 'success');
          await refreshData();
        }
        if (j.failed) {
          setPaymobIframeUrl(null);
          setPollPaymobOrderId(null);
          setPollInvoiceId(null);
          toast.toast(t('paymentFailed'), 'error');
        }
      } catch {
        /* keep polling */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, [paymobIframeUrl, pollPaymobOrderId, pollInvoiceId, refreshData, t, toast]);

  const currentPlanKey = useMemo(() => {
    const p = center?.plan ?? 'starter';
    return isPlanKey(p) ? p : 'starter';
  }, [center?.plan]);

  const currentBp = useMemo(
    () => normalizeBillingPeriod(center?.subscription_billing_period ?? center?.billing_period) as BillingPeriod,
    [center?.subscription_billing_period, center?.billing_period],
  );

  const currentRank = PLAN_RANK[currentPlanKey] ?? 1;

  const currentAllIn = useMemo(() => {
    const raw = Number(center?.all_in_price ?? 0);
    if (raw > 0) return raw;
    return PLANS[currentPlanKey].quarterlyAllIn;
  }, [center?.all_in_price, currentPlanKey]);

  const npdYmd = center?.next_payment_due?.slice(0, 10) ?? '';

  const daysUntilDue = useMemo(() => {
    if (!npdYmd) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(`${npdYmd}T12:00:00`);
    due.setHours(0, 0, 0, 0);
    return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }, [npdYmd]);

  const upgradePreview = useMemo(() => {
    if (!center || !selectedPlan || !selectedPeriod || !npdYmd) return null;
    if (!isPlanKey(selectedPlan)) return null;
    const newBp = normalizeBillingPeriod(selectedPeriod) as BillingPeriod;
    const newAllIn = PLANS[selectedPlan].quarterlyAllIn;
    const currentPeriodPrice = getChargeFromQuarterlyAllIn(currentAllIn, newBp, currentPlanKey);
    const newPeriodPrice = getChargeFromQuarterlyAllIn(newAllIn, newBp, selectedPlan);
    const cost = getUpgradeCost({
      newPlanPrice: newPeriodPrice,
      currentPlanPrice: currentPeriodPrice,
      newBillingPeriod: newBp,
      nextPaymentDue: new Date(`${npdYmd}T12:00:00`),
    });
    const amountDue = Math.round(cost.amountDue * 100) / 100;
    const monthlyRate = getChargeFromQuarterlyAllIn(newAllIn, 'monthly', selectedPlan);
    return { ...cost, amountDue, monthlyRate, newBp };
  }, [center, selectedPlan, selectedPeriod, npdYmd, currentAllIn, currentPlanKey]);

  const downgradePreview = useMemo(() => {
    if (!center || !selectedPlan || !selectedPeriod || !npdYmd) return null;
    if (!isPlanKey(selectedPlan)) return null;
    const newBp = normalizeBillingPeriod(selectedPeriod) as BillingPeriod;
    const newAllIn = PLANS[selectedPlan].quarterlyAllIn;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(`${npdYmd}T12:00:00`);
    due.setHours(0, 0, 0, 0);
    const remainingDays = Math.max(0, Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
    const currentPeriodPrice = getChargeFromQuarterlyAllIn(currentAllIn, currentBp, currentPlanKey);
    const newPeriodPrice = getChargeFromQuarterlyAllIn(newAllIn, newBp, selectedPlan);
    const currentDailyRate = getDailyRate(currentPeriodPrice, currentBp);
    const newDailyRate = getDailyRate(newPeriodPrice, newBp);
    const creditAmount = Math.max(0, (currentDailyRate - newDailyRate) * remainingDays);
    const creditRounded = Math.round(creditAmount * 100) / 100;
    const bal = Number(center.credit_balance ?? 0);
    return {
      currentDailyRate,
      newDailyRate,
      remainingDays,
      creditRounded,
      newBalance: bal + creditRounded,
      currentBalance: bal,
      newBp,
    };
  }, [center, selectedPlan, selectedPeriod, npdYmd, currentAllIn, currentBp, currentPlanKey]);

  const reactivationCalc = useMemo(() => {
    if (!center?.suspended_at || !npdYmd) return null;
    const tier = getReactivationTier(new Date(center.suspended_at));
    const nextPeriodAmount = Number(center.billing_amount ?? 0);
    if (!Number.isFinite(nextPeriodAmount) || nextPeriodAmount <= 0) return null;
    const dailyRate = getDailyRate(nextPeriodAmount, currentBp);
    const calc = getReactivationAmount({ tier, nextPeriodAmount, dailyRate });
    return { tier, calc, nextPeriodAmount };
  }, [center?.suspended_at, center?.billing_amount, npdYmd, currentBp]);

  const creditBal = Number(center?.credit_balance ?? 0);
  const upgradeLimit = getUpgradeLimit(currentBp);
  const usedUpgrades = Number(center?.upgrade_count_this_period ?? 0);
  const isSuspended = center?.status === 'suspended';
  const isOverdue = (center?.billing_status ?? '') === 'overdue';
  const ownerOk = userRole === 'owner';

  const billingStatusLabel = (bs: string | undefined) => {
    const v = (bs ?? '').toLowerCase();
    if (v === 'active') return t('statusLabel.active');
    if (v === 'paid') return t('statusLabel.paid');
    if (v === 'due_soon') return t('statusLabel.due_soon');
    if (v === 'overdue') return t('statusLabel.overdue');
    if (v === 'suspended') return t('statusLabel.suspended');
    return t('statusLabel.active');
  };

  const invoiceStatusLabel = (st: string | undefined) => {
    const v = (st ?? '').toLowerCase();
    if (v === 'paid' || v === 'approved') return t('statusLabel.paid');
    if (v === 'pending') return t('statusLabel.pending');
    if (v === 'overdue') return t('statusLabel.overdue');
    if (v === 'cancelled') return t('statusLabel.cancelled');
    if (v === 'failed') return t('statusLabel.failed');
    return st || '—';
  };

  const monthlyDisplay = Number(center?.all_in_price ?? 0) || Math.round(Number(center?.billing_amount ?? 0) / 3) || 0;

  const handleUpgradePay = async () => {
    if (!ownerOk || !selectedPlan || !selectedPeriod) return;
    setUpgradeLoading(true);
    setUpgradeError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error(t('loadError'));
      const res = await fetch('/api/billing/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ newPlan: selectedPlan, newBillingPeriod: selectedPeriod }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUpgradeError(typeof j.error === 'string' ? j.error : t('paymentFailed'));
        return;
      }
      const url = j.paymobUrl as string | undefined;
      const oid = j.paymobOrderId as string | undefined;
      if (url && oid) {
        setPaymobIframeUrl(url);
        setPollPaymobOrderId(String(oid));
        setPollInvoiceId(null);
      }
    } catch (e) {
      setUpgradeError(e instanceof Error ? e.message : t('paymentFailed'));
    } finally {
      setUpgradeLoading(false);
    }
  };

  const handleDowngradeConfirm = async () => {
    if (!ownerOk || !selectedPlan || !selectedPeriod) return;
    setDowngradeLoading(true);
    setDowngradeError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error(t('loadError'));
      const res = await fetch('/api/billing/downgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ newPlan: selectedPlan, newBillingPeriod: selectedPeriod }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDowngradeError(typeof j.error === 'string' ? j.error : t('updateFailed'));
        return;
      }
      toast.toast(t('downgrade.success'), 'success');
      setSelectedPlan('');
      await refreshData();
    } catch (e) {
      setDowngradeError(e instanceof Error ? e.message : t('updateFailed'));
    } finally {
      setDowngradeLoading(false);
    }
  };

  const handleReactivationPay = async () => {
    if (!reactivationCalc || !ownerOk) return;
    setReactivationLoading(true);
    setReactivationError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error(t('loadError'));
      const total = reactivationCalc.calc.total;
      const cap = useCreditsForReactivation ? Math.min(creditBal, total) : 0;
      const res = await fetch('/api/billing/reactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          useCredits: useCreditsForReactivation && creditBal > 0,
          creditAmount: cap,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReactivationError(typeof j.error === 'string' ? j.error : t('paymentFailed'));
        return;
      }
      if (j.reactivated === true) {
        toast.toast(t('paymentSuccess'), 'success');
        setShowReactivationModal(false);
        await refreshData();
        return;
      }
      const url = j.paymobUrl as string | undefined;
      const oid = j.paymobOrderId as string | undefined;
      if (url && oid) {
        setShowReactivationModal(false);
        setPaymobIframeUrl(url);
        setPollPaymobOrderId(String(oid));
        setPollInvoiceId(null);
      }
    } catch (e) {
      setReactivationError(e instanceof Error ? e.message : t('paymentFailed'));
    } finally {
      setReactivationLoading(false);
    }
  };

  const handleWithdrawal = async () => {
    if (!ownerOk) return;
    setWithdrawalLoading(true);
    setWithdrawalError(null);
    setWithdrawalSuccess(false);
    setWithdrawalDetail(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error(t('loadError'));
      const res = await fetch('/api/billing/withdrawal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ creditAmount: withdrawalAmount }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWithdrawalError(typeof j.error === 'string' ? j.error : t('updateFailed'));
        return;
      }
      setWithdrawalSuccess(true);
      setWithdrawalDetail({
        cashAmount: Number(j.cashAmount),
        instapay: String(j.instapay ?? ''),
        processingDate: String(j.processingDate ?? ''),
      });
      toast.toast(t('withdrawal.success', { date: String(j.processingDate ?? '') }), 'success');
      await refreshData();
    } catch (e) {
      setWithdrawalError(e instanceof Error ? e.message : t('updateFailed'));
    } finally {
      setWithdrawalLoading(false);
    }
  };

  const handleInvoicePay = async (invoiceId: string) => {
    if (!ownerOk) return;
    setPayingInvoiceId(invoiceId);
    setInvoicePayError(null);
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
        setInvoicePayError(typeof j.error === 'string' ? j.error : t('paymentFailed'));
        return;
      }
      const iframeUrl = j.iframeUrl as string | undefined;
      const orderId = j.orderId as string | undefined;
      if (iframeUrl && orderId) {
        setPaymobIframeUrl(iframeUrl);
        setPollPaymobOrderId(String(orderId));
        setPollInvoiceId(invoiceId);
      }
    } catch (e) {
      setInvoicePayError(e instanceof Error ? e.message : t('paymentFailed'));
    } finally {
      setPayingInvoiceId(null);
    }
  };

  const closePaymob = () => {
    setPaymobIframeUrl(null);
    setPollPaymobOrderId(null);
    setPollInvoiceId(null);
  };

  const periodKeys: BillingPeriod[] = ['monthly', 'quarterly', 'annual'];

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 p-4 text-white md:p-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-2xl border border-slate-700 bg-slate-800 p-6"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 p-4 text-white md:p-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-xl font-bold text-white md:text-2xl" style={{ fontFamily: 'var(--font-cairo), Cairo, sans-serif' }}>
            {t('title')}
          </h1>
          <Link
            href="/settings"
            className="text-sm font-medium text-teal-400 hover:text-teal-300"
            style={{ fontFamily: 'var(--font-cairo), Cairo, sans-serif' }}
          >
            {t('backToSettings')}
          </Link>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>
        )}

        {!ownerOk && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
            {t('ownerOnly')}
          </div>
        )}

        {/* SECTION A */}
        <section className="rounded-2xl border border-slate-700 bg-slate-800 p-6">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-4 py-2 text-sm font-semibold text-white ${planBadgeClass(currentPlanKey)}`}
              style={{ fontFamily: 'var(--font-cairo), Cairo, sans-serif' }}
            >
              {t(`planNames.${currentPlanKey}`)} · {PLAN_ARABIC[currentPlanKey] ?? ''}
            </span>
            <span className="rounded-full bg-slate-700 px-3 py-1 text-xs font-medium text-slate-200">
              {t('billingPeriod')}: {t(`period.${currentBp}` as Parameters<typeof t>[0])}
            </span>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{t('monthlyPrice')}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-white" style={{ fontFamily: 'Georgia, serif' }}>
                {formatNum(monthlyDisplay)} {t('egp')}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{t('nextPaymentDue')}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-white" style={{ fontFamily: 'Georgia, serif' }}>
                {npdYmd
                  ? new Date(`${npdYmd}T12:00:00`).toLocaleDateString('en-GB')
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{t('billingStatus')}</p>
              <div className="mt-1">
                {(() => {
                  const bs = (center?.billing_status ?? 'active').toLowerCase();
                  const cls =
                    bs === 'paid' || bs === 'active'
                      ? 'bg-green-500/20 text-green-300 border-green-500/40'
                      : bs === 'due_soon'
                        ? 'bg-amber-500/20 text-amber-200 border-amber-500/40'
                        : bs === 'overdue' || bs === 'suspended'
                          ? 'bg-red-500/20 text-red-200 border-red-500/40'
                          : 'bg-slate-600/40 text-slate-200 border-slate-500/40';
                  return (
                    <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}>
                      {(bs === 'suspended' || isSuspended) && <span aria-hidden>⏸</span>}
                      {billingStatusLabel(center?.billing_status)}
                    </span>
                  );
                })()}
              </div>
            </div>
          </div>

          {(isSuspended || isOverdue) && (
            <div className="mt-4 rounded-xl border border-red-500/50 bg-red-950/40 px-4 py-3 text-sm text-red-100">
              <p style={{ fontFamily: 'var(--font-cairo), Cairo, sans-serif' }}>{t('suspended.warning')}</p>
              {isSuspended && ownerOk && (
                <button
                  type="button"
                  onClick={() => {
                    setReactivationError(null);
                    setShowReactivationModal(true);
                  }}
                  className="mt-3 w-full rounded-xl bg-[#0D9488] px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-600 sm:w-auto"
                >
                  {t('reactivateNow')}
                </button>
              )}
              {!isSuspended && isOverdue && ownerOk && (
                <button
                  type="button"
                  onClick={() => document.getElementById('billing-history')?.scrollIntoView({ behavior: 'smooth' })}
                  className="mt-3 w-full rounded-xl bg-[#0D9488] px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-600 sm:w-auto"
                >
                  {t('payNow')}
                </button>
              )}
            </div>
          )}

          {daysUntilDue != null && daysUntilDue > 0 && daysUntilDue <= 7 && !isSuspended && (
            <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
              {t('dueSoon', { days: String(daysUntilDue) })}
            </div>
          )}
        </section>

        {/* SECTION B */}
        <section className="rounded-2xl border border-slate-700 bg-slate-800 p-6">
          <div className="flex gap-6 border-b border-slate-600">
            <button
              type="button"
              onClick={() => setUpgradeTab('upgrade')}
              className={`relative pb-3 text-sm font-semibold ${
                upgradeTab === 'upgrade' ? 'text-[#0D9488]' : 'text-slate-400'
              }`}
            >
              {t('upgrade.title')}
              {upgradeTab === 'upgrade' && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[#0D9488]" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setUpgradeTab('downgrade')}
              className={`relative pb-3 text-sm font-semibold ${
                upgradeTab === 'downgrade' ? 'text-[#0D9488]' : 'text-slate-400'
              }`}
            >
              {t('downgrade.title')}
              {upgradeTab === 'downgrade' && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[#0D9488]" />
              )}
            </button>
          </div>

          {upgradeTab === 'upgrade' && (
            <div className="mt-6 space-y-6">
              <div>
                <p className="text-sm text-slate-300">
                  {t('upgrade.usedOf', { used: String(usedUpgrades), limit: String(upgradeLimit) })}
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-700">
                  <div
                    className="h-full bg-[#0D9488] transition-all"
                    style={{ width: `${Math.min(100, (usedUpgrades / upgradeLimit) * 100)}%` }}
                  />
                </div>
                {usedUpgrades >= upgradeLimit && npdYmd && (
                  <p className="mt-2 text-sm text-amber-300">
                    {t('upgrade.limitReached', {
                      date: new Date(`${npdYmd}T12:00:00`).toLocaleDateString('en-GB'),
                    })}
                  </p>
                )}
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold text-white">{t('upgrade.choosePeriod')}</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {periodKeys.map((pk) => {
                    const active = normalizeBillingPeriod(selectedPeriod) === pk;
                    const isCurrent = currentBp === pk;
                    return (
                      <button
                        key={pk}
                        type="button"
                        disabled={!ownerOk}
                        onClick={() => setSelectedPeriod(pk)}
                        className={`rounded-xl border p-4 text-start transition-colors ${
                          active ? 'border-[#0D9488] bg-teal-900/20' : 'border-slate-600 bg-slate-900/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-white">{t(`period.${pk}` as Parameters<typeof t>[0])}</span>
                          {isCurrent && (
                            <span className="rounded-full bg-slate-600 px-2 py-0.5 text-[10px] font-medium text-white">
                              {t('upgrade.currentPeriod')}
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-xs text-slate-400">
                          {pk === 'monthly'
                            ? t('upgrade.monthlyPremiumHint')
                            : pk === 'annual'
                              ? t('upgrade.annualSaveHint')
                              : t('upgrade.quarterlyDefaultHint')}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold text-white">{t('upgrade.choosePlan')}</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {PLANS_LIST.filter((pk) => pk !== 'top_centers').map((pk) => {
                    const rank = PLAN_RANK[pk] ?? 0;
                    if (rank <= currentRank) return null;
                    const bpSel = normalizeBillingPeriod(selectedPeriod) as BillingPeriod;
                    const allIn = PLANS[pk].quarterlyAllIn;
                    const periodPrice = getChargeFromQuarterlyAllIn(allIn, bpSel, pk);
                    const monthlyEq = Math.round((periodPrice / PERIOD_DAYS[bpSel]) * 30);
                    const limit = PLANS[pk].weeklyStudentLimit;
                    return (
                      <button
                        key={pk}
                        type="button"
                        disabled={!ownerOk}
                        onClick={() => setSelectedPlan(pk)}
                        className={`relative rounded-xl border p-4 text-start ${
                          selectedPlan === pk ? 'border-[#0D9488] bg-teal-900/10' : 'border-slate-600 bg-slate-900/40'
                        }`}
                      >
                        {pk === 'pro' && (
                          <span className="absolute end-3 top-3 rounded-full bg-[#F59E0B] px-2 py-0.5 text-[10px] font-bold text-slate-900">
                            {t('upgrade.mostPopular')}
                          </span>
                        )}
                        <p className="font-semibold text-white">
                          {t(`planNames.${pk}`)} · {PLAN_ARABIC[pk]}
                        </p>
                        <p className="mt-1 tabular-nums text-slate-300" style={{ fontFamily: 'Georgia, serif' }}>
                          ~{formatNum(monthlyEq)} {t('egp')}/mo
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {limit == null ? t('unlimitedStudents') : t('studentsLimit', { limit: formatNum(limit) })}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {upgradePreview && upgradePreview.amountDue > 0 && selectedPlan && (
                <div className="rounded-xl border border-slate-600 bg-slate-900/50 p-4">
                  <h4 className="font-semibold text-white">{t('upgrade.summary')}</h4>
                  <ul className="mt-3 space-y-2 text-sm text-slate-300">
                    <li className="flex justify-between gap-4">
                      <span>{t('upgrade.newPlan')}</span>
                      <span className="tabular-nums text-white" style={{ fontFamily: 'Georgia, serif' }}>
                        {t(`planNames.${selectedPlan}`)}
                      </span>
                    </li>
                    <li className="flex justify-between gap-4">
                      <span>{t('upgrade.newPeriod')}</span>
                      <span>{t(`period.${upgradePreview.newBp}` as Parameters<typeof t>[0])}</span>
                    </li>
                    <li className="flex justify-between gap-4">
                      <span>{t('upgrade.daysRemaining')}</span>
                      <span className="tabular-nums" style={{ fontFamily: 'Georgia, serif' }}>
                        {formatNum(upgradePreview.daysRemaining)}
                      </span>
                    </li>
                    <li className="flex justify-between gap-4">
                      <span>{t('upgrade.dailyRateDiff')}</span>
                      <span className="tabular-nums" style={{ fontFamily: 'Georgia, serif' }}>
                        {formatNum(Math.round(upgradePreview.dailyRateDifference * 100) / 100)} {t('egp')}
                      </span>
                    </li>
                  </ul>
                  <hr className="my-3 border-slate-600" />
                  <p className="flex justify-between text-sm font-semibold text-white">
                    <span>{t('upgrade.amountDue')}</span>
                    <span className="tabular-nums text-[#0D9488]" style={{ fontFamily: 'Georgia, serif' }}>
                      {formatNum(upgradePreview.amountDue)} {t('egp')}
                    </span>
                  </p>
                  <p className="mt-2 flex justify-between text-xs text-slate-400">
                    <span>{t('upgrade.nextRenewal')}</span>
                    <span className="tabular-nums" style={{ fontFamily: 'Georgia, serif' }}>
                      {npdYmd ? new Date(`${npdYmd}T12:00:00`).toLocaleDateString('en-GB') : '—'}
                    </span>
                  </p>
                  <p className="mt-1 flex justify-between text-xs text-slate-400">
                    <span>{t('upgrade.newMonthlyRate')}</span>
                    <span className="tabular-nums" style={{ fontFamily: 'Georgia, serif' }}>
                      {formatNum(upgradePreview.monthlyRate)} {t('egp')}/mo
                    </span>
                  </p>
                  {upgradeError && <p className="mt-2 text-sm text-red-300">{upgradeError}</p>}
                  <button
                    type="button"
                    disabled={!ownerOk || upgradeLoading || usedUpgrades >= upgradeLimit}
                    onClick={handleUpgradePay}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0D9488] px-4 py-3 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
                  >
                    {upgradeLoading && (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    )}
                    {t('upgrade.proceed')}
                  </button>
                </div>
              )}
            </div>
          )}

          {upgradeTab === 'downgrade' && (
            <div className="mt-6 space-y-6">
              <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
                {t('downgrade.notice')}
              </div>
              <div>
                <h3 className="mb-3 text-sm font-semibold text-white">{t('upgrade.choosePlan')}</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {PLANS_LIST.filter((pk) => pk !== 'top_centers').map((pk) => {
                    const rank = PLAN_RANK[pk] ?? 0;
                    if (rank >= currentRank) return null;
                    const bpSel = normalizeBillingPeriod(selectedPeriod || currentBp) as BillingPeriod;
                    const allIn = PLANS[pk].quarterlyAllIn;
                    const periodPrice = getChargeFromQuarterlyAllIn(allIn, bpSel, pk);
                    const limit = PLANS[pk].weeklyStudentLimit;
                    return (
                      <button
                        key={pk}
                        type="button"
                        disabled={!ownerOk}
                        onClick={() => setSelectedPlan(pk)}
                        className={`rounded-xl border p-4 text-start ${
                          selectedPlan === pk ? 'border-[#0D9488] bg-teal-900/10' : 'border-slate-600 bg-slate-900/40'
                        }`}
                      >
                        <p className="font-semibold text-white">
                          {t(`planNames.${pk}`)} · {PLAN_ARABIC[pk]}
                        </p>
                        <p className="mt-1 tabular-nums text-slate-300" style={{ fontFamily: 'Georgia, serif' }}>
                          {formatNum(periodPrice)} {t('egp')}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {limit == null ? t('unlimitedStudents') : t('studentsLimit', { limit: formatNum(limit) })}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-semibold text-white">{t('upgrade.choosePeriod')}</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {periodKeys.map((pk) => {
                    const active = normalizeBillingPeriod(selectedPeriod) === pk;
                    const isCurrent = currentBp === pk;
                    return (
                      <button
                        key={pk}
                        type="button"
                        disabled={!ownerOk}
                        onClick={() => setSelectedPeriod(pk)}
                        className={`rounded-xl border p-4 text-start ${
                          active ? 'border-[#0D9488] bg-teal-900/20' : 'border-slate-600 bg-slate-900/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{t(`period.${pk}` as Parameters<typeof t>[0])}</span>
                          {isCurrent && (
                            <span className="rounded-full bg-slate-600 px-2 py-0.5 text-[10px] font-medium">
                              {t('upgrade.currentPeriod')}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              {downgradePreview && selectedPlan && (
                <div className="rounded-xl border border-slate-600 bg-slate-900/50 p-4">
                  <h4 className="font-semibold text-white">{t('downgrade.summary')}</h4>
                  <ul className="mt-3 space-y-2 text-sm text-slate-300">
                    <li className="flex justify-between">
                      <span>{t('downgrade.currentDaily')}</span>
                      <span className="tabular-nums" style={{ fontFamily: 'Georgia, serif' }}>
                        {formatNum(Math.round(downgradePreview.currentDailyRate * 100) / 100)} {t('egp')}
                      </span>
                    </li>
                    <li className="flex justify-between">
                      <span>{t('downgrade.newDaily')}</span>
                      <span className="tabular-nums" style={{ fontFamily: 'Georgia, serif' }}>
                        {formatNum(Math.round(downgradePreview.newDailyRate * 100) / 100)} {t('egp')}
                      </span>
                    </li>
                    <li className="flex justify-between">
                      <span>{t('upgrade.daysRemaining')}</span>
                      <span className="tabular-nums" style={{ fontFamily: 'Georgia, serif' }}>
                        {formatNum(downgradePreview.remainingDays)}
                      </span>
                    </li>
                  </ul>
                  <hr className="my-3 border-slate-600" />
                  <p className="flex justify-between text-sm">
                    <span>{t('downgrade.creditsEarned')}</span>
                    <span className="tabular-nums font-semibold text-[#F59E0B]" style={{ fontFamily: 'Georgia, serif' }}>
                      {formatNum(downgradePreview.creditRounded)}
                    </span>
                  </p>
                  <p className="mt-2 flex justify-between text-xs text-slate-400">
                    <span>{t('downgrade.currentBalance')}</span>
                    <span className="tabular-nums" style={{ fontFamily: 'Georgia, serif' }}>
                      {formatNum(downgradePreview.currentBalance)}
                    </span>
                  </p>
                  <p className="mt-1 flex justify-between text-xs text-slate-400">
                    <span>{t('downgrade.newBalance')}</span>
                    <span className="tabular-nums" style={{ fontFamily: 'Georgia, serif' }}>
                      {formatNum(downgradePreview.newBalance)}
                    </span>
                  </p>
                  {downgradeError && <p className="mt-2 text-sm text-red-300">{downgradeError}</p>}
                  <button
                    type="button"
                    disabled={!ownerOk || downgradeLoading}
                    onClick={handleDowngradeConfirm}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#F59E0B] bg-amber-500/10 px-4 py-3 text-sm font-semibold text-[#F59E0B] hover:bg-amber-500/20 disabled:opacity-50"
                  >
                    {downgradeLoading && (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                    )}
                    {t('downgrade.confirm')}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* SECTION C */}
        <section className="rounded-2xl border border-slate-700 bg-slate-800 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">{t('credits.title')}</h2>
            <span className="rounded-full bg-slate-700 px-3 py-1 text-sm tabular-nums text-teal-300" style={{ fontFamily: 'Georgia, serif' }}>
              {formatNum(creditBal)}
            </span>
          </div>
          <p className="mt-4 text-3xl font-bold tabular-nums text-white" style={{ fontFamily: 'Georgia, serif' }}>
            {formatNum(creditBal)}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {t('credits.equivalent', { amount: formatNum(creditBal / 2) })}
          </p>
          {creditBal > 0 && (
            <p className="mt-3 text-xs text-slate-500">{t('credits.expiryNote')}</p>
          )}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              className="flex-1 rounded-xl border-2 border-[#F59E0B] px-4 py-2.5 text-sm font-semibold text-[#F59E0B] hover:bg-amber-500/10"
            >
              {t('credits.applyToInvoice')}
            </button>
            <button
              type="button"
              onClick={() => document.getElementById('withdrawal-section')?.scrollIntoView({ behavior: 'smooth' })}
              className="flex-1 rounded-xl border border-slate-500 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700/50"
            >
              {t('credits.requestWithdrawal')}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">{t('credits.applyNote')}</p>
        </section>

        {/* SECTION D */}
        <section id="withdrawal-section" className="rounded-2xl border border-slate-700 bg-slate-800 p-6">
          <h2 className="text-lg font-semibold text-white">{t('withdrawal.title')}</h2>
          {creditBal < 2000 ? (
            <p className="mt-3 text-sm text-slate-400">
              {t('withdrawal.minBalanceNote', { amount: formatNum(creditBal) })}
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-slate-600 bg-slate-900/50 p-4">
                <p className="font-medium text-white">{t('withdrawal.rate')}</p>
                <p className="mt-1 text-sm text-slate-400">{t('withdrawal.fee')}</p>
              </div>
              <div>
                {center?.instapay_number?.trim() ? (
                  <p className="text-sm text-slate-300">
                    <span className="text-slate-500">{t('instaPayNumber')}: </span>
                    <span className="tabular-nums font-mono" style={{ fontFamily: 'Georgia, serif' }}>
                      {maskInstapay(center.instapay_number)}
                    </span>
                  </p>
                ) : (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
                    <p>{t('withdrawal.noInstapay')}</p>
                    <Link href="/settings" className="mt-2 inline-block text-[#0D9488] hover:underline">
                      {t('withdrawal.settingsLink')}
                    </Link>
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-500">{t('withdrawal.quarterlyNote')}</p>
              {!isWithdrawalWindow(todayYmdLocal()) && (
                <p className="text-sm text-amber-200">
                  {t('withdrawal.nextWindow', {
                    date: new Date(`${nextQuarterFirstOnOrAfter(todayYmdLocal())}T12:00:00`).toLocaleDateString('en-GB'),
                  })}
                </p>
              )}
              <label className="block text-sm font-medium text-slate-300">{t('withdrawal.amountLabel')}</label>
              <input
                type="number"
                min={2000}
                step={100}
                value={withdrawalAmount}
                onChange={(e) => setWithdrawalAmount(Number(e.target.value) || 0)}
                className="mt-1 w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-2.5 text-white tabular-nums"
                style={{ fontFamily: 'Georgia, serif' }}
              />
              <p className="text-sm text-slate-400">
                {t('withdrawal.youReceive', { amount: formatNum(withdrawalAmount / 2) })}
              </p>
              <p className="text-sm text-slate-400">
                {t('withdrawal.platformFee', { amount: formatNum(withdrawalAmount / 2) })}
              </p>
              {withdrawalError && <p className="text-sm text-red-300">{withdrawalError}</p>}
              {withdrawalSuccess && withdrawalDetail && (
                <div className="rounded-xl border border-green-500/40 bg-green-950/30 px-4 py-3 text-sm text-green-100">
                  <p>{t('withdrawal.success', { date: withdrawalDetail.processingDate })}</p>
                  <p className="mt-1">
                    {t('withdrawal.successDetail', {
                      amount: formatNum(withdrawalDetail.cashAmount),
                      instapay: maskInstapay(withdrawalDetail.instapay),
                    })}
                  </p>
                </div>
              )}
              <button
                type="button"
                disabled={!ownerOk || withdrawalLoading || creditBal < 2000}
                onClick={handleWithdrawal}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0D9488] px-4 py-3 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
              >
                {withdrawalLoading && (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                )}
                {t('withdrawal.submit')}
              </button>
            </div>
          )}
        </section>

        {/* SECTION E */}
        <section id="billing-history" ref={historyRef} className="rounded-2xl border border-slate-700 bg-slate-800 p-6">
          <h2 className="text-lg font-semibold text-white">{t('history.title')}</h2>
          {invoicePayError && <p className="mt-2 text-sm text-red-300">{invoicePayError}</p>}
          {invoices.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">{t('history.noInvoices')}</p>
          ) : (
            <div className="mt-4 space-y-3 md:hidden">
              {invoices.slice(0, 10).map((inv) => (
                <div key={inv.id} className="rounded-xl border border-slate-600 bg-slate-900/40 p-4 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400">{t('history.invoice')}</span>
                    <span className="tabular-nums text-white" style={{ fontFamily: 'Georgia, serif' }}>
                      {inv.invoice_number ?? inv.id.slice(0, 8)}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between">
                    <span className="text-slate-400">{t('history.amount')}</span>
                    <span className="tabular-nums" style={{ fontFamily: 'Georgia, serif' }}>
                      {formatNum(Number(inv.total_amount ?? 0))} {t('egp')}
                    </span>
                  </div>
                  <div className="mt-2">
                    {(() => {
                      const st = (inv.status ?? '').toLowerCase();
                      const pay = st === 'pending' || st === 'overdue';
                      return pay && ownerOk ? (
                        <button
                          type="button"
                          disabled={payingInvoiceId === inv.id}
                          onClick={() => handleInvoicePay(inv.id)}
                          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#0D9488] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {payingInvoiceId === inv.id && (
                            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          )}
                          {t('payNow')}
                        </button>
                      ) : null;
                    })()}
                  </div>
                </div>
              ))}
            </div>
          )}
          {invoices.length > 0 && (
            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="w-full text-start text-sm">
                <thead>
                  <tr className="border-b border-slate-600 text-slate-400">
                    <th className="py-2 pe-4 font-medium">{t('history.invoice')}</th>
                    <th className="py-2 pe-4 font-medium">{t('history.type')}</th>
                    <th className="py-2 pe-4 font-medium">{t('history.amount')}</th>
                    <th className="py-2 pe-4 font-medium">{t('history.period')}</th>
                    <th className="py-2 pe-4 font-medium">{t('history.status')}</th>
                    <th className="py-2 pe-4 font-medium">{t('history.date')}</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {invoices.slice(0, 10).map((inv) => {
                    const it = (inv.invoice_type ?? 'other') as string;
                    const knownTypes = [
                      'subscription',
                      'pack_billing',
                      'plan_upgrade_difference',
                      'announcement_settlement',
                      'base_subscription',
                      'whatsapp_addon',
                      'setup_fee',
                      'payment_proof',
                      'announcement_cap',
                    ] as const;
                    const typeLabel = knownTypes.includes(it as (typeof knownTypes)[number])
                      ? t(`invoiceType.${it}` as 'invoiceType.subscription')
                      : t('invoiceType.other');
                    const st = (inv.status ?? '').toLowerCase();
                    const stCls =
                      st === 'paid' || st === 'approved'
                        ? 'bg-green-500/20 text-green-300'
                        : st === 'pending'
                          ? 'bg-amber-500/20 text-amber-200'
                          : st === 'overdue'
                            ? 'bg-red-500/20 text-red-200'
                            : 'bg-slate-600/30 text-slate-300';
                    const periodStr =
                      inv.billing_period_start && inv.billing_period_end
                        ? `${inv.billing_period_start} → ${inv.billing_period_end}`
                        : '—';
                    const dateStr = inv.created_at
                      ? new Date(inv.created_at).toLocaleDateString('en-GB')
                      : '—';
                    return (
                      <tr key={inv.id} className="border-b border-slate-700/80">
                        <td className="py-3 pe-4 tabular-nums" style={{ fontFamily: 'Georgia, serif' }}>
                          {inv.invoice_number ?? inv.id.slice(0, 8)}
                        </td>
                        <td className="py-3 pe-4">{typeLabel}</td>
                        <td className="py-3 pe-4 tabular-nums" style={{ fontFamily: 'Georgia, serif' }}>
                          {formatNum(Number(inv.total_amount ?? 0))} {t('egp')}
                        </td>
                        <td className="py-3 pe-4 text-xs text-slate-400">{periodStr}</td>
                        <td className="py-3 pe-4">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stCls}`}>
                            {invoiceStatusLabel(inv.status ?? undefined)}
                          </span>
                        </td>
                        <td className="py-3 pe-4 tabular-nums" style={{ fontFamily: 'Georgia, serif' }}>
                          {dateStr}
                        </td>
                        <td className="py-3">
                          {(st === 'pending' || st === 'overdue') && ownerOk && (
                            <button
                              type="button"
                              disabled={payingInvoiceId === inv.id}
                              onClick={() => handleInvoicePay(inv.id)}
                              className="flex items-center gap-2 rounded-lg bg-[#0D9488] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                            >
                              {payingInvoiceId === inv.id && (
                                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                              )}
                              {t('payNow')}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
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
          onClose={closePaymob}
        />
      )}

      {showReactivationModal && reactivationCalc && center?.suspended_at && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-600 bg-slate-800 p-6 text-white shadow-xl">
            <h2 className="text-lg font-bold">{t('reactivation.title')}</h2>
            <p className="mt-1 text-sm text-slate-400">
              {t('reactivation.suspendedSince', {
                date: new Date(center.suspended_at).toLocaleDateString('en-GB'),
              })}
            </p>
            <div className="mt-4">
              {reactivationCalc.tier === 'tier1' ? (
                <span className="inline-block rounded-full bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-200">
                  {t('reactivation.tier1Badge')}
                </span>
              ) : (
                <span className="inline-block rounded-full bg-slate-600 px-3 py-1 text-xs font-semibold text-slate-200">
                  {t('reactivation.tier2Badge')}
                </span>
              )}
            </div>
            <div className="mt-4 rounded-xl border border-slate-600 bg-slate-900/50 p-4 text-sm">
              {reactivationCalc.tier === 'tier1' ? (
                <>
                  <div className="flex justify-between">
                    <span>{t('reactivation.tier1')}</span>
                    <span className="tabular-nums" style={{ fontFamily: 'Georgia, serif' }}>
                      {formatNum(reactivationCalc.calc.fine)} {t('egp')}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between">
                    <span>
                      {t('reactivation.nextPeriod')} ({t(`planNames.${currentPlanKey}`)} ·{' '}
                      {t(`period.${currentBp}` as Parameters<typeof t>[0])})
                    </span>
                    <span className="tabular-nums" style={{ fontFamily: 'Georgia, serif' }}>
                      {formatNum(reactivationCalc.calc.nextPeriod)} {t('egp')}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span>{t('reactivation.tier2')}</span>
                    <span className="tabular-nums" style={{ fontFamily: 'Georgia, serif' }}>
                      {formatNum(reactivationCalc.calc.reactivationFee)} {t('egp')}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between">
                    <span>
                      {t('reactivation.nextPeriod')} ({t(`planNames.${currentPlanKey}`)} ·{' '}
                      {t(`period.${currentBp}` as Parameters<typeof t>[0])})
                    </span>
                    <span className="tabular-nums" style={{ fontFamily: 'Georgia, serif' }}>
                      {formatNum(reactivationCalc.calc.nextPeriod)} {t('egp')}
                    </span>
                  </div>
                </>
              )}
              <hr className="my-3 border-slate-600" />
              <div className="flex justify-between font-semibold">
                <span>{t('reactivation.total')}</span>
                <span className="tabular-nums text-[#0D9488]" style={{ fontFamily: 'Georgia, serif' }}>
                  {formatNum(reactivationCalc.calc.total)} {t('egp')}
                </span>
              </div>
            </div>
            {creditBal > 0 && (
              <div className="mt-4 rounded-xl border border-slate-600 bg-slate-900/30 p-4">
                <label className="flex cursor-pointer items-center justify-between gap-3">
                  <span className="text-sm text-slate-200">
                    {t('reactivation.useCredits', { amount: formatNum(creditBal) })}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={useCreditsForReactivation}
                    onClick={() => setUseCreditsForReactivation((v) => !v)}
                    className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors ${
                      useCreditsForReactivation ? 'bg-[#0D9488]' : 'bg-slate-600'
                    }`}
                  >
                    <span
                      className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${
                        useCreditsForReactivation ? 'end-1' : 'start-1'
                      }`}
                    />
                  </button>
                </label>
                {useCreditsForReactivation && (
                  <div className="mt-3 space-y-1 text-xs text-slate-400">
                    <p className="flex justify-between">
                      <span>{t('reactivation.creditsApplied')}</span>
                      <span className="tabular-nums" style={{ fontFamily: 'Georgia, serif' }}>
                        −{formatNum(Math.min(creditBal, reactivationCalc.calc.total))} {t('egp')}
                      </span>
                    </p>
                    <p className="flex justify-between">
                      <span>{t('reactivation.remainingViaPay')}</span>
                      <span className="tabular-nums" style={{ fontFamily: 'Georgia, serif' }}>
                        {formatNum(Math.max(0, reactivationCalc.calc.total - Math.min(creditBal, reactivationCalc.calc.total)))}{' '}
                        {t('egp')}
                      </span>
                    </p>
                  </div>
                )}
              </div>
            )}
            {reactivationError && <p className="mt-2 text-sm text-red-300">{reactivationError}</p>}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => setShowReactivationModal(false)}
                className="flex-1 rounded-xl border border-slate-500 py-2.5 text-sm font-medium text-slate-200"
              >
                {t('close')}
              </button>
              <button
                type="button"
                disabled={!ownerOk || reactivationLoading}
                onClick={handleReactivationPay}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#0D9488] py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {reactivationLoading && (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                )}
                {t('reactivation.proceed')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
