'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
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
import { FEATURES } from '@/lib/features';
import {
  getUpgradeCost,
  getDailyRate,
  getUpgradeLimit,
  getReactivationTier,
  getReactivationAmount,
} from '@/lib/billingEngine';
import {
  calculatePaygBill,
  getWeeklyDisplayRate,
  PAYG_TIER_BREAKPOINTS,
  firstDayNextMonthCairoYmd,
} from '@/lib/paygBilling';
import {
  getTodayCairo,
  isWithdrawalWindowOpen,
  nextQuarterFirstOnOrAfter,
  nextProcessingQuarterStart,
} from '@/lib/cairoBillingCalendar';

const SUGGESTED_RESALE_EGP = 25;

const CANCEL_REASON_KEYS = [
  'moving_competitor',
  'too_expensive',
  'center_closing',
  'not_using',
  'other',
] as const;

type CenterPlanKey = 'nano' | 'starter' | 'pro' | 'business' | 'enterprise';

const CENTER_PLAN_KEYS: readonly CenterPlanKey[] = [
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
  monthly_fee?: number | string | null;
  all_in_price?: number | string | null;
  students_per_week_limit?: number | string | null;
};

function rowPlanKey(row: PricingPlanRow): string {
  return String(row.plan_key ?? row.id ?? '');
}

function pricingForPlan(
  planKey: string,
  rows: PricingPlanRow[],
): { allIn: number; monthlyFee: number; students: number } {
  const row = rows.find((r) => rowPlanKey(r) === planKey);
  if (row && row.all_in_price != null && Number(row.all_in_price) > 0) {
    const pk = isPlanKey(planKey) ? planKey : 'starter';
    const def = PLANS[pk];
    return {
      allIn: Number(row.all_in_price),
      monthlyFee: Number(row.monthly_fee ?? def.monthlyListPrice),
      students: Number(row.students_per_week_limit ?? def.weeklyStudentLimit ?? 0),
    };
  }
  const pk = isPlanKey(planKey) ? planKey : 'starter';
  const p = PLANS[pk];
  return {
    allIn: p.quarterlyAllIn,
    monthlyFee: p.monthlyListPrice,
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
  /** Monthly EGP per active student (billing); UI shows weekly via getWeeklyDisplayRate. */
  payg_rate?: number | string | null;
  payg_pending_switch?: string | null;
  payg_switch_effective_date?: string | null;
  payg_pending_target_period?: string | null;
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
  closeLabel,
  onClose,
  onSuccess,
  onError,
}: {
  iframeUrl: string;
  sessionId: string | null;
  invoicePollId: string | null;
  title: string;
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
      const res = await fetch(`/api/paymob/invoice-status?${qs}`);
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
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-slate-800/90 border border-slate-700">
        <div className="flex items-center border-b border-slate-200 px-4 py-3">
          <span className="font-semibold text-slate-800">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="ms-auto text-slate-500 hover:text-slate-800 btn-press chq-focus"
            aria-label={closeLabel}
          >
            ✕
          </button>
        </div>
        <iframe src={iframeUrl} className="h-[600px] w-full" title="Paymob" />
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
}: {
  nameAr: string;
  nameEn: string;
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
}) {
  const perStudent = studentLimit > 0 ? price / studentLimit : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border-2 p-4 text-start transition-shadow ${
        isSelected ? 'border-teal-600 ring-2 ring-teal-600/30' : 'border-slate-200 hover:border-slate-300'
      } dark:border-slate-600 btn-press chq-focus`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-900 dark:text-white" style={cairoFont}>
            {nameAr}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{nameEn}</p>
        </div>
        {isCurrent ? (
          <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-800 dark:bg-teal-900/40 dark:text-teal-200">
            {currentLabel}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300" style={cairoFont}>
        {studentsLine}
      </p>
      <p className="mt-1 tabular-nums text-lg font-semibold text-slate-900 dark:text-white" style={numFont}>
        {formatNum(price)} EGP / {period}
      </p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums" style={numFont}>
        {formatNum(Math.round(perStudent * 100) / 100)} EGP / student
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
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border-2 p-4 text-start transition-shadow ${
        isSelected ? 'border-teal-600 ring-2 ring-teal-600/30' : 'border-slate-200 hover:border-slate-300'
      } dark:border-slate-600 btn-press chq-focus`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-slate-900 dark:text-white" style={cairoFont}>
          {label}
        </span>
        {badge ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
            {badge}
          </span>
        ) : null}
      </div>
      {isCurrent ? (
        <p className="mt-1 text-xs font-medium text-teal-600 dark:text-teal-400">{currentLabel}</p>
      ) : null}
      <p className="mt-2 tabular-nums text-lg font-semibold text-slate-900 dark:text-white" style={numFont}>
        {formatNum(price)} EGP
      </p>
    </button>
  );
}

function PaygTab({
  t,
  toast,
  refresh,
  ownerOk,
  center,
  pricingRows,
  paygStudentCount,
  setPaygStudentCount,
  paygLeavePeriod,
  setPaygLeavePeriod,
  cairoFont,
  numFont,
  locale,
}: {
  t: (key: string, values?: Record<string, string | number | Date>) => string;
  toast: { success: (title: string, description?: string) => void; error: (title: string, description?: string) => void };
  refresh: () => void | Promise<void>;
  ownerOk: boolean;
  center: CenterRow | null;
  pricingRows: PricingPlanRow[];
  paygStudentCount: number;
  setPaygStudentCount: (n: number) => void;
  paygLeavePeriod: BillingPeriod;
  setPaygLeavePeriod: (p: BillingPeriod) => void;
  cairoFont: CSSProperties;
  numFont: CSSProperties;
  locale: string;
}) {
  const billingPayg =
    center?.billing_type === 'payg' || center?.pricing_type === 'payg';
  const pending = center?.payg_pending_switch ?? null;
  const pendingDate = center?.payg_switch_effective_date?.slice(0, 10) ?? '';
  const effectiveYmd = firstDayNextMonthCairoYmd();
  const effectiveLabel = (() => {
    const d = new Date(`${effectiveYmd}T12:00:00`);
    return Number.isNaN(d.getTime())
      ? effectiveYmd
      : d.toLocaleDateString('en-US');
  })();
  const { tier, cappedAmount, isCapped, capAmount } = calculatePaygBill(paygStudentCount);
  const pk = isPlanKey(tier.plan) ? tier.plan : 'starter';
  const pr = pricingForPlan(pk, pricingRows);
  const vsMonthly = pr.monthlyFee;
  const vsQuarterlyMo = pr.allIn;

  const postSwitch = async (body: Record<string, string>): Promise<boolean> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      toast.error(t('loadError'));
      return false;
    }
    const res = await fetch('/api/billing/switch-payg', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
    if (!res.ok) {
      toast.error(typeof data.error === 'string' ? data.error : t('paymentFailed'));
      return false;
    }
    await refresh();
    return true;
  };

  return (
    <div className="mt-6 space-y-6">
      {pending ? (
        <div
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
          style={cairoFont}
        >
          <p>
            {t('payg.switch.pending', {
              date: pendingDate
                ? new Date(`${pendingDate}T12:00:00`).toLocaleDateString(
                    'en-US',
                  )
                : effectiveLabel,
            })}
          </p>
          {ownerOk ? (
            <button
              type="button"
              className="mt-2 text-sm font-semibold text-amber-800 underline dark:text-amber-200 btn-press chq-focus"
              onClick={() => void postSwitch({ action: 'cancel' })}
            >
              {t('payg.switch.cancel')}
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className="rounded-2xl bg-teal-50 p-5 dark:bg-teal-900/20"
        style={cairoFont}
      >
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('payg.intro.title')}</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t('payg.intro.subtitle')}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-teal-900 dark:bg-teal-950/50 dark:text-teal-100">
            ✓ {t('payg.pill.noCommitment')}
          </span>
          <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-teal-900 dark:bg-teal-950/50 dark:text-teal-100">
            ✓ {t('payg.pill.cancelAnytime')}
          </span>
          <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-teal-900 dark:bg-teal-950/50 dark:text-teal-100">
            ✓ {t('payg.pill.endOfMonth')}
          </span>
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-semibold text-slate-800 dark:text-slate-100" style={cairoFont}>
          {t('payg.slider.label')}
        </label>
        <input
          type="range"
          min={1}
          max={2000}
          step={1}
          value={paygStudentCount}
          onChange={(e) => setPaygStudentCount(Number(e.target.value))}
          className="w-full accent-teal-600"
        />
        <p className="mt-2 text-2xl font-bold text-teal-700 dark:text-teal-300" style={numFont}>
          {t('payg.slider.students', { count: String(paygStudentCount) })}
        </p>
        <div className="relative mt-6 h-8 text-[10px] text-slate-500 dark:text-slate-400">
          {PAYG_TIER_BREAKPOINTS.map((b) => (
            <span
              key={b.plan}
              className="absolute -translate-x-1/2 text-center"
              style={{ left: `${(b.maxStudents / 2000) * 100}%` }}
            >
              <span
                className={tier.plan === b.plan ? 'font-bold text-teal-600' : ''}
                style={cairoFont}
              >
                {t(`planNames.${b.plan}` as 'billing.planNames.starter')}
              </span>
              <br />
              {b.maxStudents.toLocaleString('en-US')}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {PAYG_TIER_BREAKPOINTS.map((b) => {
          const active = tier.plan === b.plan;
          return (
            <div
              key={b.plan}
              className={`rounded-xl border p-3 text-center transition-all duration-200 ${
                active
                  ? 'scale-105 border-2 border-teal-600 bg-teal-50 dark:bg-teal-900/30'
                  : 'border border-slate-600 bg-slate-900/40'
              }`}
              style={cairoFont}
            >
              <p className={`text-xs font-semibold ${active ? 'text-teal-800 dark:text-teal-200' : 'text-slate-500'}`}>
                {t(`planNames.${b.plan}` as 'billing.planNames.starter')}
              </p>
              <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                {t(`payg.tierRange.${b.plan}` as 'billing.payg.tierRange.nano')}
              </p>
              <p className="mt-1 text-xs tabular-nums text-slate-700 dark:text-slate-200" style={numFont}>
                {b.weeklyDisplayRate.toLocaleString('en-US')} {t('payg.tier.rateUnit')}
              </p>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-slate-600 bg-slate-800/40 p-6 shadow-sm">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500" style={cairoFont}>
              {t('payg.estimate.students')}
            </dt>
            <dd className="font-medium tabular-nums" style={numFont}>
              {paygStudentCount}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500" style={cairoFont}>
              {t('payg.estimate.rate')}
            </dt>
            <dd className="tabular-nums" style={numFont}>
              {getWeeklyDisplayRate(tier.ratePerStudent).toLocaleString('en-US')}{' '}
              {t('payg.estimate.rateUnit')}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500" style={cairoFont}>
              {t('payg.estimate.tier')}
            </dt>
            <dd className="font-medium" style={cairoFont}>
              {t(`planNames.${tier.plan}` as 'billing.planNames.starter')}
            </dd>
          </div>
        </dl>
        <div className="my-3 border-t border-slate-200 dark:border-slate-600" />
        <p className="text-sm text-slate-500" style={cairoFont}>
          {t('payg.estimate.total')}
        </p>
        <p className="text-3xl font-bold text-teal-600 tabular-nums dark:text-teal-400" style={numFont}>
          {cappedAmount.toLocaleString('en-US')} {t('egp')}
        </p>
        {isCapped ? (
          <p className="mt-2 text-xs text-slate-500" style={cairoFont}>
            {t('payg.estimate.capped', { amount: capAmount.toLocaleString('en-US') })}
          </p>
        ) : null}
        <div className="mt-4 space-y-1 text-xs text-slate-600 dark:text-slate-300" style={cairoFont}>
          <p>
            {t('payg.estimate.vsMonthly')}:{' '}
            <span className="tabular-nums font-medium" style={numFont}>
              {vsMonthly.toLocaleString('en-US')} {t('egp')}
            </span>
          </p>
          <p>
            {t('payg.estimate.vsQuarterly')}:{' '}
            <span className="tabular-nums font-medium" style={numFont}>
              {vsQuarterlyMo.toLocaleString('en-US')} {t('egp')}
            </span>
          </p>
        </div>
      </div>

      {ownerOk && !pending ? (
        <div className="space-y-3">
          {!billingPayg ? (
            <>
              <button
                type="button"
                className="w-full rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 btn-press chq-focus"
                style={cairoFont}
                onClick={() =>
                  void postSwitch({ action: 'enable' }).then((ok) => {
                    if (ok) toast.success(t('payg.switch.scheduled', { date: effectiveLabel }));
                  })
                }
              >
                {t('payg.switch.enable')}
              </button>
              <p className="text-center text-xs text-slate-500" style={cairoFont}>
                {t('payg.switch.effectiveDate', { date: effectiveLabel })}
              </p>
            </>
          ) : (
            <>
              <p
                className="rounded-lg border border-teal-500/50 bg-teal-50 px-3 py-2 text-center text-sm font-semibold text-teal-900 dark:bg-teal-950/40 dark:text-teal-100"
                style={cairoFont}
              >
                {t('payg.switch.active')}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <select
                  value={paygLeavePeriod}
                  onChange={(e) => setPaygLeavePeriod(e.target.value as BillingPeriod)}
                  className="rounded-xl border border-slate-600 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
                  style={cairoFont}
                >
                  <option value="monthly">{t('period.monthly.label')}</option>
                  <option value="quarterly">{t('period.quarterly.label')}</option>
                  <option value="annual">{t('period.annual.label')}</option>
                </select>
                <button
                  type="button"
                  className="w-full rounded-xl border-2 border-slate-400 px-4 py-3 text-sm font-semibold text-slate-800 dark:border-slate-500 dark:text-slate-100 sm:flex-1 btn-press chq-focus"
                  style={cairoFont}
                  onClick={() =>
                    void postSwitch({
                      action: 'disable',
                      newPeriod: paygLeavePeriod,
                    }).then((ok) => {
                      if (ok) toast.success(t('payg.switch.fixedScheduled', { date: effectiveLabel }));
                    })
                  }
                >
                  {t('payg.switch.disable')}
                </button>
              </div>
              <p className="text-center text-xs text-slate-500" style={cairoFont}>
                {t('payg.switch.effectiveDate', { date: effectiveLabel })}
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function BillingPage() {
  const t = useTranslations('billing');
  const tToast = useTranslations('toasts');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const { toast } = useToast();

  const [center, setCenter] = useState<CenterRow | null>(null);
  const [userRole, setUserRole] = useState<string>('');
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [planRequests, setPlanRequests] = useState<PlanRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [packRequestLoading, setPackRequestLoading] = useState(false);
  const [paymobUrl, setPaymobUrl] = useState<string | null>(null);
  const [paymobSessionId, setPaymobSessionId] = useState<string | null>(null);
  const [paymobInvoicePollId, setPaymobInvoicePollId] = useState<string | null>(null);
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);
  const [pricingRows, setPricingRows] = useState<PricingPlanRow[]>([]);
  const [activeTab, setActiveTab] = useState<'upgrade' | 'downgrade' | 'payg'>('upgrade');
  const [paygStudentCount, setPaygStudentCount] = useState(50);
  const [paygLeavePeriod, setPaygLeavePeriod] = useState<BillingPeriod>('quarterly');
  const [activeStudentCount, setActiveStudentCount] = useState(0);
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
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t, tToast, toast]);

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
    if (userRole !== 'owner') return;
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

  const ownerOk = userRole === 'owner';

  const planKey: PlanKey = useMemo(() => {
    const p = center?.plan ?? 'starter';
    return isPlanKey(p) ? p : 'starter';
  }, [center?.plan]);

  const bp = useMemo(
    () => normalizeBillingPeriod(center?.subscription_billing_period ?? center?.billing_period),
    [center?.subscription_billing_period, center?.billing_period],
  );

  const billingIsPayg = useMemo(
    () => center?.billing_type === 'payg' || center?.pricing_type === 'payg',
    [center?.billing_type, center?.pricing_type],
  );

  const billingRateContext = useMemo(
    () =>
      center
        ? { billing_type: center.billing_type, pricing_type: center.pricing_type }
        : undefined,
    [center?.billing_type, center?.pricing_type],
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
      : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
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
    (billingIsPayg ? true : (bsLower === 'paid' || bsLower === 'active') && !isOverdue);

  useEffect(() => {
    const cid = center?.id;
    if (!cid) return;
    let cancelled = false;
    void (async () => {
      const { count, error } = await supabase
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('center_id', cid)
        .eq('is_active', true);
      if (cancelled || error) return;
      const n = Number(count ?? 0);
      setActiveStudentCount(n);
      if (billingIsPayg && n > 0) {
        setPaygStudentCount((prev) => (prev === 50 ? Math.min(2000, Math.max(1, n)) : prev));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [center?.id, billingIsPayg]);

  const paygHeroEstimate = useMemo(
    () => calculatePaygBill(Math.max(1, activeStudentCount || paygStudentCount)).cappedAmount,
    [activeStudentCount, paygStudentCount],
  );

  const paygMonthlyRateForHero = useMemo(() => {
    const fromDb = Number(center?.payg_rate);
    if (billingIsPayg && Number.isFinite(fromDb) && fromDb > 0) {
      return fromDb;
    }
    return calculatePaygBill(Math.max(1, activeStudentCount || paygStudentCount)).tier.ratePerStudent;
  }, [
    billingIsPayg,
    center?.payg_rate,
    activeStudentCount,
    paygStudentCount,
  ]);

  const paygHeroWeeklyDisplay = useMemo(
    () => getWeeklyDisplayRate(paygMonthlyRateForHero),
    [paygMonthlyRateForHero],
  );

  const billingPeriodEndLabel = useMemo(() => {
    const ymd =
      (center?.current_period_end && String(center.current_period_end).slice(0, 10)) ||
      (center?.next_payment_due ? center.next_payment_due.slice(0, 10) : '');
    if (!ymd) return tCommon('notSet');
    const d = new Date(`${ymd}T12:00:00`);
    return Number.isNaN(d.getTime())
      ? ymd
      : d.toLocaleDateString('en-US');
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
    if (cp === 'nano') return [];
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
      quarterly: getChargeFromQuarterlyAllIn(allIn, 'quarterly', pk),
      annual: getChargeFromQuarterlyAllIn(allIn, 'annual', pk),
    };
  }, [periodRefKey, periodRefPricing.allIn]);

  useEffect(() => {
    if (activeTab !== 'upgrade' || billingIsPayg || !selectedPeriod || !selectedPlan || !npdYmd) {
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
    billingIsPayg,
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
      billingIsPayg ||
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
    const currentDaily = getDailyRate(currentPeriodPrice, bp, billingRateContext);
    const newDaily = getDailyRate(newPeriodPrice, selectedPeriod as BillingPeriod, billingRateContext);
    const earned = Math.round(Math.max(0, (currentDaily - newDaily) * remainingDays) * 100) / 100;
    return { currentDaily, newDaily, remainingDays, earned };
  }, [
    activeTab,
    billingIsPayg,
    selectedPeriod,
    selectedPlan,
    npdYmd,
    center,
    bp,
    planKey,
    pricingRows,
    billingRateContext,
  ]);

  const reactivationCalc = useMemo(() => {
    if (billingIsPayg) return null;
    const ba = Number(center?.billing_amount ?? 0);
    if (!center?.suspended_at || !Number.isFinite(ba) || ba <= 0) return null;
    const tier = getReactivationTier(new Date(center.suspended_at));
    const dailyRate = getDailyRate(ba, bp, billingRateContext);
    const calc = getReactivationAmount({ tier, nextPeriodAmount: ba, dailyRate });
    return { tier, ...calc, nextPeriodAmount: ba, dailyRate };
  }, [center?.suspended_at, center?.billing_amount, bp, billingIsPayg, billingRateContext]);

  const upgradeUsed = Number(center?.upgrade_count_this_period ?? 0);
  const upgradeLimit = getUpgradeLimit(bp);
  const upgradeLimitReached = upgradeUsed >= upgradeLimit;

  const handleUpgradePay = async () => {
    if (!selectedPlan || !selectedPeriod || !FEATURES.PAYMOB_ENABLED) {
      if (!FEATURES.PAYMOB_ENABLED) toast.info(t('history.payDisabled'));
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
    if (viaPayPreview > 0 && !FEATURES.PAYMOB_ENABLED) {
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
    return { cls: 'border-white/30 bg-white/10 text-white', label: t('status.active'), icon: null };
  }, [bsLower, subLower, isSuspendedCenter, t]);

  const invoiceStatusDisplay = (raw: string | null | undefined) => {
    const v = (raw ?? '').toLowerCase();
    if (v === 'paid' || v === 'approved') return t('status.paid');
    if (v === 'pending') return t('status.pending');
    if (v === 'overdue') return t('status.overdue');
    if (v === 'cancelled' || v === 'canceled') return t('status.cancelled');
    return raw || tCommon('notSet');
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

  const openInvoicePdf = useCallback(
    async (e: MouseEvent<HTMLAnchorElement>, invoiceId: string) => {
      e.preventDefault();
      if (!ownerOk) return;
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
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(typeof j.error === 'string' ? j.error : t('paymentFailed'));
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const opened = window.open(url, '_blank', 'noopener,noreferrer');
        if (!opened) {
          toast.error(t('loadError'));
          URL.revokeObjectURL(url);
          return;
        }
        setTimeout(() => URL.revokeObjectURL(url), 120_000);
      } catch {
        toast.error(t('paymentFailed'));
      }
    },
    [ownerOk, toast, t],
  );

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
      const res = await fetch('/api/billing/withdrawal', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
          ? new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US')
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
        <span className={`${base} bg-slate-800 text-slate-400`} style={cairoFont}>
          {t('status.cancelled')}
        </span>
      );
    }
    return (
      <span className={`${base} bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300`} style={cairoFont}>
        {st || tCommon('notSet')}
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
          className="rounded-lg border-2 px-3 py-1.5 text-xs font-semibold disabled:opacity-50 btn-press chq-focus"
          style={{ borderColor: '#0D9488', color: '#0D9488' }}
        >
          {payingInvoiceId === inv.id ? t('loadingShort') : t('history.payNow')}
        </button>
      );
    }
    if (st === 'paid' || st === 'approved') {
      if (!ownerOk) {
        return (
          <span className="text-slate-600 text-xs" aria-hidden>
            -
          </span>
        );
      }
      return (
        <a
          href={`/api/invoices/${inv.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => void openInvoicePdf(e, inv.id)}
          className="inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-[#0D9488] hover:bg-teal-50 dark:border-slate-600 dark:hover:bg-teal-950/30"
        >
          {t('history.downloadPdf')}
        </a>
      );
    }
    if (st === 'cancelled' || st === 'canceled') {
      return (
        <span className="text-slate-600 text-xs" aria-hidden>
          -
        </span>
      );
    }
    return (
      <span className="text-slate-600 text-xs" aria-hidden>
        -
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen w-full bg-[#080D14] p-4 pb-10 md:p-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <div className="h-10 w-48 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
          <div className="h-56 animate-pulse rounded-2xl bg-gradient-to-br from-teal-200 to-slate-300 dark:from-teal-900/40 dark:to-slate-800" />
          <div className="h-48 animate-pulse rounded-2xl bg-slate-800/40" />
          <div className="h-64 animate-pulse rounded-2xl bg-slate-800/40" />
          <div className="h-48 animate-pulse rounded-2xl bg-slate-800/40" />
        </div>
      </div>
    );
  }

  const badge = packHeaderBadge();

  return (
    <div
      className="min-h-screen w-full bg-[#080D14] p-4 pb-10 text-slate-100 md:p-8"
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
                {locale === 'ar' && (
                  <p className="mt-1 text-sm opacity-70" style={cairoFont}>
                    {secondaryPlanName}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    billingIsPayg
                      ? 'border border-teal-200 text-teal-100'
                      : 'text-white'
                  }`}
                  style={
                    billingIsPayg
                      ? { backgroundColor: 'rgba(13,148,136,0.25)' }
                      : { backgroundColor: 'rgba(255,255,255,0.2)' }
                  }
                >
                  {billingIsPayg ? t('payg.hero.badge') : `${t('billingPeriod')}: ${t(`period.${bp}.label` as 'billing.period.monthly.label')}`}
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
                {billingIsPayg ? t('payg.hero.rate') : t('currentPlan.monthlyPrice')}
              </span>
              <span className="text-lg font-semibold tabular-nums text-white" style={numFont}>
                {billingIsPayg
                  ? `${formatNum(paygHeroWeeklyDisplay)} ${t('payg.estimate.rateUnit')}`
                  : `${formatNum(Number(center?.all_in_price ?? 0))} ${t('egp')}`}
              </span>
            </div>
            <div className="flex flex-col gap-1 border-b border-white/15 py-4 md:border-b-0 md:border-e md:py-3 md:px-4">
              <span className="text-xs font-medium uppercase tracking-wide text-teal-100/90" style={cairoFont}>
                {billingIsPayg ? t('payg.hero.billingDate') : t('currentPlan.nextPayment')}
              </span>
              <span className="text-lg font-semibold tabular-nums text-white" style={numFont}>
                {billingIsPayg
                  ? t('payg.hero.billingDateValue')
                  : npdYmd
                    ? new Date(`${npdYmd}T12:00:00`).toLocaleDateString('en-US')
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

          {billingIsPayg ? (
            <div
              className="mt-4 grid grid-cols-1 gap-2 border-t border-white/10 pt-4 text-sm text-teal-50 md:grid-cols-2"
              style={cairoFont}
            >
              <p>
                <span className="opacity-80">{t('payg.hero.activeStudents')}: </span>
                <span className="font-semibold tabular-nums" style={numFont}>
                  {activeStudentCount}
                </span>
              </p>
              <p>
                <span className="opacity-80">{t('payg.hero.estimate')}: </span>
                <span className="font-semibold tabular-nums text-white" style={numFont}>
                  {paygHeroEstimate.toLocaleString('en-US')} {t('egp')}
                </span>
              </p>
            </div>
          ) : null}

          {showSuspendBanner && (
            <div
              className="mt-4 flex flex-col gap-3 rounded-xl border border-red-400/50 bg-red-950/40 px-4 py-3 text-sm text-red-50 dark:bg-red-950/60"
              style={cairoFont}
            >
              <p className="flex items-start gap-2">
                <span aria-hidden>⚠️</span>
                <span>{t('currentPlan.overdue')}</span>
              </p>
              {ownerOk && isSuspendedCenter ? (
                <button
                  type="button"
                  className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-sm md:w-auto btn-press chq-focus"
                  style={{ backgroundColor: '#F59E0B' }}
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
            className="rounded-2xl border border-slate-700 bg-slate-800/40 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800"
            aria-labelledby="billing-plan-change-heading"
          >
            <h2
              id="billing-plan-change-heading"
              className="text-lg font-semibold text-slate-900 dark:text-white"
              style={cairoFont}
            >
              {activeTab === 'upgrade'
                ? t('upgrade.title')
                : activeTab === 'downgrade'
                  ? t('downgrade.title')
                  : t('payg.tabLabel')}
            </h2>
            <div className="mt-4 flex flex-wrap gap-4 border-b border-slate-200 dark:border-slate-600">
              <button
                type="button"
                onClick={() => setActiveTab('upgrade')}
                className={`pb-2 ps-1 pe-1 text-sm ${
                  activeTab === 'upgrade'
                    ? 'border-b-2 border-teal-600 font-semibold text-teal-600'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
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
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                } btn-press chq-focus`}
                style={cairoFont}
              >
                {t('downgrade.title')}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('payg')}
                className={`pb-2 ps-1 pe-1 text-sm ${
                  activeTab === 'payg'
                    ? 'border-b-2 border-teal-600 font-semibold text-teal-600'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                } btn-press chq-focus`}
                style={cairoFont}
              >
                {t('payg.tabLabel')}
              </button>
            </div>

            {activeTab === 'payg' ? (
              <PaygTab
                t={t}
                toast={toast}
                refresh={refresh}
                ownerOk={ownerOk}
                center={center}
                pricingRows={pricingRows}
                paygStudentCount={paygStudentCount}
                setPaygStudentCount={setPaygStudentCount}
                paygLeavePeriod={paygLeavePeriod}
                setPaygLeavePeriod={setPaygLeavePeriod}
                cairoFont={cairoFont}
                numFont={numFont}
                locale={locale}
              />
            ) : null}

            {activeTab === 'upgrade' && billingIsPayg ? (
              <p className="mt-6 text-sm text-slate-600 dark:text-slate-300" style={cairoFont}>
                {t('payg.switch.active')} - {t('payg.tabLabel')}
              </p>
            ) : null}

            {activeTab === 'downgrade' && billingIsPayg ? (
              <p className="mt-6 text-sm text-slate-600 dark:text-slate-300" style={cairoFont}>
                {t('payg.switch.disable')} - {t('payg.tabLabel')}
              </p>
            ) : null}

            {activeTab === 'upgrade' && !billingIsPayg ? (
              <div className="mt-6 space-y-6">
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-300" style={cairoFont}>
                    {t('upgrade.usedOf', { used: String(upgradeUsed), limit: String(upgradeLimit) })}
                  </p>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div
                      className="h-2 rounded-full bg-teal-600 transition-all"
                      style={{
                        inlineSize: `${Math.min(100, upgradeLimit ? (upgradeUsed / upgradeLimit) * 100 : 0)}%`,
                      }}
                    />
                  </div>
                  {upgradeLimitReached ? (
                    <p className="mt-2 text-sm text-amber-700 dark:text-amber-300" style={cairoFont}>
                      {t('upgrade.limitReached')}
                      {npdYmd
                        ? ` - ${new Date(`${npdYmd}T12:00:00`).toLocaleDateString('en-US')}`
                        : ''}
                    </p>
                  ) : null}
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100" style={cairoFont}>
                    {t('upgrade.choosePeriod')}
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <PeriodCard
                      label={t('period.monthly.label')}
                      price={periodPrices.monthly}
                      isSelected={selectedPeriod === 'monthly'}
                      isCurrent={bp === 'monthly'}
                      badge={t('upgrade.monthlyPremiumHint')}
                      currentLabel={t('upgrade.currentPeriod')}
                      onClick={() => {
                        setSelectedPeriod('monthly');
                        setSelectedPlan('');
                      }}
                      cairoFont={cairoFont}
                      numFont={numFont}
                    />
                    <PeriodCard
                      label={t('period.quarterly.label')}
                      price={periodPrices.quarterly}
                      isSelected={selectedPeriod === 'quarterly'}
                      isCurrent={bp === 'quarterly'}
                      badge={t('upgrade.quarterlyDefaultHint')}
                      currentLabel={t('upgrade.currentPeriod')}
                      onClick={() => {
                        setSelectedPeriod('quarterly');
                        setSelectedPlan('');
                      }}
                      cairoFont={cairoFont}
                      numFont={numFont}
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
                    />
                  </div>
                </div>

                {selectedPeriod ? (
                  <div
                    className={`transition-opacity duration-300 ${selectedPeriod ? 'opacity-100' : 'opacity-0'}`}
                  >
                    <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100" style={cairoFont}>
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
                        const periodLabel =
                          selectedPeriod === 'monthly'
                            ? t('perMonth')
                            : selectedPeriod === 'annual'
                              ? t('perYear')
                              : t('perQuarter');
                        return (
                          <PlanCard
                            key={pk}
                            nameAr={t(`planNames.${pk}` as 'billing.planNames.starter')}
                            nameEn={PLANS[pk].englishName}
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
                          />
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {selectedPeriod && selectedPlan && costSummary ? (
                  <div className="rounded-xl border border-slate-600 bg-slate-900/40 p-4">
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100" style={cairoFont}>
                      {t('upgrade.summary')}
                    </h3>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-slate-500 dark:text-slate-400" style={cairoFont}>
                          {t('upgrade.newPlan')}
                        </dt>
                        <dd className="text-end font-medium text-slate-900 dark:text-slate-100" style={cairoFont}>
                          {t(`planNames.${selectedPlan}` as 'billing.planNames.starter')} / {PLANS[selectedPlan].englishName}
                        </dd>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-slate-500 dark:text-slate-400" style={cairoFont}>
                          {t('upgrade.newPeriod')}
                        </dt>
                        <dd className="text-end text-slate-900 dark:text-slate-100" style={cairoFont}>
                          {t(`period.${selectedPeriod}.label` as 'billing.period.monthly.label')}
                        </dd>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-slate-500 dark:text-slate-400" style={cairoFont}>
                          {t('upgrade.daysRemaining')}
                        </dt>
                        <dd className="tabular-nums text-slate-900 dark:text-slate-100" style={numFont}>
                          {formatNum(costSummary.daysRemaining)}
                        </dd>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-slate-500 dark:text-slate-400" style={cairoFont}>
                          {t('upgrade.dailyDiff')}
                        </dt>
                        <dd className="tabular-nums text-slate-900 dark:text-slate-100" style={numFont}>
                          {formatNum(Math.round(costSummary.dailyRateDifference * 100) / 100)} {t('egp')}
                        </dd>
                      </div>
                    </dl>
                    <div className="my-3 border-t border-slate-200 dark:border-slate-600" />
                    <p className="text-sm text-slate-600 dark:text-slate-300" style={cairoFont}>
                      {t('upgrade.amountDue')}
                    </p>
                    <p className="text-2xl font-bold text-teal-600 tabular-nums dark:text-teal-400" style={numFont}>
                      {formatNum(costSummary.amountDue)} {t('egp')}
                    </p>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300" style={cairoFont}>
                      {t('upgrade.nextRenewal')}
                    </p>
                    <p className="tabular-nums text-slate-900 dark:text-slate-100" style={numFont}>
                      {npdYmd
                        ? new Date(`${npdYmd}T12:00:00`).toLocaleDateString('en-US')
                        : tCommon('notSet')}
                    </p>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300" style={cairoFont}>
                      {t('upgrade.newMonthlyRate')}
                    </p>
                    <p className="tabular-nums text-slate-900 dark:text-slate-100" style={numFont}>
                      {formatNum(pricingForPlan(selectedPlan, pricingRows).allIn)} {t('egp')}
                    </p>
                    {planError ? (
                      <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
                        {planError}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      disabled={
                        paymentLoading ||
                        upgradeLimitReached ||
                        costSummary.amountDue <= 0 ||
                        !FEATURES.PAYMOB_ENABLED
                      }
                      onClick={() => void handleUpgradePay()}
                      className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-50 md:w-full btn-press chq-focus"
                      style={{ backgroundColor: '#0D9488' }}
                    >
                      {paymentLoading ? t('loadingShort') : t('upgrade.proceed')}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : activeTab === 'downgrade' && !billingIsPayg ? (
              <div className="mt-6 space-y-6">
                <div
                  className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                  style={cairoFont}
                >
                  {t('downgrade.notice')}
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100" style={cairoFont}>
                    {t('downgrade.choosePlan')}
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {downgradePlanOptions.map((pk) => {
                      const pr = pricingForPlan(pk, pricingRows);
                      const price = getChargeFromQuarterlyAllIn(pr.allIn, 'quarterly', pk);
                      return (
                        <PlanCard
                          key={pk}
                          nameAr={t(`planNames.${pk}` as 'billing.planNames.starter')}
                          nameEn={PLANS[pk].englishName}
                          price={price}
                          period={t('perQuarter')}
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
                        />
                      );
                    })}
                  </div>
                </div>

                {selectedPlan ? (
                  <div className="transition-opacity duration-300 opacity-100">
                    <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100" style={cairoFont}>
                      {t('downgrade.choosePeriod')}
                    </h3>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <PeriodCard
                        label={t('period.monthly.label')}
                        price={getChargeFromQuarterlyAllIn(
                          pricingForPlan(selectedPlan, pricingRows).allIn,
                          'monthly',
                          selectedPlan,
                        )}
                        isSelected={selectedPeriod === 'monthly'}
                        isCurrent={bp === 'monthly'}
                        badge={t('upgrade.monthlyPremiumHint')}
                        currentLabel={t('upgrade.currentPeriod')}
                        onClick={() => setSelectedPeriod('monthly')}
                        cairoFont={cairoFont}
                        numFont={numFont}
                      />
                      <PeriodCard
                        label={t('period.quarterly.label')}
                        price={getChargeFromQuarterlyAllIn(
                          pricingForPlan(selectedPlan, pricingRows).allIn,
                          'quarterly',
                          selectedPlan,
                        )}
                        isSelected={selectedPeriod === 'quarterly'}
                        isCurrent={bp === 'quarterly'}
                        badge={t('upgrade.quarterlyDefaultHint')}
                        currentLabel={t('upgrade.currentPeriod')}
                        onClick={() => setSelectedPeriod('quarterly')}
                        cairoFont={cairoFont}
                        numFont={numFont}
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
                      />
                    </div>
                  </div>
                ) : null}

                {selectedPlan && selectedPeriod && downgradePreview ? (
                  <div className="rounded-xl border border-slate-600 bg-slate-900/40 p-4">
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100" style={cairoFont}>
                      {t('downgrade.summary')}
                    </h3>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-slate-500 dark:text-slate-400" style={cairoFont}>
                          {t('downgrade.currentRate')}
                        </dt>
                        <dd className="tabular-nums text-slate-900 dark:text-slate-100" style={numFont}>
                          {formatNum(Math.round(downgradePreview.currentDaily * 100) / 100)} {t('egp')}
                        </dd>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-slate-500 dark:text-slate-400" style={cairoFont}>
                          {t('downgrade.newRate')}
                        </dt>
                        <dd className="tabular-nums text-slate-900 dark:text-slate-100" style={numFont}>
                          {formatNum(Math.round(downgradePreview.newDaily * 100) / 100)} {t('egp')}
                        </dd>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2">
                        <dt className="text-slate-500 dark:text-slate-400" style={cairoFont}>
                          {t('upgrade.daysRemaining')}
                        </dt>
                        <dd className="tabular-nums text-slate-900 dark:text-slate-100" style={numFont}>
                          {formatNum(downgradePreview.remainingDays)}
                        </dd>
                      </div>
                    </dl>
                    <div className="my-3 border-t border-slate-200 dark:border-slate-600" />
                    <p className="text-sm text-slate-600 dark:text-slate-300" style={cairoFont}>
                      {t('downgrade.creditsEarned')}
                    </p>
                    <p className="text-2xl font-bold text-teal-600 tabular-nums dark:text-teal-400" style={numFont}>
                      {formatNum(downgradePreview.earned)} {t('downgrade.creditPoints')}
                    </p>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400" style={cairoFont}>
                      {t('downgrade.currentBalance')}:{' '}
                      <span className="tabular-nums text-slate-900 dark:text-slate-100" style={numFont}>
                        {formatNum(Number(center?.credit_balance ?? 0))}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400" style={cairoFont}>
                      {t('downgrade.newBalance')}:{' '}
                      <span className="tabular-nums text-slate-900 dark:text-slate-100" style={numFont}>
                        {formatNum(Number(center?.credit_balance ?? 0) + downgradePreview.earned)}
                      </span>
                    </p>
                    {downgradeError ? (
                      <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
                        {downgradeError}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      disabled={downgradeLoading}
                      onClick={() => void handleDowngradeConfirm()}
                      className="mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm disabled:opacity-50 btn-press chq-focus"
                      style={{ backgroundColor: '#F59E0B' }}
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
            {!billingIsPayg ? (
              <>
            {/* SECTION 3: CREDITS BALANCE */}
            <section
              className="rounded-2xl border border-slate-700 bg-slate-800/40 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800"
              aria-labelledby="billing-credits-heading"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2
                  id="billing-credits-heading"
                  className="text-lg font-semibold text-slate-900 dark:text-white"
                  style={cairoFont}
                >
                  {t('credits.title')}
                </h2>
                {creditBal > 0 ? (
                  <span
                    className="rounded-full px-3 py-1 text-sm font-semibold text-teal-800 dark:bg-teal-900/40 dark:text-teal-100"
                    style={{ backgroundColor: 'rgba(13, 148, 136, 0.15)' }}
                  >
                    {formatNum(availableCredits)}
                  </span>
                ) : null}
              </div>

              {creditBal > 0 ? (
                <div className="mt-4 space-y-4">
                  <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white" style={numFont}>
                    {t('credits.available', { amount: formatNum(availableCredits) })}
                  </p>
                  {creditReserved > 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400" style={cairoFont}>
                      {t('credits.reserved', { amount: formatNum(creditReserved) })}
                    </p>
                  ) : null}
                  <p className="text-sm text-slate-600 dark:text-slate-300" style={cairoFont}>
                    {t('credits.equivalent', { amount: formatNum(availableCredits / 2) })}
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400" style={cairoFont}>
                    {t('credits.expiryNote')}
                  </p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => toast.info(t('credits.applyInfo'))}
                      className="w-full rounded-xl border-2 border-amber-500 px-4 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-50 dark:border-amber-600 dark:text-amber-200 dark:hover:bg-amber-950/30 sm:w-auto btn-press chq-focus"
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
                      className="w-full rounded-xl border-2 border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700/50 sm:w-auto btn-press chq-focus"
                      style={cairoFont}
                    >
                      {t('credits.requestWithdrawal')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-6 flex flex-col items-center py-8 text-center text-slate-500 dark:text-slate-400">
                  <span className="mb-3 text-4xl opacity-50" aria-hidden>
                    🪙
                  </span>
                  <p className="font-medium text-slate-600 dark:text-slate-300" style={cairoFont}>
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
              className="rounded-2xl border border-slate-700 bg-slate-800/40 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800"
              aria-labelledby="billing-withdrawal-heading"
            >
              {availableCredits < 2000 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400" style={cairoFont}>
                  {t('withdrawal.insufficientNote', { amount: formatNum(availableCredits) })}
                </p>
              ) : (
                <>
                  <h2
                    id="billing-withdrawal-heading"
                    className="text-lg font-semibold text-slate-900 dark:text-white"
                    style={cairoFont}
                  >
                    {t('withdrawal.title')}
                  </h2>
                  <div className="mt-4 rounded-xl bg-teal-50 p-4 dark:bg-teal-900/20">
                    <p className="font-semibold text-slate-900 dark:text-teal-50" style={cairoFont}>
                      {t('withdrawal.rate')}
                    </p>
                    <p className="mt-1 text-sm text-slate-600 dark:text-teal-100/90" style={cairoFont}>
                      {t('withdrawal.fee')}
                    </p>
                  </div>

                  {String(center?.instapay_number ?? '').trim() ? (
                    <p className="mt-4 text-sm text-slate-600 dark:text-slate-300" style={cairoFont}>
                      {t('withdrawal.instapaySet', { number: maskInstapay(center?.instapay_number) })}
                    </p>
                  ) : (
                    <div
                      className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                      style={cairoFont}
                    >
                      <p>{t('withdrawal.noInstapay')}</p>
                      <Link
                        href="/settings"
                        className="mt-2 inline-block font-semibold hover:underline"
                        style={{ color: '#0D9488' }}
                      >
                        {t('withdrawal.settingsLink')}
                      </Link>
                    </div>
                  )}

                  <div className="mt-4">
                    {withdrawalWindowOpen ? (
                      <span
                        className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200"
                        style={cairoFont}
                      >
                        {t('withdrawal.windowOpen')}
                      </span>
                    ) : (
                      <div className="space-y-1">
                        <span
                          className="inline-block rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-800 dark:bg-slate-700 dark:text-slate-200"
                          style={cairoFont}
                        >
                          {t('withdrawal.windowClosed', { date: nextWithdrawalWindowLabel })}
                        </span>
                        <p className="text-xs text-slate-500 dark:text-slate-400" style={cairoFont}>
                          {t('withdrawal.quarterly')}
                        </p>
                      </div>
                    )}
                  </div>

                  {withdrawalSuccess ? (
                    <div
                      className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
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
                          date: new Date(`${withdrawalSuccess.processingDate}T12:00:00`).toLocaleDateString(
                            'en-US',
                            { year: 'numeric', month: 'short', day: 'numeric' },
                          ),
                        })}
                      </p>
                    </div>
                  ) : null}

                  {withdrawalError ? (
                    <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
                      {withdrawalError}
                    </p>
                  ) : null}

                  {String(center?.instapay_number ?? '').trim() && withdrawalWindowOpen ? (
                    <div className="mt-6 space-y-3">
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300" style={cairoFont}>
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
                        className="w-full rounded-xl border border-slate-600 bg-slate-900/80 px-4 py-2.5 text-slate-100 tabular-nums"
                      />
                      <p className="text-sm text-slate-600 dark:text-slate-300" style={cairoFont}>
                        {t('withdrawal.youReceive', {
                          amount: formatNum(Math.max(0, withdrawAmount) / 2),
                        })}
                      </p>
                      <p className="text-sm text-slate-600 dark:text-slate-300" style={cairoFont}>
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
                        style={{ backgroundColor: '#0D9488' }}
                      >
                        {withdrawalSubmitting ? t('loadingShort') : t('withdrawal.submit')}
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </section>
              </>
            ) : null}

        {showReactivation && reactivationCalc && center?.suspended_at ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
            <div
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-800/95 p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="reactivation-title"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 id="reactivation-title" className="text-lg font-bold text-slate-900" style={cairoFont}>
                  {t('reactivation.title')}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowReactivation(false)}
                  className="text-slate-500 hover:text-slate-800 btn-press chq-focus"
                  aria-label={t('close')}
                >
                  ✕
                </button>
              </div>
              <p className="mt-2 text-sm text-slate-600" style={cairoFont}>
                {t('reactivation.suspendedSince', {
                  date: new Date(center.suspended_at).toLocaleDateString('en-US'),
                })}
              </p>
              <div className="mt-3">
                <span
                  className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                    reactivationCalc.tier === 'tier1'
                      ? 'bg-amber-100 text-amber-900'
                      : 'bg-slate-200 text-slate-800'
                  }`}
                  style={cairoFont}
                >
                  {reactivationCalc.tier === 'tier1' ? t('reactivation.tier1') : t('reactivation.tier2')}
                </span>
              </div>
              <div className="mt-4 rounded-xl border border-slate-600 bg-slate-900/40 p-4">
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
                <div className="mt-3 flex justify-between border-t border-slate-200 pt-3">
                  <span className="font-semibold text-slate-900" style={cairoFont}>
                    {t('reactivation.total')}
                  </span>
                  <span className="tabular-nums font-bold text-slate-900" style={numFont}>
                    {formatNum(reactivationCalc.total)} {t('egp')}
                  </span>
                </div>
              </div>
              {Number(center?.credit_balance ?? 0) > 0 ? (
                <label className="mt-4 flex cursor-pointer items-center gap-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={useCredits}
                    onChange={(e) => setUseCredits(e.target.checked)}
                    className="size-4 rounded border-slate-300 text-teal-600"
                  />
                  <span style={cairoFont}>
                    {t('reactivation.useCredits', {
                      amount: formatNum(Number(center?.credit_balance ?? 0)),
                    })}
                  </span>
                </label>
              ) : null}
              {useCredits && Number(center?.credit_balance ?? 0) > 0 ? (
                <div className="mt-2 rounded-lg bg-teal-50 px-3 py-2 text-sm dark:bg-teal-950/30">
                  <p className="text-slate-700" style={cairoFont}>
                    {t('reactivation.creditApplied')}: −
                    {formatNum(Math.min(Number(center?.credit_balance ?? 0), reactivationCalc.total))}{' '}
                    {t('egp')}
                  </p>
                  <p className="text-slate-700" style={cairoFont}>
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
                style={{ backgroundColor: '#0D9488' }}
              >
                {reactivationLoading ? t('loadingShort') : t('reactivation.proceed')}
              </button>
            </div>
          </div>
        ) : null}

        {/* SECTION 5: WA PACK */}
        <section className="rounded-2xl border border-slate-700 bg-slate-800/40 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
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
            <div className="rounded-xl border border-dashed border-slate-600 bg-slate-900/40 p-5">
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
                  className="mt-4 w-full rounded-xl border-2 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50 md:w-auto btn-press chq-focus"
                  style={{ borderColor: '#0D9488', backgroundColor: '#0D9488' }}
                >
                  {packRequestLoading ? t('loadingShort') : t('pack.request')}
                </button>
              )}
            </div>
          )}
        </section>

        {/* SECTION 6: INVOICE HISTORY */}
        <section className="rounded-2xl border border-slate-700 bg-slate-800/40 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
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
                      : tCommon('notSet');
                  const ref = inv.invoice_number ?? inv.id.slice(0, 8);
                  return (
                    <div
                      key={inv.id}
                      className="rounded-xl border border-slate-200 p-4 dark:border-slate-600"
                    >
                      <div className="flex justify-between gap-2 text-sm">
                        <span className="text-slate-500">{t('history.date')}</span>
                        <span className="tabular-nums text-slate-900 dark:text-white" style={numFont}>
                          {inv.created_at
                            ? new Date(inv.created_at).toLocaleDateString('en-US')
                            : tCommon('notSet')}
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
                          : tCommon('notSet');
                      const ref = inv.invoice_number ?? inv.id.slice(0, 8);
                      return (
                        <tr key={inv.id} className="border-b border-slate-100 dark:border-slate-700/80">
                          <td className="py-3 pe-4 tabular-nums text-slate-900 dark:text-white" style={numFont}>
                            {inv.created_at
                              ? new Date(inv.created_at).toLocaleDateString('en-US')
                              : tCommon('notSet')}
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
        <section className="rounded-2xl border border-slate-700 bg-slate-800/40 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
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
                        {req.requested_at
                          ? new Date(req.requested_at).toLocaleDateString('en-US')
                          : tCommon('notSet')}
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

        {ownerOk && centerStatusLower === 'pending_cancellation' ? (
          <section
            className="rounded-2xl border border-amber-300 bg-amber-50 p-6 shadow-sm dark:border-amber-700 dark:bg-amber-950/30"
            aria-labelledby="billing-pending-cancel-heading"
          >
            <h2
              id="billing-pending-cancel-heading"
              className="text-lg font-semibold text-amber-900 dark:text-amber-100"
              style={cairoFont}
            >
              {t('cancel.title')}
            </h2>
            <p className="mt-2 text-sm text-amber-900/90 dark:text-amber-100/90" style={cairoFont}>
              {t('cancel.pendingBanner', { date: billingPeriodEndLabel })}
            </p>
          </section>
        ) : null}

        {showCancelDanger ? (
          <section
            className="rounded-2xl border border-red-900/50 bg-red-950/20 p-6"
            aria-labelledby="billing-danger-heading"
          >
            <h2
              id="billing-danger-heading"
              className="text-lg font-semibold text-red-600 dark:text-red-400"
              style={cairoFont}
            >
              {t('cancel.title')}
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300" style={cairoFont}>
              {t('cancel.subtitle')}
            </p>
            <button
              type="button"
              onClick={() => {
                setCancelSubmitError(null);
                setShowCancelModal(true);
              }}
              className="mt-3 text-sm text-red-500 underline hover:text-red-600 dark:text-red-400 btn-press chq-focus"
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
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800/90 p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-modal-title"
          >
            <h2
              id="cancel-modal-title"
              className="text-lg font-bold text-slate-900 dark:text-white"
              style={cairoFont}
            >
              {t('cancel.modalTitle')}
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300" style={cairoFont}>
              {t('cancel.modalSubtitle')}
            </p>
            <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-200" style={cairoFont}>
              {t('cancel.reasonLabel')}
            </label>
            <select
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-600 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
            >
              <option value="">{t('cancel.reasonPlaceholder')}</option>
              {CANCEL_REASON_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(`cancel.reason.${k}` as 'billing.cancel.reason.other')}
                </option>
              ))}
            </select>
            <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-200" style={cairoFont}>
              {t('cancel.confirmLabel')}
            </label>
            {/* CANCEL confirm */}
            <input
              type="text"
              value={cancelConfirmText}
              onChange={(e) => setCancelConfirmText(e.target.value)}
              placeholder={t('cancel.confirmLabel')}
              className="mt-1 w-full rounded-xl border border-slate-600 bg-slate-900/80 px-3 py-2 text-sm text-slate-100"
              dir="ltr"
              autoComplete="off"
            />
            {cancelSubmitError ? (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
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
                className="order-2 rounded-xl border-2 border-teal-600 px-4 py-2.5 text-sm font-semibold text-teal-700 hover:bg-teal-50 dark:border-teal-500 dark:text-teal-200 dark:hover:bg-teal-950/40 sm:order-1 btn-press chq-focus"
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
                className="order-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50 sm:order-2 btn-press chq-focus"
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
          closeLabel={t('close')}
          onClose={closePaymob}
          onSuccess={onPaymobSuccess}
          onError={onPaymobError}
        />
      ) : null}
    </div>
  );
}
