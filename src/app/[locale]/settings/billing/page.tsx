'use client';

import { getCsrfHeaders } from '@/lib/csrf-client';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/ToastProvider';
import {
  normalizeBillingPeriod,
  PLANS,
  isPlanKey,
  getChargeFromQuarterlyAllIn,
  type PlanKey,
  type BillingPeriod,
} from '@/lib/pricing';
import { isFeatureEnabled } from '@/lib/features';
import {
  getUpgradeCost,
  getDailyRate,
  getUpgradeLimit,
  getReactivationTier,
  getReactivationAmount,
} from '@/lib/billingEngine';
import {
  getTodayCairo,
  isWithdrawalWindowOpen,
  nextQuarterFirstOnOrAfter,
  nextProcessingQuarterStart,
} from '@/lib/cairoBillingCalendar';
import {
  formatCurrency,
  formatDate as formatDateLocale,
  formatNumber,
} from '@/lib/formatNumber';
import { ProcessingFeeInfoButton } from '@/components/billing/ProcessingFeeInfo';

const SUGGESTED_RESALE_EGP = 25;

/** The processing fee snapshotted on an invoice (Section 5), 0 when none. */
function invoiceProcessingFee(inv: { metadata?: { processing_fee?: number | string | null } | null }): number {
  const raw = inv.metadata?.processing_fee;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const CANCEL_REASON_KEYS = [
  'moving_competitor',
  'too_expensive',
  'center_closing',
  'not_using',
  'other',
] as const;

type CenterPlanKey = 'solo' | 'nano' | 'starter' | 'pro' | 'business' | 'enterprise';

const CENTER_PLAN_KEYS: readonly CenterPlanKey[] = [
  'solo',
  'nano',
  'starter',
  'pro',
  'business',
  'enterprise',
];

/** Rank within center-facing plans only; unknown/custom plans sort after enterprise. */
function planRank(plan: string): number {
  const i = CENTER_PLAN_KEYS.indexOf(plan as CenterPlanKey);
  if (i >= 0) return i + 1;
  return CENTER_PLAN_KEYS.length + 1;
}

type PricingPlanRow = {
  id?: string;
  plan_key?: string | null;
  all_in_price?: number | string | null;
  students_per_week_limit?: number | string | null;
};

function rowPlanKey(row: PricingPlanRow): string {
  return String(row.plan_key ?? row.id ?? '');
}

function pricingForPlan(
  planKey: string,
  rows: PricingPlanRow[],
): { allIn: number; students: number } {
  const row = rows.find((r) => rowPlanKey(r) === planKey);
  if (row && row.all_in_price != null && Number(row.all_in_price) > 0) {
    const pk = isPlanKey(planKey) ? planKey : 'starter';
    const def = PLANS[pk];
    return {
      allIn: Number(row.all_in_price),
      students: Number(row.students_per_week_limit ?? def.weeklyStudentLimit ?? 0),
    };
  }
  const pk = isPlanKey(planKey) ? planKey : 'starter';
  const p = PLANS[pk];
  return {
    allIn: p.quarterlyAllIn,
    students: p.weeklyStudentLimit ?? 0,
  };
}

type CenterRow = {
  id?: string;
  plan?: string;
  subscription_billing_period?: string | null;
  billing_period?: string | null;
  next_payment_due?: string | null;
  all_in_price?: number | null;
  billing_amount?: number | null;
  billing_status?: string;
  subscription_status?: string;
  status?: string;
  parent_pack_enabled?: boolean;
  pack_request_status?: string | null;
  pack_price_per_parent?: number | string | null;
  parent_pack_active_parents?: number | null;
  announcement_balance?: number | string | null;
  credit_balance?: number | null;
  credit_reserved?: number | null;
  instapay_number?: string | null;
  upgrade_count_this_period?: number | null;
  suspended_at?: string | null;
  current_period_end?: string | null;
  cancellation_reason?: string | null;
  cancellation_requested_at?: string | null;
  billing_type?: string | null;
  pricing_type?: string | null;
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
  metadata?: { processing_fee?: number | string | null } | null;
};

type PlanRequestRow = {
  id: string;
  current_plan: string;
  requested_plan: string;
  status: string;
  requested_at?: string | null;
};

const PLAN_ROOT_I18N_KEYS = new Set([
  'solo',
  'nano',
  'starter',
  'pro',
  'business',
  'enterprise',
  'top_centers',
]);

function planLabelFromMessages(raw: string | null | undefined, tPlan: (key: string) => string): string {
  const k = String(raw ?? 'starter').toLowerCase().replace(/-/g, '_');
  if (PLAN_ROOT_I18N_KEYS.has(k)) return tPlan(k);
  return String(raw ?? '').trim() || tPlan('starter');
}

function maskInstapay(raw: string | null | undefined): string {
  const s = String(raw ?? '').replace(/\s/g, '');
  if (s.length < 7) return '••••••';
  return `${s.slice(0, 3)}XXXXX${s.slice(-3)}`;
}

type CostSummary = {
  daysRemaining: number;
  dailyRateDifference: number;
  amountDue: number;
};

function PaymobModal({
  iframeUrl,
  sessionId,
  invoicePollId,
  title,
  iframeTitle,
  closeLabel,
  onClose,
  onSuccess,
  onError,
}: {
  iframeUrl: string;
  sessionId: string | null;
  invoicePollId: string | null;
  title: string;
  iframeTitle: string;
  closeLabel: string;
  onClose: () => void;
  onSuccess: () => void;
  onError: () => void;
}) {
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;

  useEffect(() => {
    const pollId = sessionId ?? invoicePollId;
    if (!pollId) return;
    const interval = setInterval(async () => {
      const qs = sessionId
        ? `paymobOrderId=${encodeURIComponent(sessionId)}`
        : `invoiceId=${encodeURIComponent(invoicePollId!)}`;
      const { data: sessionWrap } = await supabase.auth.getSession();
      const token = sessionWrap?.session?.access_token;
      const res = await fetch(`/api/paymob/invoice-status?${qs}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = (await res.json()) as { status?: string; paid?: boolean; failed?: boolean };
      if (data.status === 'paid' || data.paid === true) {
        clearInterval(interval);
        onSuccessRef.current();
      }
      if (data.status === 'failed' || data.failed === true) {
        clearInterval(interval);
        onErrorRef.current();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [sessionId, invoicePollId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)]">
        <div className="flex items-center border-b border-[var(--color-border-subtle)] px-4 py-3">
          <span className="font-semibold text-[var(--color-text-primary)]">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="ms-auto text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] btn-press chq-focus"
            aria-label={closeLabel}
          >
            ✕
          </button>
        </div>
        <iframe src={iframeUrl} className="h-[600px] w-full" title={iframeTitle} />
      </div>
    </div>
  );
}

function PlanCard({
  nameAr,
  nameEn,
  price,
  period,
  studentLimit,
  studentsLine,
  isSelected,
  isCurrent,
  currentLabel,
  onClick,
  cairoFont,
  numFont,
  fmtCurrency,
  fmtPerStudentAmount,
  currencySuffix,
  perStudentLabel,
}: {
  nameAr: string;
  nameEn?: string | null;
  price: number;
  period: string;
  studentLimit: number;
  studentsLine: string;
  isSelected: boolean;
  isCurrent: boolean;
  currentLabel: string;
  onClick: () => void;
  cairoFont: CSSProperties;
  numFont: CSSProperties;
  fmtCurrency: (n: number) => string;
  fmtPerStudentAmount: (n: number) => string;
  currencySuffix: string;
  perStudentLabel: string;
}) {
  const perStudent = studentLimit > 0 ? price / studentLimit : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border-2 p-4 text-start transition-shadow ${
        isSelected ? 'border-teal-600 ring-2 ring-teal-600/30' : 'border-[var(--color-border-subtle)] hover:border-[var(--color-border-strong)]'
      } btn-press chq-focus`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-[var(--color-text-primary)]" style={cairoFont}>
            {nameAr}
          </p>
          {nameEn ? <p className="text-xs text-[var(--color-text-muted)]">{nameEn}</p> : null}
        </div>
        {isCurrent ? (
          <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-800">
            {currentLabel}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]" style={cairoFont}>
        {studentsLine}
      </p>
      <p className="mt-1 tabular-nums text-lg font-semibold text-[var(--color-text-primary)]" style={numFont}>
        {fmtCurrency(price)} / {period}
      </p>
      <p className="mt-1 text-xs text-[var(--color-text-muted)] tabular-nums" style={numFont}>
        {fmtPerStudentAmount(perStudent)} {currencySuffix} / {perStudentLabel}
      </p>
    </button>
  );
}

function PeriodCard({
  label,
  price,
  isSelected,
  isCurrent,
  badge,
  currentLabel,
  onClick,
  cairoFont,
  numFont,
  fmtCurrency,
}: {
  label: string;
  price: number;
  isSelected: boolean;
  isCurrent: boolean;
  badge: string | null;
  currentLabel: string;
  onClick: () => void;
  cairoFont: CSSProperties;
  numFont: CSSProperties;
  fmtCurrency: (n: number) => string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border-2 p-4 text-start transition-shadow ${
        isSelected ? 'border-teal-600 ring-2 ring-teal-600/30' : 'border-[var(--color-border-subtle)] hover:border-[var(--color-border-strong)]'
      } btn-press chq-focus`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-[var(--color-text-primary)]" style={cairoFont}>
          {label}
        </span>
        {badge ? (
          <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-secondary)]">
            {badge}
          </span>
        ) : null}
      </div>
      {isCurrent ? (
        <p className="mt-1 text-xs font-medium text-teal-600">{currentLabel}</p>
      ) : null}
      <p className="mt-2 tabular-nums text-lg font-semibold text-[var(--color-text-primary)]" style={numFont}>
        {fmtCurrency(price)}
      </p>
    </button>
  );
}

export default function BillingPage() {
  const t = useTranslations('billing');
  const tPlan = useTranslations('plan');
  const tToast = useTranslations('toasts');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const formatNum = useCallback((n: number | null | undefined) => formatNumber(Number(n) || 0, locale), [locale]);
  const formatCurrencyLocale = useCallback((n: number) => formatCurrency(Number(n), locale), [locale]);
  const formatPerStudentShare = useCallback(
    (n: number) => formatNumber(n, locale, { maximumFractionDigits: 2, minimumFractionDigits: 0 }),
    [locale],
  );
  const { toast } = useToast();

  const [center, setCenter] = useState<CenterRow | null>(null);
  const [userRole, setUserRole] = useState<string>('');
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [planRequests, setPlanRequests] = useState<PlanRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingStallMessage, setBillingStallMessage] = useState<string | null>(null);
  const [packRequestLoading, setPackRequestLoading] = useState(false);
  const [paymobUrl, setPaymobUrl] = useState<string | null>(null);
  const [paymobSessionId, setPaymobSessionId] = useState<string | null>(null);
  const [paymobInvoicePollId, setPaymobInvoicePollId] = useState<string | null>(null);
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);
  const [pricingRows, setPricingRows] = useState<PricingPlanRow[]>([]);
  const [activeTab, setActiveTab] = useState<'upgrade' | 'downgrade'>('upgrade');
  const [selectedPeriod, setSelectedPeriod] = useState<BillingPeriod | ''>('');
  const [selectedPlan, setSelectedPlan] = useState<CenterPlanKey | ''>('');
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [downgradeError, setDowngradeError] = useState<string | null>(null);
  const [downgradeLoading, setDowngradeLoading] = useState(false);
  const [showReactivation, setShowReactivation] = useState(false);
  const [useCredits, setUseCredits] = useState(false);
  const [reactivationLoading, setReactivationLoading] = useState(false);
  const [reactivationError, setReactivationError] = useState<string | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState(2000);
  const [withdrawalSubmitting, setWithdrawalSubmitting] = useState(false);
  const [withdrawalError, setWithdrawalError] = useState<string | null>(null);
  const [withdrawalSuccess, setWithdrawalSuccess] = useState<{
    cashAmount: number;
    instapay: string;
    processingDate: string;
  } | null>(null);
  const withdrawalSectionRef = useRef<HTMLElement | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [cancelConfirmText, setCancelConfirmText] = useState('');
  const [cancelSubmitError, setCancelSubmitError] = useState<string | null>(null);
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [pdfLoading, setPdfLoading] = useState<Record<string, boolean>>({});

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
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData.session;
        if (!session) {
          if (!cancelled) {
            toast.error(tToast('error'), t('loadError'));
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
            toast.error(
              tToast('error'),
              typeof j.error === 'string' ? j.error : t('loadError'),
            );
          }
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
        if (!cancelled) toast.error(tToast('error'), t('loadError'));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setBillingStallMessage(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t, tToast, toast]);

  useEffect(() => {
    if (!loading) return;
    const id = window.setTimeout(() => {
      setBillingStallMessage(t('loadTimeout'));
      setLoading(false);
    }, 10000);
    return () => window.clearTimeout(id);
  }, [loading, t]);

  const closePaymob = useCallback(() => {
    setPaymobUrl(null);
    setPaymobSessionId(null);
    setPaymobInvoicePollId(null);
  }, []);

  const onPaymobSuccess = useCallback(() => {
    closePaymob();
    toast.success(t('paymentSuccess'));
    void refresh();
  }, [closePaymob, toast, t, refresh]);

  const onPaymobError = useCallback(() => {
    closePaymob();
    toast.error(t('paymentFailed'));
  }, [closePaymob, toast, t]);

  useEffect(() => {
    if (userRole !== 'owner' && userRole !== 'super_admin') return;
    let cancelled = false;
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token || cancelled) return;
      const res = await fetch('/api/settings/billing', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok || cancelled) return;
      const j = (await res.json()) as { plans?: PricingPlanRow[] };
      if (!Array.isArray(j.plans) || cancelled) return;
      const keyed = j.plans.filter((p) =>
        CENTER_PLAN_KEYS.includes(rowPlanKey(p) as CenterPlanKey),
      );
      setPricingRows(keyed.length ? keyed : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [userRole]);

  useEffect(() => {
    setSelectedPeriod('');
    setSelectedPlan('');
    setCostSummary(null);
    setPlanError(null);
    setDowngradeError(null);
  }, [activeTab]);

  const ownerOk = userRole === 'owner' || userRole === 'super_admin';

  const handleDownloadPdf = useCallback(
    async (invoiceId: string, invoiceNumber: string | null) => {
      if (!ownerOk) return;
      setPdfLoading((prev) => ({ ...prev, [invoiceId]: true }));
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          toast.error(t('loadError'));
          return;
        }
        const res = await fetch(`/api/invoices/${invoiceId}/pdf`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          toast.error(t('history.pdfError'));
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safe =
          invoiceNumber?.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) ||
          `invoice-${invoiceId.slice(0, 8)}`;
        a.download = `${safe}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        toast.error(t('history.pdfError'));
      } finally {
        setPdfLoading((prev) => ({ ...prev, [invoiceId]: false }));
      }
    },
    [ownerOk, toast, t, supabase],
  );

  const planKey: PlanKey = useMemo(() => {
    const p = center?.plan ?? 'starter';
    return isPlanKey(p) ? p : 'starter';
  }, [center?.plan]);

  const bp = useMemo(
    () => normalizeBillingPeriod(center?.subscription_billing_period ?? center?.billing_period),
    [center?.subscription_billing_period, center?.billing_period],
  );

  /** Monthly EGP from `pricing_plans.all_in_price` for `plan_key`; never derive from quarterly ÷ 3. */
  const currentPlanMonthlyDisplayEgp = useMemo(() => {
    const catalogAllIn = pricingForPlan(planKey, pricingRows).allIn;
    if (catalogAllIn > 0) return catalogAllIn;
    const fromCenter = Number(center?.all_in_price ?? 0);
    return Number.isFinite(fromCenter) && fromCenter > 0 ? fromCenter : catalogAllIn;
  }, [planKey, pricingRows, center?.all_in_price]);

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

  const filteredInvoices = useMemo(
    () => invoices.filter((inv) => (inv.invoice_type ?? '').toLowerCase() !== 'payment_proof'),
    [invoices],
  );

  const packPrice = (() => {
    const r = center?.pack_price_per_parent;
    if (r === null || r === undefined || r === '') return 12;
    const n = Number(r);
    return Number.isFinite(n) ? n : 12;
  })();
  const packParents = Number(center?.parent_pack_active_parents ?? 0) || 0;
  const announcementBal = Number(center?.announcement_balance ?? 0) || 0;
  const packEnabled = center?.parent_pack_enabled === true;
  const packReq = (center?.pack_request_status ?? 'none').toLowerCase();
  const profitPerParent = SUGGESTED_RESALE_EGP - packPrice;
  const monthlyPackCost = packParents * packPrice;

  const creditBal = Number(center?.credit_balance ?? 0);
  const creditReserved = Number(center?.credit_reserved ?? 0);
  const availableCredits = Math.max(0, creditBal - creditReserved);
  const todayCairo = getTodayCairo();
  const withdrawalWindowOpen = isWithdrawalWindowOpen();
  const nextWithdrawalWindowYmd = nextQuarterFirstOnOrAfter(todayCairo);
  const nextWithdrawalWindowLabel = (() => {
    const d = new Date(`${nextWithdrawalWindowYmd}T12:00:00`);
    return Number.isNaN(d.getTime())
      ? nextWithdrawalWindowYmd
      : formatDateLocale(d, locale, { year: 'numeric', month: 'short', day: 'numeric' });
  })();

  useEffect(() => {
    if (availableCredits >= 2000) {
      setWithdrawAmount((v) => {
        const n = Math.floor(Number(v)) || 2000;
        return Math.min(Math.max(n, 2000), availableCredits);
      });
    }
  }, [availableCredits]);

  const centerStatusLower = (center?.status ?? '').toLowerCase();
  const canPlanChange =
    ownerOk &&
    !!center &&
    centerStatusLower === 'active' &&
    !isSuspendedCenter &&
    subLower === 'active' &&
    (bsLower === 'paid' || bsLower === 'active') &&
    !isOverdue;

  const billingPeriodEndLabel = useMemo(() => {
    const ymd =
      (center?.current_period_end && String(center.current_period_end).slice(0, 10)) ||
      (center?.next_payment_due ? center.next_payment_due.slice(0, 10) : '');
    if (!ymd) return tCommon('notSet');
    const d = new Date(`${ymd}T12:00:00`);
    return Number.isNaN(d.getTime())
      ? ymd
      : formatDateLocale(d, locale);
  }, [center?.current_period_end, center?.next_payment_due, locale, tCommon]);

  const showCancelDanger =
    ownerOk &&
    !!center &&
    centerStatusLower === 'active' &&
    !isSuspendedCenter;

  const currentRank = planRank(center?.plan ?? 'starter');

  const upgradePlanOptions = useMemo(
    () => CENTER_PLAN_KEYS.filter((k) => planRank(k) > currentRank),
    [currentRank],
  );

  const downgradePlanOptions = useMemo(() => {
    const cp = center?.plan ?? 'starter';
    if (cp === 'solo') return [];
    const cr = planRank(cp);
    return CENTER_PLAN_KEYS.filter((k) => planRank(k) < cr);
  }, [center?.plan]);

  const periodRefKey: PlanKey = useMemo(() => {
    if (activeTab === 'downgrade' && selectedPlan) {
      return selectedPlan as PlanKey;
    }
    return planKey;
  }, [activeTab, selectedPlan, planKey]);

  const periodRefPricing = useMemo(
    () => pricingForPlan(periodRefKey, pricingRows),
    [periodRefKey, pricingRows],
  );

  const periodPrices = useMemo(() => {
    const pk = isPlanKey(periodRefKey) ? periodRefKey : 'starter';
    const allIn = periodRefPricing.allIn;
    return {
      monthly: getChargeFromQuarterlyAllIn(allIn, 'monthly', pk),
      annual: getChargeFromQuarterlyAllIn(allIn, 'annual', pk),
    };
  }, [periodRefKey, periodRefPricing.allIn]);

  /**
   * The Monthly period card must show the SAME number as the current-plan
   * hero when it represents the center's *current* period — never the
   * recomputed catalog list price. Only used when bp === 'monthly' (isCurrent).
   */
  const currentMonthlyRealPrice = currentPlanMonthlyDisplayEgp;

  useEffect(() => {
    if (activeTab !== 'upgrade' || !selectedPeriod || !selectedPlan || !npdYmd) {
      setCostSummary(null);
      return;
    }
    const pricing = pricingForPlan(selectedPlan, pricingRows);
    const currentPricing = pricingForPlan(planKey, pricingRows);
    const currentAllIn = Number(center?.all_in_price ?? 0) || currentPricing.allIn;
    const newPeriodPrice = getChargeFromQuarterlyAllIn(
      pricing.allIn,
      selectedPeriod as BillingPeriod,
      selectedPlan as PlanKey,
    );
    const currentPeriodPrice = getChargeFromQuarterlyAllIn(currentAllIn, bp, planKey);
    const cost = getUpgradeCost({
      newPlanPrice: newPeriodPrice,
      currentPlanPrice: currentPeriodPrice,
      newBillingPeriod: selectedPeriod as BillingPeriod,
      currentBillingPeriod: bp,
      nextPaymentDue: new Date(`${npdYmd}T12:00:00`),
    });
    const amountDue = Math.round(Math.max(0, cost.amountDue) * 100) / 100;
    setCostSummary({
      daysRemaining: cost.daysRemaining,
      dailyRateDifference: cost.dailyRateDifference,
      amountDue,
    });
  }, [
    activeTab,
    selectedPeriod,
    selectedPlan,
    npdYmd,
    pricingRows,
    center?.all_in_price,
    bp,
    planKey,
  ]);

  const downgradePreview = useMemo(() => {
    if (
      activeTab !== 'downgrade' ||
      !selectedPeriod ||
      !selectedPlan ||
      !npdYmd ||
      !center
    ) {
      return null;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(`${npdYmd}T12:00:00`);
    due.setHours(0, 0, 0, 0);
    const remainingDays = Math.max(
      0,
      Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
    );
    const currentAllIn =
      Number(center.all_in_price ?? 0) || pricingForPlan(planKey, pricingRows).allIn;
    const newP = pricingForPlan(selectedPlan, pricingRows);
    const newPeriodPrice = getChargeFromQuarterlyAllIn(
      newP.allIn,
      selectedPeriod as BillingPeriod,
      selectedPlan as PlanKey,
    );
    const currentPeriodPrice = getChargeFromQuarterlyAllIn(currentAllIn, bp, planKey);
    const currentDaily = getDailyRate(currentPeriodPrice, bp);
    const newDaily = getDailyRate(newPeriodPrice, selectedPeriod as BillingPeriod);
    const earned = Math.round(Math.max(0, (currentDaily - newDaily) * remainingDays) * 100) / 100;
    return { currentDaily, newDaily, remainingDays, earned };
  }, [
    activeTab,
    selectedPeriod,
    selectedPlan,
    npdYmd,
    center,
    bp,
    planKey,
    pricingRows,
  ]);

  const reactivationCalc = useMemo(() => {
    const ba = Number(center?.billing_amount ?? 0);
    if (!center?.suspended_at || !Number.isFinite(ba) || ba <= 0) return null;
    const tier = getReactivationTier(new Date(center.suspended_at));
    const dailyRate = getDailyRate(ba, bp);
    const calc = getReactivationAmount({ tier, nextPeriodAmount: ba, dailyRate });
    return { tier, ...calc, nextPeriodAmount: ba, dailyRate };
  }, [center?.suspended_at, center?.billing_amount, bp]);

  const upgradeUsed = Number(center?.upgrade_count_this_period ?? 0);
  const upgradeLimit = getUpgradeLimit(bp);
  const upgradeLimitReached = upgradeUsed >= upgradeLimit;

  const handleUpgradePay = async () => {
    if (!selectedPlan || !selectedPeriod || !isFeatureEnabled('PAYMOB_ENABLED')) {
      if (!isFeatureEnabled('PAYMOB_ENABLED')) toast.info(t('history.payDisabled'));
      return;
    }
    setPaymentLoading(true);
    setPlanError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error(t('loadError'));
      const res = await fetch('/api/billing/upgrade', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ newPlan: selectedPlan, newBillingPeriod: selectedPeriod }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        paymobUrl?: string;
        paymobOrderId?: string;
      };
      if (!res.ok) {
        setPlanError(typeof data.error === 'string' ? data.error : t('paymentFailed'));
        return;
      }
      if (data.paymobUrl && data.paymobOrderId) {
        setPaymobUrl(data.paymobUrl);
        setPaymobSessionId(data.paymobOrderId);
        setPaymobInvoicePollId(null);
      }
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : t('paymentFailed'));
    } finally {
      setPaymentLoading(false);
    }
  };

  const handleDowngradeConfirm = async () => {
    if (!selectedPlan || !selectedPeriod) return;
    setDowngradeLoading(true);
    setDowngradeError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error(t('loadError'));
      const res = await fetch('/api/billing/downgrade', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ newPlan: selectedPlan, newBillingPeriod: selectedPeriod }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setDowngradeError(typeof data.error === 'string' ? data.error : t('paymentFailed'));
        return;
      }
      toast.success(t('downgrade.success'));
      await refresh();
    } catch (e) {
      setDowngradeError(e instanceof Error ? e.message : t('paymentFailed'));
    } finally {
      setDowngradeLoading(false);
    }
  };

  const handleReactivationPay = async () => {
    if (!reactivationCalc) return;
    const creditBal = Number(center?.credit_balance ?? 0);
    const total = reactivationCalc.total;
    const appliedPreview = useCredits ? Math.min(creditBal, total) : 0;
    const viaPayPreview = Math.max(0, total - appliedPreview);
    if (viaPayPreview > 0 && !isFeatureEnabled('PAYMOB_ENABLED')) {
      toast.info(t('history.payDisabled'));
      return;
    }
    setReactivationLoading(true);
    setReactivationError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error(t('loadError'));
      const res = await fetch('/api/billing/reactivate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          useCredits,
          creditAmount: useCredits ? Math.min(creditBal, total) : 0,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        reactivated?: boolean;
        paymobUrl?: string;
        paymobOrderId?: string;
        reused?: boolean;
      };
      if (!res.ok) {
        setReactivationError(typeof data.error === 'string' ? data.error : t('paymentFailed'));
        return;
      }
      if (data.reactivated) {
        toast.success(t('paymentSuccess'));
        setShowReactivation(false);
        setUseCredits(false);
        await refresh();
        return;
      }
      if (data.paymobUrl && data.paymobOrderId) {
        setPaymobUrl(data.paymobUrl);
        setPaymobSessionId(data.paymobOrderId);
        setPaymobInvoicePollId(null);
        setShowReactivation(false);
        return;
      }
      setReactivationError(t('paymentFailed'));
    } catch (e) {
      setReactivationError(e instanceof Error ? e.message : t('paymentFailed'));
    } finally {
      setReactivationLoading(false);
    }
  };

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
    if (!ownerOk || !isFeatureEnabled('PAYMOB_ENABLED')) {
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
      const orderId = typeof j.orderId === 'string' ? j.orderId : '';
      if (iframeUrl) {
        setPaymobUrl(iframeUrl);
        setPaymobSessionId(orderId || null);
        setPaymobInvoicePollId(orderId ? null : invoiceId);
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
    return { cls: 'border-white/30 bg-slate-950/40 text-white', label: t('status.active'), icon: null };
  }, [bsLower, subLower, isSuspendedCenter, t]);

  const invoiceStatusDisplay = (raw: string | null | undefined) => {
    const v = (raw ?? '').toLowerCase();
    if (v === 'paid' || v === 'approved') return t('status.paid');
    if (v === 'pending') return t('status.pending');
    if (v === 'overdue') return t('status.overdue');
    if (v === 'cancelled' || v === 'canceled') return t('status.cancelled');
    if (v === 'active') return t('status.active');
    return raw || tCommon('notSet');
  };

  const planRequestStatusBadge = (st: string) => {
    const v = st.toLowerCase();
    if (v === 'approved') return 'bg-green-100 text-green-700';
    if (v === 'rejected') return 'bg-red-100 text-red-700';
    return 'bg-amber-100 text-amber-800';
  };

  const packHeaderBadge = () => {
    if (packReq === 'pending') {
      return {
        cls: 'border-amber-400/60 bg-amber-500/15 text-amber-800',
        label: t('pack.badgeRequested'),
      };
    }
    if (packEnabled) {
      return {
        cls: 'border-[var(--color-brand-500)]/50 bg-[var(--color-brand-500)]/15 text-[var(--color-brand-500)]',
        label: t('pack.badgeActive'),
      };
    }
    return {
      cls: 'border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]',
      label: t('pack.badgeInactive'),
    };
  };

  const cairoFont = { fontFamily: 'var(--font-cairo), Cairo, sans-serif' } as const;
  const numFont = { fontFamily: 'ui-sans-serif, system-ui, sans-serif' } as const;

  const handleWithdrawalSubmit = useCallback(async () => {
    if (!ownerOk || !withdrawalWindowOpen || !String(center?.instapay_number ?? '').trim()) return;
    const amt = Math.floor(Number(withdrawAmount));
    if (!Number.isFinite(amt) || amt < 2000 || amt > availableCredits) {
      setWithdrawalError(t('withdrawal.insufficient'));
      return;
    }
    setWithdrawalSubmitting(true);
    setWithdrawalError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error(t('loadError'));
      const csrf = await getCsrfHeaders(token);
      const res = await fetch('/api/billing/withdrawal', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...csrf },
        body: JSON.stringify({ creditAmount: amt }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        cashAmount?: number;
        instapay?: string;
        processingDate?: string;
      };
      if (!res.ok) {
        const err = typeof data.error === 'string' ? data.error : '';
        if (/reserve|Reserve/i.test(err)) {
          setWithdrawalError(t('withdrawal.reservationFailed'));
        } else if (/Insufficient/i.test(err)) {
          setWithdrawalError(t('withdrawal.insufficient'));
        } else {
          setWithdrawalError(err || t('paymentFailed'));
        }
        return;
      }
      const proc =
        typeof data.processingDate === 'string' && data.processingDate
          ? data.processingDate
          : nextProcessingQuarterStart(todayCairo);
      setWithdrawalSuccess({
        cashAmount: Number(data.cashAmount ?? amt / 2),
        instapay: String(data.instapay ?? center?.instapay_number ?? ''),
        processingDate: proc,
      });
      await refresh();
    } catch (e) {
      setWithdrawalError(e instanceof Error ? e.message : t('paymentFailed'));
    } finally {
      setWithdrawalSubmitting(false);
    }
  }, [
    ownerOk,
    withdrawalWindowOpen,
    center?.instapay_number,
    withdrawAmount,
    availableCredits,
    t,
    refresh,
    todayCairo,
  ]);

  const handleCancelSubscription = useCallback(async () => {
    if (!cancelReason || cancelConfirmText !== 'CANCEL') return;
    setCancelSubmitting(true);
    setCancelSubmitError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error(t('loadError'));
      const res = await fetch('/api/billing/cancel', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: cancelReason }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        periodEnd?: string | null;
      };
      if (!res.ok) {
        setCancelSubmitError(typeof data.error === 'string' ? data.error : t('cancel.errorGeneric'));
        return;
      }
      const ymd =
        (data.periodEnd && String(data.periodEnd).slice(0, 10)) ||
        (center?.next_payment_due && center.next_payment_due.slice(0, 10)) ||
        '';
      const pe =
        ymd && !Number.isNaN(new Date(`${ymd}T12:00:00`).getTime())
          ? formatDateLocale(`${ymd}T12:00:00`, locale)
          : billingPeriodEndLabel;
      toast.success(t('cancel.success', { date: pe }));
      setShowCancelModal(false);
      setCancelConfirmText('');
      setCancelReason('');
      await refresh();
    } catch (e) {
      setCancelSubmitError(e instanceof Error ? e.message : t('cancel.errorGeneric'));
    } finally {
      setCancelSubmitting(false);
    }
  }, [
    cancelReason,
    cancelConfirmText,
    t,
    toast,
    refresh,
    billingPeriodEndLabel,
    locale,
    center?.next_payment_due,
  ]);

  const renderInvoiceStatusBadge = (st: string) => {
    const base = 'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold';
    if (st === 'paid' || st === 'approved') {
      return (
        <span
          className={`${base} bg-green-100 text-green-700`}
          style={cairoFont}
        >
          {t('status.paid')}
        </span>
      );
    }
    if (st === 'pending') {
      return (
        <span className={`${base} bg-amber-100 text-amber-700`} style={cairoFont}>
          {t('status.pending')}
        </span>
      );
    }
    if (st === 'overdue') {
      return (
        <span className={`${base} bg-red-100 text-red-700`} style={cairoFont}>
          {t('status.overdue')}
        </span>
      );
    }
    if (st === 'cancelled' || st === 'canceled') {
      return (
        <span className={`${base} bg-[var(--color-surface-2)] text-[var(--color-text-muted)]`} style={cairoFont}>
          {t('status.cancelled')}
        </span>
      );
    }
    return (
      <span className={`${base} bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]`} style={cairoFont}>
        {st || tCommon('notSet')}
      </span>
    );
  };

  const renderInvoicePdfButton = (inv: InvoiceRow) => {
    if (!ownerOk) {
      return (
        <span className="text-[var(--color-text-muted)] text-xs" aria-hidden>
          -
        </span>
      );
    }
    const loading = !!pdfLoading[inv.id];
    return (
      <button
        type="button"
        onClick={() => void handleDownloadPdf(inv.id, inv.invoice_number ?? null)}
        disabled={loading}
        className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs font-semibold text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-teal)]/40 hover:text-[var(--color-teal)] disabled:opacity-50 chq-focus"
      >
        {loading ? (
          <span>{t('history.downloadingPdf')}</span>
        ) : (
          <>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>{t('history.downloadPdf')}</span>
          </>
        )}
      </button>
    );
  };

  const renderInvoiceActionCell = (inv: InvoiceRow, st: string) => {
    if (st === 'pending' || st === 'overdue') {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!ownerOk || payingInvoiceId === inv.id}
            onClick={() => void handleInvoicePay(inv.id)}
            className="rounded-lg border-2 px-3 py-1.5 text-xs font-semibold disabled:opacity-50 btn-press chq-focus"
            style={{ borderColor: 'var(--color-brand-500)', color: 'var(--color-brand-500)' }}
          >
            {payingInvoiceId === inv.id ? t('loadingShort') : t('history.payNow')}
          </button>
          {renderInvoicePdfButton(inv)}
        </div>
      );
    }
    if (st === 'paid' || st === 'approved') {
      return renderInvoicePdfButton(inv);
    }
    return renderInvoicePdfButton(inv);
  };

  if (loading) {
    return (
      <div className="bg-[var(--color-surface-0)] min-h-screen w-full flex flex-col p-4 pb-10 md:p-8">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
          <div className="h-10 w-48 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
          <div className="h-56 animate-pulse rounded-2xl bg-gradient-to-br from-teal-200 to-slate-300" />
          <div className="h-48 animate-pulse rounded-2xl bg-[var(--color-surface-1)]" />
          <div className="h-64 animate-pulse rounded-2xl bg-[var(--color-surface-1)]" />
          <div className="h-48 animate-pulse rounded-2xl bg-[var(--color-surface-1)]" />
        </div>
      </div>
    );
  }

  const badge = packHeaderBadge();

  return (
    <div
      className="bg-[var(--color-surface-0)] min-h-screen w-full flex flex-col p-4 pb-10 text-[var(--color-text-primary)] md:p-8"
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
        {billingStallMessage ? (
          <div
            className="rounded-xl border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            style={cairoFont}
          >
            {billingStallMessage}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-xl font-bold md:text-2xl text-[var(--color-text-primary)]" style={cairoFont}>
            {t('page.title')}
          </h1>
          <Link
            href="/settings"
            className="text-sm font-medium hover:underline"
            style={{ color: 'var(--color-brand-500)' }}
          >
            {t('backToSettings')}
          </Link>
        </div>

        {!ownerOk && (
          <div
            className="rounded-xl border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            style={cairoFont}
          >
            {t('ownerOnly')}
          </div>
        )}

        {/* SECTION 1: CURRENT PLAN HERO */}
        <section
          className="rounded-2xl bg-gradient-to-br from-teal-600 to-slate-800 p-5 text-white shadow-lg md:p-6"
          aria-labelledby="billing-hero-heading"
        >
          <div className="flex flex-col gap-4 border-b border-white/15 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p id="billing-hero-heading" className="text-2xl font-bold leading-tight md:text-3xl" style={cairoFont}>
                  {planLabelFromMessages(planKey, tPlan)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="rounded-full px-3 py-1 text-xs font-semibold text-white"
                  style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
                >
                  {`${t('billingPeriod')}: ${t(`period.${bp}.label` as 'billing.period.monthly.label')}`}
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
                {formatCurrencyLocale(currentPlanMonthlyDisplayEgp)}
              </span>
            </div>
            <div className="flex flex-col gap-1 border-b border-white/15 py-4 md:border-b-0 md:border-e md:py-3 md:px-4">
              <span className="text-xs font-medium uppercase tracking-wide text-teal-100/90" style={cairoFont}>
                {t('currentPlan.nextPayment')}
              </span>
              <span className="text-lg font-semibold tabular-nums text-white" style={numFont}>
                {npdYmd
                  ? formatDateLocale(`${npdYmd}T12:00:00`, locale)
                  : tCommon('notSet')}
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
              className="mt-4 flex flex-col gap-3 rounded-xl border border-red-400/50 bg-red-950/40 px-4 py-3 text-sm text-red-50"
              style={cairoFont}
            >
              <p className="flex items-start gap-2">
                <span aria-hidden>⚠️</span>
                <span>{t('currentPlan.overdue')}</span>
              </p>
              {ownerOk && isSuspendedCenter ? (
                <button
                  type="button"
                  className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-[var(--color-text-primary)] shadow-sm md:w-auto btn-press chq-focus"
                  style={{ backgroundColor: 'var(--color-gold-500)' }}
                  onClick={() => {
                    setReactivationError(null);
                    setShowReactivation(true);
                  }}
                >
                  {t('currentPlan.reactivate')}
                </button>
              ) : null}
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

        {/* SECTION 2: UPGRADE / DOWNGRADE */}
        {canPlanChange ? (
          <section
            className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6 shadow-sm"
            aria-labelledby="billing-plan-change-heading"
          >
            <h2
              id="billing-plan-change-heading"
              className="text-lg font-semibold text-[var(--color-text-primary)]"
              style={cairoFont}
            >
              {activeTab === 'upgrade' ? t('upgrade.title') : t('downgrade.title')}
            </h2>
            <div className="mt-4 flex flex-wrap gap-4 border-b border-[var(--color-border-subtle)]">
              <button
                type="button"
                onClick={() => setActiveTab('upgrade')}
                className={`pb-2 ps-1 pe-1 text-sm ${
                  activeTab === 'upgrade'
                    ? 'border-b-2 border-teal-600 font-semibold text-teal-600'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                } btn-press chq-focus`}
                style={cairoFont}
              >
                {t('upgrade.title')}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('downgrade')}
                className={`pb-2 ps-1 pe-1 text-sm ${
                  activeTab === 'downgrade'
                    ? 'border-b-2 border-teal-600 font-semibold text-teal-600'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                } btn-press chq-focus`}
                style={cairoFont}
              >
                {t('downgrade.title')}
              </button>
            </div>

            {activeTab === 'upgrade' ? (
              <div className="mt-6 space-y-6">
                <div>
                  <p className="text-sm text-[var(--color-text-secondary)]" style={cairoFont}>
                    {t('upgrade.usedOf', { used: formatNum(upgradeUsed), limit: formatNum(upgradeLimit) })}
                  </p>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                    <div
                      className="h-2 rounded-full bg-teal-600 transition-all"
                      style={{
                        inlineSize: `${Math.min(100, upgradeLimit ? (upgradeUsed / upgradeLimit) * 100 : 0)}%`,
                      }}
                    />
                  </div>
                  {upgradeLimitReached ? (
                    <p className="mt-2 text-sm text-amber-700" style={cairoFont}>
                      {t('upgrade.limitReached')}
                      {npdYmd
                        ? ` - ${formatDateLocale(`${npdYmd}T12:00:00`, locale)}`
                        : ''}
                    </p>
                  ) : null}
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]" style={cairoFont}>
                    {t('upgrade.choosePeriod')}
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <PeriodCard
                      label={t('period.monthly.label')}
                      price={bp === 'monthly' ? currentMonthlyRealPrice : periodPrices.monthly}
                      isSelected={selectedPeriod === 'monthly'}
                      isCurrent={bp === 'monthly'}
                      badge={null}
                      currentLabel={t('upgrade.currentPeriod')}
                      onClick={() => {
                        setSelectedPeriod('monthly');
                        setSelectedPlan('');
                      }}
                      cairoFont={cairoFont}
                      numFont={numFont}
                      fmtCurrency={formatCurrencyLocale}
                    />
                    <PeriodCard
                      label={t('period.annual.label')}
                      price={periodPrices.annual}
                      isSelected={selectedPeriod === 'annual'}
                      isCurrent={bp === 'annual'}
                      badge={t('upgrade.annualSaveHint')}
                      currentLabel={t('upgrade.currentPeriod')}
                      onClick={() => {
                        setSelectedPeriod('annual');
                        setSelectedPlan('');
                      }}
                      cairoFont={cairoFont}
                      numFont={numFont}
                      fmtCurrency={formatCurrencyLocale}
                    />
                  </div>
                </div>

                {selectedPeriod ? (
                  <div
                    className={`transition-opacity duration-300 ${selectedPeriod ? 'opacity-100' : 'opacity-0'}`}
                  >
                    <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]" style={cairoFont}>
                      {t('upgrade.choosePlan')}
                    </h3>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {upgradePlanOptions.map((pk) => {
                        const pr = pricingForPlan(pk, pricingRows);
                        const price = getChargeFromQuarterlyAllIn(
                          pr.allIn,
                          selectedPeriod as BillingPeriod,
                          pk,
                        );
                        const periodLabel = selectedPeriod === 'annual' ? t('perYear') : t('perMonth');
                        return (
                          <PlanCard
                            key={pk}
                            nameAr={tPlan(pk)}
                            nameEn={locale === 'en' ? PLANS[pk].arabicName : undefined}
                            price={price}
                            period={periodLabel}
                            studentLimit={pr.students}
                            studentsLine={t('studentsLimit', { limit: formatNum(pr.students) })}
                            isSelected={selectedPlan === pk}
                            isCurrent={false}
                            currentLabel={t('upgrade.currentPeriod')}
                            onClick={() => setSelectedPlan(pk)}
                            cairoFont={cairoFont}
                            numFont={numFont}
                            fmtCurrency={formatCurrencyLocale}
                            fmtPerStudentAmount={formatPerStudentShare}
                            currencySuffix={tCommon('egp')}
                            perStudentLabel={t('planCardPerStudent')}
                          />
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {selectedPeriod && selectedPlan && costSummary ? (
                  <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] p-4">
                    <h3 className="text-sm font-semibold text-[var(--color-text-primary)]" style={cairoFont}>
                      {t('upgrade.summary')}
                    </h3>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-[var(--color-text-muted)]" style={cairoFont}>
                          {t('upgrade.newPlan')}
                        </dt>
                        <dd className="text-end font-medium text-[var(--color-text-primary)]" style={cairoFont}>
                          {planLabelFromMessages(selectedPlan, tPlan)}
                        </dd>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-[var(--color-text-muted)]" style={cairoFont}>
                          {t('upgrade.newPeriod')}
                        </dt>
                        <dd className="text-end text-[var(--color-text-primary)]" style={cairoFont}>
                          {t(`period.${selectedPeriod}.label` as 'billing.period.monthly.label')}
                        </dd>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-[var(--color-text-muted)]" style={cairoFont}>
                          {t('upgrade.daysRemaining')}
                        </dt>
                        <dd className="tabular-nums text-[var(--color-text-primary)]" style={numFont}>
                          {formatNum(costSummary.daysRemaining)}
                        </dd>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-[var(--color-text-muted)]" style={cairoFont}>
                          {t('upgrade.dailyDiff')}
                        </dt>
                        <dd className="tabular-nums text-[var(--color-text-primary)]" style={numFont}>
                          {formatNum(Math.round(costSummary.dailyRateDifference * 100) / 100)} {t('egp')}
                        </dd>
                      </div>
                    </dl>
                    <div className="my-3 border-t border-[var(--color-border-subtle)]" />
                    <p className="text-sm text-[var(--color-text-secondary)]" style={cairoFont}>
                      {t('upgrade.amountDue')}
                    </p>
                    <p className="text-2xl font-bold text-teal-600 tabular-nums" style={numFont}>
                      {formatNum(costSummary.amountDue)} {t('egp')}
                    </p>
                    <p className="mt-2 text-sm text-[var(--color-text-secondary)]" style={cairoFont}>
                      {t('upgrade.nextRenewal')}
                    </p>
                    <p className="tabular-nums text-[var(--color-text-primary)]" style={numFont}>
                      {npdYmd
                        ? formatDateLocale(`${npdYmd}T12:00:00`, locale)
                        : tCommon('notSet')}
                    </p>
                    <p className="mt-2 text-sm text-[var(--color-text-secondary)]" style={cairoFont}>
                      {t('upgrade.newMonthlyRate')}
                    </p>
                    <p className="tabular-nums text-[var(--color-text-primary)]" style={numFont}>
                      {formatCurrencyLocale(pricingForPlan(selectedPlan, pricingRows).allIn)}
                    </p>
                    {planError ? (
                      <p className="mt-2 text-sm text-red-600" role="alert">
                        {planError}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      disabled={
                        paymentLoading ||
                        upgradeLimitReached ||
                        costSummary.amountDue <= 0 ||
                        !isFeatureEnabled('PAYMOB_ENABLED')
                      }
                      onClick={() => void handleUpgradePay()}
                      className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-50 md:w-full btn-press chq-focus"
                      style={{ backgroundColor: 'var(--color-brand-500)' }}
                    >
                      {paymentLoading ? t('loadingShort') : t('upgrade.proceed')}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : activeTab === 'downgrade' ? (
              <div className="mt-6 space-y-6">
                <div
                  className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                  style={cairoFont}
                >
                  {t('downgrade.notice')}
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]" style={cairoFont}>
                    {t('downgrade.choosePlan')}
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {downgradePlanOptions.map((pk) => {
                      const pr = pricingForPlan(pk, pricingRows);
                      const price = getChargeFromQuarterlyAllIn(pr.allIn, 'monthly', pk);
                      return (
                        <PlanCard
                          key={pk}
                          nameAr={tPlan(pk)}
                          nameEn={locale === 'en' ? PLANS[pk].arabicName : undefined}
                          price={price}
                          period={t('perMonth')}
                          studentLimit={pr.students}
                          studentsLine={t('studentsLimit', { limit: formatNum(pr.students) })}
                          isSelected={selectedPlan === pk}
                          isCurrent={planKey === pk}
                          currentLabel={t('upgrade.currentPeriod')}
                          onClick={() => {
                            setSelectedPlan(pk);
                            setSelectedPeriod('');
                          }}
                          cairoFont={cairoFont}
                          numFont={numFont}
                          fmtCurrency={formatCurrencyLocale}
                          fmtPerStudentAmount={formatPerStudentShare}
                          currencySuffix={tCommon('egp')}
                          perStudentLabel={t('planCardPerStudent')}
                        />
                      );
                    })}
                  </div>
                </div>

                {selectedPlan ? (
                  <div className="transition-opacity duration-300 opacity-100">
                    <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]" style={cairoFont}>
                      {t('downgrade.choosePeriod')}
                    </h3>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <PeriodCard
                        label={t('period.monthly.label')}
                        price={getChargeFromQuarterlyAllIn(
                          pricingForPlan(selectedPlan, pricingRows).allIn,
                          'monthly',
                          selectedPlan,
                        )}
                        isSelected={selectedPeriod === 'monthly'}
                        isCurrent={bp === 'monthly'}
                        badge={null}
                        currentLabel={t('upgrade.currentPeriod')}
                        onClick={() => setSelectedPeriod('monthly')}
                        cairoFont={cairoFont}
                        numFont={numFont}
                        fmtCurrency={formatCurrencyLocale}
                      />
                      <PeriodCard
                        label={t('period.annual.label')}
                        price={getChargeFromQuarterlyAllIn(
                          pricingForPlan(selectedPlan, pricingRows).allIn,
                          'annual',
                          selectedPlan,
                        )}
                        isSelected={selectedPeriod === 'annual'}
                        isCurrent={bp === 'annual'}
                        badge={t('upgrade.annualSaveHint')}
                        currentLabel={t('upgrade.currentPeriod')}
                        onClick={() => setSelectedPeriod('annual')}
                        cairoFont={cairoFont}
                        numFont={numFont}
                        fmtCurrency={formatCurrencyLocale}
                      />
                    </div>
                  </div>
                ) : null}

                {selectedPlan && selectedPeriod && downgradePreview ? (
                  <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] p-4">
                    <h3 className="text-sm font-semibold text-[var(--color-text-primary)]" style={cairoFont}>
                      {t('downgrade.summary')}
                    </h3>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-[var(--color-text-muted)]" style={cairoFont}>
                          {t('downgrade.currentRate')}
                        </dt>
                        <dd className="tabular-nums text-[var(--color-text-primary)]" style={numFont}>
                          {formatNum(Math.round(downgradePreview.currentDaily * 100) / 100)} {t('egp')}
                        </dd>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-[var(--color-text-muted)]" style={cairoFont}>
                          {t('downgrade.newRate')}
                        </dt>
                        <dd className="tabular-nums text-[var(--color-text-primary)]" style={numFont}>
                          {formatNum(Math.round(downgradePreview.newDaily * 100) / 100)} {t('egp')}
                        </dd>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-[var(--color-text-muted)]" style={cairoFont}>
                          {t('upgrade.daysRemaining')}
                        </dt>
                        <dd className="tabular-nums text-[var(--color-text-primary)]" style={numFont}>
                          {formatNum(downgradePreview.remainingDays)}
                        </dd>
                      </div>
                    </dl>
                    <div className="my-3 border-t border-[var(--color-border-subtle)]" />
                    <p className="text-sm text-[var(--color-text-secondary)]" style={cairoFont}>
                      {t('downgrade.creditsEarned')}
                    </p>
                    <p className="text-2xl font-bold text-teal-600 tabular-nums" style={numFont}>
                      {formatNum(downgradePreview.earned)} {t('downgrade.creditPoints')}
                    </p>
                    <p className="mt-2 text-sm text-[var(--color-text-muted)]" style={cairoFont}>
                      {t('downgrade.currentBalance')}:{' '}
                      <span className="tabular-nums text-[var(--color-text-primary)]" style={numFont}>
                        {formatNum(Number(center?.credit_balance ?? 0))}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-text-muted)]" style={cairoFont}>
                      {t('downgrade.newBalance')}:{' '}
                      <span className="tabular-nums text-[var(--color-text-primary)]" style={numFont}>
                        {formatNum(Number(center?.credit_balance ?? 0) + downgradePreview.earned)}
                      </span>
                    </p>
                    {downgradeError ? (
                      <p className="mt-2 text-sm text-red-600" role="alert">
                        {downgradeError}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      disabled={downgradeLoading}
                      onClick={() => void handleDowngradeConfirm()}
                      className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold text-[var(--color-text-primary)] shadow-sm disabled:opacity-50 btn-press chq-focus"
                      style={{ backgroundColor: 'var(--color-gold-500)' }}
                    >
                      {downgradeLoading ? t('loadingShort') : t('downgrade.confirm')}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {ownerOk ? (
          <>
            {/* SECTION 3: CREDITS BALANCE */}
            <section
              className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6 shadow-sm"
              aria-labelledby="billing-credits-heading"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2
                  id="billing-credits-heading"
                  className="text-lg font-semibold text-[var(--color-text-primary)]"
                  style={cairoFont}
                >
                  {t('credits.title')}
                </h2>
                {creditBal > 0 ? (
                  <span
                    className="rounded-full px-3 py-1 text-sm font-semibold text-teal-800"
                    style={{ backgroundColor: 'rgba(13, 148, 136, 0.15)' }}
                  >
                    {formatNum(availableCredits)}
                  </span>
                ) : null}
              </div>

              {creditBal > 0 ? (
                <div className="mt-4 space-y-4">
                  <p className="text-3xl font-bold tabular-nums text-[var(--color-text-primary)]" style={numFont}>
                    {t('credits.available', { amount: formatNum(availableCredits) })}
                  </p>
                  {creditReserved > 0 ? (
                    <p className="text-sm text-[var(--color-text-muted)]" style={cairoFont}>
                      {t('credits.reserved', { amount: formatNum(creditReserved) })}
                    </p>
                  ) : null}
                  <p className="text-sm text-[var(--color-text-secondary)]" style={cairoFont}>
                    {t('credits.equivalent', { amount: formatNum(availableCredits / 2) })}
                  </p>
                  <p className="text-sm text-[var(--color-text-muted)]" style={cairoFont}>
                    {t('credits.expiryNote')}
                  </p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => toast.info(t('credits.applyInfo'))}
                      className="w-full rounded-xl border-2 border-amber-500 px-4 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-50 sm:w-auto btn-press chq-focus"
                      style={cairoFont}
                    >
                      {t('credits.applyToInvoice')}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        withdrawalSectionRef.current?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'start',
                        })
                      }
                      className="w-full rounded-xl border-2 border-[var(--color-border-subtle)] px-4 py-2.5 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] sm:w-auto btn-press chq-focus"
                      style={cairoFont}
                    >
                      {t('credits.requestWithdrawal')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-6 flex flex-col items-center py-8 text-center text-[var(--color-text-muted)]">
                  <span className="mb-3 text-4xl opacity-50" aria-hidden>
                    🪙
                  </span>
                  <p className="font-medium text-[var(--color-text-secondary)]" style={cairoFont}>
                    {t('credits.empty')}
                  </p>
                  <p className="mt-2 max-w-sm text-sm" style={cairoFont}>
                    {t('credits.earnTip')}
                  </p>
                </div>
              )}
            </section>

            {/* SECTION 4: WITHDRAWAL */}
            <section
              ref={withdrawalSectionRef}
              id="billing-withdrawal"
              className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6 shadow-sm"
              aria-labelledby="billing-withdrawal-heading"
            >
              {availableCredits < 2000 ? (
                <p className="text-sm text-[var(--color-text-muted)]" style={cairoFont}>
                  {t('withdrawal.insufficientNote', { amount: formatNum(availableCredits) })}
                </p>
              ) : (
                <>
                  <h2
                    id="billing-withdrawal-heading"
                    className="text-lg font-semibold text-[var(--color-text-primary)]"
                    style={cairoFont}
                  >
                    {t('withdrawal.title')}
                  </h2>
                  <div className="mt-4 rounded-xl bg-teal-50 p-4">
                    <p className="font-semibold text-[var(--color-text-primary)]" style={cairoFont}>
                      {t('withdrawal.rate')}
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-text-secondary)]" style={cairoFont}>
                      {t('withdrawal.fee')}
                    </p>
                  </div>

                  {String(center?.instapay_number ?? '').trim() ? (
                    <p className="mt-4 text-sm text-[var(--color-text-secondary)]" style={cairoFont}>
                      {t('withdrawal.instapaySet', { number: maskInstapay(center?.instapay_number) })}
                    </p>
                  ) : (
                    <div
                      className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                      style={cairoFont}
                    >
                      <p>{t('withdrawal.noInstapay')}</p>
                      <Link
                        href="/settings"
                        className="mt-2 inline-block font-semibold hover:underline"
                        style={{ color: 'var(--color-brand-500)' }}
                      >
                        {t('withdrawal.settingsLink')}
                      </Link>
                    </div>
                  )}

                  <div className="mt-4">
                    {withdrawalWindowOpen ? (
                      <span
                        className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900"
                        style={cairoFont}
                      >
                        {t('withdrawal.windowOpen')}
                      </span>
                    ) : (
                      <div className="space-y-1">
                        <span
                          className="inline-block rounded-full bg-[var(--color-surface-2)] px-3 py-1 text-xs font-semibold text-[var(--color-text-primary)]"
                          style={cairoFont}
                        >
                          {t('withdrawal.windowClosed', { date: nextWithdrawalWindowLabel })}
                        </span>
                        <p className="text-xs text-[var(--color-text-muted)]" style={cairoFont}>
                          {t('withdrawal.quarterly')}
                        </p>
                      </div>
                    )}
                  </div>

                  {withdrawalSuccess ? (
                    <div
                      className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
                      style={cairoFont}
                    >
                      <p className="font-semibold">{t('withdrawal.successTitle')}</p>
                      <p className="mt-2">
                        {t('withdrawal.successAmount', {
                          amount: formatNum(withdrawalSuccess.cashAmount),
                          number: withdrawalSuccess.instapay,
                        })}
                      </p>
                      <p className="mt-1">
                        {t('withdrawal.successDate', {
                          date: formatDateLocale(`${withdrawalSuccess.processingDate}T12:00:00`, locale, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          }),
                        })}
                      </p>
                    </div>
                  ) : null}

                  {withdrawalError ? (
                    <p className="mt-3 text-sm text-red-600" role="alert">
                      {withdrawalError}
                    </p>
                  ) : null}

                  {String(center?.instapay_number ?? '').trim() && withdrawalWindowOpen ? (
                    <div className="mt-6 space-y-3">
                      <label className="block text-sm font-medium text-[var(--color-text-secondary)]" style={cairoFont}>
                        {t('withdrawal.amountLabel')}
                      </label>
                      <input
                        type="number"
                        min={2000}
                        step={100}
                        max={availableCredits}
                        value={withdrawAmount}
                        onChange={(e) => {
                          setWithdrawalSuccess(null);
                          setWithdrawAmount(Number(e.target.value));
                        }}
                        className="w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-4 py-2.5 text-[var(--color-text-primary)] tabular-nums"
                      />
                      <p className="text-sm text-[var(--color-text-secondary)]" style={cairoFont}>
                        {t('withdrawal.youReceive', {
                          amount: formatNum(Math.max(0, withdrawAmount) / 2),
                        })}
                      </p>
                      <p className="text-sm text-[var(--color-text-secondary)]" style={cairoFont}>
                        {t('withdrawal.platformFee', {
                          amount: formatNum(Math.max(0, withdrawAmount) / 2),
                        })}
                      </p>
                      <button
                        type="button"
                        disabled={
                          withdrawalSubmitting ||
                          Math.floor(Number(withdrawAmount)) < 2000 ||
                          !withdrawalWindowOpen ||
                          !String(center?.instapay_number ?? '').trim()
                        }
                        onClick={() => void handleWithdrawalSubmit()}
                        className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-50 btn-press chq-focus"
                        style={{ backgroundColor: 'var(--color-brand-500)' }}
                      >
                        {withdrawalSubmitting ? t('loadingShort') : t('withdrawal.submit')}
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </section>

        {showReactivation && reactivationCalc && center?.suspended_at ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
            <div
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="reactivation-title"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 id="reactivation-title" className="text-lg font-bold text-[var(--color-text-primary)]" style={cairoFont}>
                  {t('reactivation.title')}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowReactivation(false)}
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] btn-press chq-focus"
                  aria-label={t('close')}
                >
                  ✕
                </button>
              </div>
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]" style={cairoFont}>
                {t('reactivation.suspendedSince', {
                  date: formatDateLocale(center.suspended_at, locale),
                })}
              </p>
              <div className="mt-3">
                <span
                  className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                    reactivationCalc.tier === 'tier1'
                      ? 'bg-amber-100 text-amber-900'
                      : 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)]'
                  }`}
                  style={cairoFont}
                >
                  {reactivationCalc.tier === 'tier1' ? t('reactivation.tier1') : t('reactivation.tier2')}
                </span>
              </div>
              <div className="mt-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] p-4">
                {reactivationCalc.tier === 'tier1' ? (
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between gap-2">
                      <dt style={cairoFont}>{t('reactivation.fine')}</dt>
                      <dd className="tabular-nums font-medium" style={numFont}>
                        {formatNum(Math.round(reactivationCalc.fine * 100) / 100)} {t('egp')}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt style={cairoFont}>{t('reactivation.nextPeriod')}</dt>
                      <dd className="tabular-nums font-medium" style={numFont}>
                        {formatNum(reactivationCalc.nextPeriod)} {t('egp')}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between gap-2">
                      <dt style={cairoFont}>{t('reactivation.fee')}</dt>
                      <dd className="tabular-nums font-medium" style={numFont}>
                        {formatNum(Math.round(reactivationCalc.reactivationFee * 100) / 100)} {t('egp')}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt style={cairoFont}>{t('reactivation.nextPeriod')}</dt>
                      <dd className="tabular-nums font-medium" style={numFont}>
                        {formatNum(reactivationCalc.nextPeriod)} {t('egp')}
                      </dd>
                    </div>
                  </dl>
                )}
                <div className="mt-3 flex justify-between border-t border-[var(--color-border-subtle)] pt-3">
                  <span className="font-semibold text-[var(--color-text-primary)]" style={cairoFont}>
                    {t('reactivation.total')}
                  </span>
                  <span className="tabular-nums font-bold text-[var(--color-text-primary)]" style={numFont}>
                    {formatNum(reactivationCalc.total)} {t('egp')}
                  </span>
                </div>
              </div>
              {Number(center?.credit_balance ?? 0) > 0 ? (
                <label className="mt-4 flex cursor-pointer items-center gap-3 text-sm text-[var(--color-text-secondary)]">
                  <input
                    type="checkbox"
                    checked={useCredits}
                    onChange={(e) => setUseCredits(e.target.checked)}
                    className="size-4 rounded border-[var(--color-border-subtle)] text-teal-600"
                  />
                  <span style={cairoFont}>
                    {t('reactivation.useCredits', {
                      amount: formatNum(Number(center?.credit_balance ?? 0)),
                    })}
                  </span>
                </label>
              ) : null}
              {useCredits && Number(center?.credit_balance ?? 0) > 0 ? (
                <div className="mt-2 rounded-lg bg-teal-50 px-3 py-2 text-sm">
                  <p className="text-[var(--color-text-secondary)]" style={cairoFont}>
                    {t('reactivation.creditApplied')}: −
                    {formatNum(Math.min(Number(center?.credit_balance ?? 0), reactivationCalc.total))}{' '}
                    {t('egp')}
                  </p>
                  <p className="text-[var(--color-text-secondary)]" style={cairoFont}>
                    {t('reactivation.viaPay')}:{' '}
                    <span className="tabular-nums font-semibold" style={numFont}>
                      {formatNum(
                        Math.max(
                          0,
                          reactivationCalc.total -
                            Math.min(Number(center?.credit_balance ?? 0), reactivationCalc.total),
                        ),
                      )}{' '}
                      {t('egp')}
                    </span>
                  </p>
                </div>
              ) : null}
              {reactivationError ? (
                <p className="mt-2 text-sm text-red-600" role="alert">
                  {reactivationError}
                </p>
              ) : null}
              <button
                type="button"
                disabled={reactivationLoading}
                onClick={() => void handleReactivationPay()}
                className="mt-6 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-50 btn-press chq-focus"
                style={{ backgroundColor: 'var(--color-brand-500)' }}
              >
                {reactivationLoading ? t('loadingShort') : t('reactivation.proceed')}
              </button>
            </div>
          </div>
        ) : null}

        {/* SECTION 5: WA PACK */}
        <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]" style={cairoFont}>
              {t('pack.title')}
            </h2>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${badge.cls}`}>{badge.label}</span>
          </div>

          {packEnabled || packReq === 'approved' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <span className="text-sm text-[var(--color-text-muted)]" style={cairoFont}>
                  {t('pack.pricePerParent')}
                </span>
                <span className="tabular-nums font-semibold text-[var(--color-text-primary)]" style={numFont}>
                  {formatNum(packPrice)} {t('egp')}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-[var(--color-text-muted)]" style={cairoFont}>
                  {t('pack.suggestedResale')}
                </span>
                <span className="tabular-nums font-semibold text-[var(--color-text-primary)]" style={numFont}>
                  {t('pack.suggestedResalePerMonth', { amount: formatNum(SUGGESTED_RESALE_EGP) })}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-[var(--color-text-muted)]" style={cairoFont}>
                  {t('pack.yourProfit')}
                </span>
                <span className="tabular-nums font-semibold text-[var(--color-text-primary)]" style={numFont}>
                  {formatNum(profitPerParent)} {t('egp')}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-[var(--color-text-muted)]" style={cairoFont}>
                  {t('pack.subscribedParents')}
                </span>
                <span className="tabular-nums font-semibold text-[var(--color-text-primary)]" style={numFont}>
                  {formatNum(packParents)}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-[var(--color-text-muted)]" style={cairoFont}>
                  {t('pack.monthlyCost')}
                </span>
                <span className="tabular-nums font-semibold text-[var(--color-text-primary)]" style={numFont}>
                  {formatNum(monthlyPackCost)} {t('egp')}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-[var(--color-text-muted)]" style={cairoFont}>
                  {t('pack.announcementBalance')}
                </span>
                <span className="tabular-nums font-semibold text-[var(--color-text-primary)]" style={numFont}>
                  {formatNum(announcementBal)} {t('egp')}
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] p-5">
              <p className="text-sm text-[var(--color-text-secondary)]" style={cairoFont}>
                {t('pack.enableDescription')}
              </p>
              {packReq === 'pending' ? (
                <p className="mt-3 text-sm font-medium text-amber-700" style={cairoFont}>
                  {t('pack.pendingApproval')}
                </p>
              ) : (
                <button
                  type="button"
                  disabled={!ownerOk || packRequestLoading}
                  onClick={() => void handlePackRequest()}
                  className="mt-4 w-full rounded-xl border-2 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50 md:w-auto btn-press chq-focus"
                  style={{ borderColor: 'var(--color-brand-500)', backgroundColor: 'var(--color-brand-500)' }}
                >
                  {packRequestLoading ? t('loadingShort') : t('pack.request')}
                </button>
              )}
            </div>
          )}
        </section>

        {/* SECTION 6: INVOICE HISTORY */}
        <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]" style={cairoFont}>
            {t('history.title')}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]" style={cairoFont}>
            {t('history.subtitle')}
          </p>

          {filteredInvoices.length === 0 ? (
            <div className="mt-8 flex flex-col items-center justify-center py-10 text-center text-[var(--color-text-muted)]">
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
                      : tCommon('notSet');
                  const ref = inv.invoice_number ?? inv.id.slice(0, 8);
                  return (
                    <div
                      key={inv.id}
                      className="rounded-xl border border-[var(--color-border-subtle)] p-4"
                    >
                      <div className="flex justify-between gap-2 text-sm">
                        <span className="text-[var(--color-text-muted)]">{t('history.date')}</span>
                        <span className="tabular-nums text-[var(--color-text-primary)]" style={numFont}>
                          {inv.created_at
                            ? formatDateLocale(inv.created_at, locale)
                            : tCommon('notSet')}
                        </span>
                      </div>
                      <div className="mt-2 flex justify-between gap-2 text-sm">
                        <span className="text-[var(--color-text-muted)]">{t('history.reference')}</span>
                        <span className="font-mono text-[var(--color-text-primary)]">{ref}</span>
                      </div>
                      <div className="mt-2 flex justify-between gap-2 text-sm">
                        <span className="text-[var(--color-text-muted)]">{t('history.amount')}</span>
                        <span className="inline-flex items-center tabular-nums" style={numFont}>
                          {formatNum(Number(inv.total_amount ?? 0))} {t('egp')}
                          {invoiceProcessingFee(inv) > 0 ? (
                            <ProcessingFeeInfoButton amount={invoiceProcessingFee(inv)} />
                          ) : null}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-[var(--color-text-muted)]">{periodStr}</div>
                      <div className="mt-2">{renderInvoiceStatusBadge(st)}</div>
                      <div className="mt-3">{renderInvoiceActionCell(inv, st)}</div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 hidden overflow-x-auto md:block">
                <table className="w-full min-w-[640px] border-collapse text-start text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)] text-[var(--color-text-muted)]">
                      <th className="py-2 pe-4 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]" style={cairoFont}>
                        {t('history.date')}
                      </th>
                      <th className="py-2 pe-4 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]" style={cairoFont}>
                        {t('history.reference')}
                      </th>
                      <th className="py-2 pe-4 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]" style={cairoFont}>
                        {t('history.amount')}
                      </th>
                      <th className="py-2 pe-4 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]" style={cairoFont}>
                        {t('history.period')}
                      </th>
                      <th className="py-2 pe-4 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]" style={cairoFont}>
                        {t('history.status')}
                      </th>
                      <th className="py-2 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]" style={cairoFont}>
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
                          : tCommon('notSet');
                      const ref = inv.invoice_number ?? inv.id.slice(0, 8);
                      return (
                        <tr key={inv.id} className="border-b border-[var(--color-border-subtle)]">
                          <td className="py-3 pe-4 tabular-nums text-[var(--color-text-primary)]" style={numFont}>
                            {inv.created_at
                              ? formatDateLocale(inv.created_at, locale)
                              : tCommon('notSet')}
                          </td>
                          <td className="py-3 pe-4 font-mono text-[var(--color-text-primary)]">{ref}</td>
                          <td className="py-3 pe-4 tabular-nums text-[var(--color-text-primary)]" style={numFont}>
                            <span className="inline-flex items-center">
                              {formatNum(Number(inv.total_amount ?? 0))} {t('egp')}
                              {invoiceProcessingFee(inv) > 0 ? (
                                <ProcessingFeeInfoButton amount={invoiceProcessingFee(inv)} />
                              ) : null}
                            </span>
                          </td>
                          <td className="py-3 pe-4 text-xs text-[var(--color-text-muted)]">{periodStr}</td>
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
        <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]" style={cairoFont}>
            {t('planHistory.title')}
          </h2>
          {planRequests.length === 0 ? (
            <div className="mt-8 flex flex-col items-center py-10 text-center text-[var(--color-text-muted)]">
              <p style={cairoFont}>{t('planHistory.empty')}</p>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[480px] text-start text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)] text-[var(--color-text-muted)]">
                    <th className="py-2 pe-4 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]" style={cairoFont}>
                      {t('planHistory.date')}
                    </th>
                    <th className="py-2 pe-4 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]" style={cairoFont}>
                      {t('planHistory.from')}
                    </th>
                    <th className="py-2 pe-4 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]" style={cairoFont}>
                      {t('planHistory.to')}
                    </th>
                    <th className="py-2 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]" style={cairoFont}>
                      {t('planHistory.status')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {planRequests.map((req) => (
                    <tr key={req.id} className="border-b border-[var(--color-border-subtle)]">
                      <td className="py-3 pe-4 tabular-nums text-[var(--color-text-secondary)]" style={numFont}>
                        {req.requested_at
                          ? formatDateLocale(req.requested_at, locale)
                          : tCommon('notSet')}
                      </td>
                      <td className="py-3 pe-4 text-[var(--color-text-primary)]">
                        {planLabelFromMessages(req.current_plan, tPlan)}
                      </td>
                      <td className="py-3 pe-4 text-[var(--color-text-primary)]">
                        {planLabelFromMessages(req.requested_plan, tPlan)}
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

        {ownerOk && centerStatusLower === 'pending_cancellation' ? (
          <section
            className="rounded-2xl border border-amber-300 bg-amber-50 p-6 shadow-sm"
            aria-labelledby="billing-pending-cancel-heading"
          >
            <h2
              id="billing-pending-cancel-heading"
              className="text-lg font-semibold text-amber-900"
              style={cairoFont}
            >
              {t('cancel.title')}
            </h2>
            <p className="mt-2 text-sm text-amber-900/90" style={cairoFont}>
              {t('cancel.pendingBanner', { date: billingPeriodEndLabel })}
            </p>
          </section>
        ) : null}

        {showCancelDanger ? (
          <section
            className="rounded-2xl border border-red-200 bg-red-50 p-6"
            aria-labelledby="billing-danger-heading"
          >
            <h2
              id="billing-danger-heading"
              className="text-lg font-semibold text-red-900"
              style={cairoFont}
            >
              {t('cancel.title')}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]" style={cairoFont}>
              {t('cancel.subtitle')}
            </p>
            <button
              type="button"
              onClick={() => {
                setCancelSubmitError(null);
                setShowCancelModal(true);
              }}
              className="mt-3 text-sm text-red-500 underline hover:text-red-600 btn-press chq-focus"
              style={cairoFont}
            >
              {t('cancel.link')}
            </button>
          </section>
        ) : null}
          </>
        ) : null}
      </div>

      {showCancelModal ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
          <div
            className="w-full max-w-md rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-modal-title"
          >
            <h2
              id="cancel-modal-title"
              className="text-lg font-bold text-[var(--color-text-primary)]"
              style={cairoFont}
            >
              {t('cancel.modalTitle')}
            </h2>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]" style={cairoFont}>
              {t('cancel.modalSubtitle')}
            </p>
            <label className="mt-4 block text-sm font-medium text-[var(--color-text-secondary)]" style={cairoFont}>
              {t('cancel.reasonLabel')}
            </label>
            <select
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
            >
              <option value="">{t('cancel.reasonPlaceholder')}</option>
              {CANCEL_REASON_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(`cancel.reason.${k}` as 'billing.cancel.reason.other')}
                </option>
              ))}
            </select>
            <label className="mt-4 block text-sm font-medium text-[var(--color-text-secondary)]" style={cairoFont}>
              {t('cancel.confirmLabel')}
            </label>
            {/* CANCEL confirm */}
            <input
              type="text"
              value={cancelConfirmText}
              onChange={(e) => setCancelConfirmText(e.target.value)}
              placeholder={t('cancel.confirmLabel')}
              className="mt-1 w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
              dir="ltr"
              autoComplete="off"
            />
            {cancelSubmitError ? (
              <p className="mt-2 text-sm text-red-600" role="alert">
                {cancelSubmitError}
              </p>
            ) : null}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowCancelModal(false);
                  setCancelSubmitError(null);
                  setCancelConfirmText('');
                }}
                className="order-2 rounded-xl border-2 border-teal-600 px-4 py-2.5 text-sm font-semibold text-teal-700 hover:bg-teal-50 sm:order-1 btn-press chq-focus"
                style={cairoFont}
              >
                {t('cancel.keep')}
              </button>
              <button
                type="button"
                disabled={
                  cancelSubmitting || !cancelReason || cancelConfirmText !== 'CANCEL'
                }
                onClick={() => void handleCancelSubscription()}
                className="order-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 sm:order-2 btn-press chq-focus"
                style={cairoFont}
              >
                {cancelSubmitting ? t('loadingShort') : t('cancel.submit')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {paymobUrl && (paymobSessionId || paymobInvoicePollId) ? (
        <PaymobModal
          iframeUrl={paymobUrl}
          sessionId={paymobSessionId}
          invoicePollId={paymobInvoicePollId}
          title={t('completePayment')}
          iframeTitle={t('paymobIframeTitle')}
          closeLabel={t('close')}
          onClose={closePaymob}
          onSuccess={onPaymobSuccess}
          onError={onPaymobError}
        />
      ) : null}
    </div>
  );
}
