'use client';

import { useState, useEffect, useTransition, useRef, useCallback } from 'react';
import { usePendingSignup, type SignupStage as PendingSignupStage } from '@/lib/signup/usePendingSignup';
import { signupStep1Schema } from '@/lib/signup/step1Schema';
import { useTranslations, useLocale } from 'next-intl';
import { Link, useRouter, usePathname } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Globe } from 'lucide-react';
import {
  PLANS,
  ORDERED_SUBSCRIPTION_PLAN_KEYS,
  type BillingPeriod,
  type PlanKey,
  type SubscriptionPlanKey,
} from '@/lib/pricing';
import { formatDate, formatNumber } from '@/lib/formatNumber';
import { getSupportWhatsAppWaMeWithText } from '@/lib/supportWhatsApp';
import {
  usePublicPlanPrices,
  type DynamicPlanPrice,
  type DynamicPlanPriceMap,
} from '@/hooks/usePublicPlanPrices';
import { readReferralCode, clearReferralCode } from '@/lib/referralCode';
import { normalizePhone } from '@/lib/utils/phone';

const PLAYFAIR = {
  fontFamily: "var(--font-playfair), 'Playfair Display', 'Didot', 'Bodoni MT', Georgia, serif",
  fontVariantNumeric: 'tabular-nums' as const,
  fontFeatureSettings: '"zero" 1, "tnum" 1',
} as const;
const SANS = { fontFamily: 'system-ui, -apple-system, sans-serif' } as const;

const TOP_CENTERS_WHATSAPP = getSupportWhatsAppWaMeWithText(
  'I am interested in the TOP CENTERS plan',
);

/** Bilingual labels for payment summary (must match select option values). */
const CITY_SUMMARY_LABEL: Record<string, string> = {
  cairo: 'القاهرة - Cairo',
  giza: 'الجيزة - Giza',
  alexandria: 'الإسكندرية - Alexandria',
  sixth_october: '6 أكتوبر - 6th October',
  sheikh_zayed: 'الشيخ زايد - Sheikh Zayed',
  nasr_city: 'مدينة نصر - Nasr City',
  new_cairo: 'القاهرة الجديدة - New Cairo',
  heliopolis: 'مصر الجديدة - Heliopolis',
  maadi: 'المعادي - Maadi',
  other: 'أخرى - Other',
};

const SIGNUP_CITIES = [
  { id: 'cairo', ar: 'القاهرة', en: 'Cairo' },
  { id: 'giza', ar: 'الجيزة', en: 'Giza' },
  { id: 'alexandria', ar: 'الإسكندرية', en: 'Alexandria' },
  { id: 'sixth_october', ar: '6 أكتوبر', en: '6th October' },
  { id: 'sheikh_zayed', ar: 'الشيخ زايد', en: 'Sheikh Zayed' },
  { id: 'nasr_city', ar: 'مدينة نصر', en: 'Nasr City' },
  { id: 'new_cairo', ar: 'القاهرة الجديدة', en: 'New Cairo' },
  { id: 'heliopolis', ar: 'مصر الجديدة', en: 'Heliopolis' },
  { id: 'maadi', ar: 'المعادي', en: 'Maadi' },
  { id: 'other', ar: 'أخرى', en: 'Other' },
] as const;

/**
 * Static plan metadata - name + key only. Prices are sourced dynamically per
 * render via `usePublicPlanPrices()` so admin edits on /admin/pricing reflect
 * in the signup flow without a redeploy. Student limits are also DB-driven
 * with the PLANS hardcoded value as a fallback (see `studentsFor`).
 *
 * The synchronous PLANS constant in @/lib/pricing remains the source of truth
 * for billing engines, MRR aggregates, and other server math; this component
 * only overrides the DISPLAY surface.
 */
const SIGNUP_PLANS = ORDERED_SUBSCRIPTION_PLAN_KEYS.map((key) => {
  const p = PLANS[key];
  return {
    key,
    name: p.englishName,
    arabicName: p.arabicName,
  };
});

type SignupPlan = (typeof SIGNUP_PLANS)[number];

function billingPeriodFromUi(period: string): BillingPeriod {
  if (period === 'monthly' || period === 'annual') return period;
  return 'quarterly';
}

/** EGP/month headline figure shown on the plan card for the selected period. */
function getSignupMonthlyDisplay(dyn: DynamicPlanPrice, period: BillingPeriod): number {
  if (period === 'quarterly') return dyn.quarterlyAllIn;
  if (period === 'monthly') return dyn.quarterlyAllIn;
  return dyn.annualEffectiveMonthly;
}

/**
 * Full cycle amount the customer is billed for the selected period. Same
 * formula used by `getPlanPrice(planKey, period)` in @/lib/pricing - kept here
 * so DB-edited prices can override the synchronous constant for display only.
 */
function getSignupCycleTotal(dyn: DynamicPlanPrice, period: BillingPeriod): number {
  switch (period) {
    case 'quarterly':
      return dyn.quarterlyAllIn * 3;
    case 'monthly':
      return dyn.quarterlyAllIn;
    case 'annual':
      // Annual total = monthly × 10 ("2 months free"); annualTotal is computed
      // server-side with the live admin multiplier so display == the amount charged.
      return dyn.annualTotal;
    default:
      return dyn.quarterlyAllIn;
  }
}

function studentsFor(plan: SignupPlan, dyn: DynamicPlanPriceMap): number {
  return dyn[plan.key as SubscriptionPlanKey]?.weeklyStudentLimit ?? PLANS[plan.key].weeklyStudentLimit ?? 0;
}

function getDisplayPrice(plan: SignupPlan, period: string, dyn: DynamicPlanPriceMap): number {
  return getSignupMonthlyDisplay(dyn[plan.key as SubscriptionPlanKey], billingPeriodFromUi(period));
}

function getTotalAmount(
  plan: SignupPlan | undefined,
  period: string,
  dyn: DynamicPlanPriceMap,
): number {
  if (!plan) return 0;
  return getSignupCycleTotal(dyn[plan.key as SubscriptionPlanKey], billingPeriodFromUi(period));
}

function getPerStudentCost(
  plan: SignupPlan,
  period: string,
  loc: string,
  dyn: DynamicPlanPriceMap,
): string {
  const monthly = getDisplayPrice(plan, period, dyn);
  const weekly = monthly / 4.33;
  const students = studentsFor(plan, dyn);
  const perStudent = students > 0 ? weekly / students : 0;
  return formatNumber(perStudent, loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getBilledAmount(plan: SignupPlan, period: string, dyn: DynamicPlanPriceMap): number {
  return getTotalAmount(plan, period, dyn);
}

const getPeriodDateRange = (period: string, loc: string): string => {
  const now = new Date();
  const start = formatDate(now, loc, { month: 'short', year: 'numeric' });
  const end = new Date(now);
  if (period === 'monthly') end.setMonth(end.getMonth() + 1);
  else if (period === 'quarterly') end.setMonth(end.getMonth() + 3);
  else end.setFullYear(end.getFullYear() + 1);
  const endStr = formatDate(end, loc, { month: 'short', year: 'numeric' });
  return `${start} - ${endStr}`;
};

function UnderlineInput({
  label,
  value,
  onChange,
  type = 'text',
  placeholder = '',
  hint = '',
  required = false,
  inputMode,
  dir,
  id,
  error,
  maxLength,
  counterMax,
  tabIndex,
  onBlurTrim,
  afterBlur,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  dir?: 'ltr' | 'rtl';
  id?: string;
  error?: string;
  maxLength?: number;
  counterMax?: number;
  tabIndex?: number;
  onBlurTrim?: boolean;
  afterBlur?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const active = focused || value.length > 0;
  const err = Boolean(error);
  const bottomColor = err
    ? 'var(--color-danger)'
    : focused
      ? 'var(--color-teal)'
      : value
        ? 'var(--color-border-strong)'
        : 'var(--color-border)';
  const bottomW = err || focused ? '2px' : '1px';

  return (
    <div className="group relative mb-8 pt-6">
      <label
        htmlFor={id}
        style={{ ...SANS, color: active ? 'var(--color-teal)' : 'var(--color-text-muted)' }}
        className={`pointer-events-none absolute font-medium transition-all duration-300 start-0 ${
          active ? 'top-0 text-[10px] tracking-wider uppercase' : 'top-5 text-[13px]'
        }`}
      >
        {label}
        {required ? <span className="ms-0.5" style={{ color: 'var(--color-teal)' }}>*</span> : null}
      </label>
      <input
        id={id}
        data-chq-underline
        type={type}
        value={value}
        maxLength={maxLength}
        tabIndex={tabIndex}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (onBlurTrim) onChange(value.trim());
          afterBlur?.();
        }}
        placeholder={active ? placeholder : ''}
        inputMode={inputMode}
        dir={dir}
        aria-invalid={err}
        className="w-full transition-all duration-300 placeholder:text-[var(--color-text-muted)]"
        style={{
          ...PLAYFAIR,
          fontSize: '15px',
          width: '100%',
          background: 'transparent',
          backgroundColor: 'transparent',
          border: 'none',
          borderBottom: `${bottomW} solid ${bottomColor}`,
          padding: '3px 0 9px',
          color: 'var(--color-text-primary)',
          outline: 'none',
          WebkitTextFillColor: 'var(--color-text-primary)',
          WebkitBoxShadow: '0 0 0px 1000px var(--color-surface-0) inset',
          caretColor: 'var(--color-text-primary)',
          appearance: 'none',
          boxSizing: 'border-box',
        }}
      />
      {counterMax != null ? (
        <p className="mt-1 text-end text-[10px]" style={{ ...SANS, color: 'var(--color-text-muted)' }}>
          {value.trim().length}/{counterMax}
        </p>
      ) : null}
      {error ? (
        <p className="mt-1 text-[11px]" style={{ ...SANS, color: 'var(--color-danger)' }}>
          {error}
        </p>
      ) : null}
      {hint && !error ? (
        <p className="mt-2 text-[11px]" style={{ ...SANS, color: 'var(--color-text-muted)' }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const STEP1_FIELD_ORDER = ['centerName', 'ownerName', 'phone', 'email', 'city'] as const;
const STEP1_ID: Record<(typeof STEP1_FIELD_ORDER)[number], string> = {
  centerName: 'su-center',
  ownerName: 'su-owner',
  phone: 'su-phone',
  email: 'su-email',
  city: 'su-city',
};

function focusFirstStep1Invalid(errors: Partial<Record<string, string>>) {
  for (const k of STEP1_FIELD_ORDER) {
    if (errors[k]) {
      const id = STEP1_ID[k];
      document.getElementById(id)?.focus();
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      break;
    }
  }
}

type Stage = 'info' | 'plan' | 'payment' | 'success';

export default function SignupForm() {
  const t = useTranslations('signup');
  const tc = useTranslations('common');
  const tb = useTranslations('billing');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const dynamicPlanPrices = usePublicPlanPrices();

  const [stage, setStage] = useState<Stage>('info');
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [form, setForm] = useState({
    centerName: '',
    ownerName: '',
    phone: '',
    email: '',
    city: '',
    plan: 'starter',
    billingPeriod: 'monthly' as BillingPeriod,
    referralCode: '',
    notes: '',
  });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showReferral, setShowReferral] = useState(false);
  const [appliedReferralCode, setAppliedReferralCode] = useState<string | null>(null);
  const [step1Errors, setStep1Errors] = useState<Partial<Record<string, string>>>({});

  const [showPromoInput, setShowPromoInput] = useState(false);
  const [promoInputValue, setPromoInputValue] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    discountPct: number;
    originalAmountEgp: number;
    discountedAmountEgp: number;
    savingsEgp: number;
  } | null>(null);

  const { persist } = usePendingSignup(
    setForm,
    setStage as React.Dispatch<React.SetStateAction<PendingSignupStage>>,
  );

  useEffect(() => {
    try {
      if (sessionStorage.getItem('chq_signup_tos') === '1') setTermsAccepted(true);
      if (sessionStorage.getItem('chq_signup_privacy') === '1') setPrivacyAccepted(true);
    } catch {
      //
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem('chq_signup_tos', termsAccepted ? '1' : '0');
    } catch {
      //
    }
  }, [termsAccepted]);

  useEffect(() => {
    try {
      sessionStorage.setItem('chq_signup_privacy', privacyAccepted ? '1' : '0');
    } catch {
      //
    }
  }, [privacyAccepted]);

  useEffect(() => {
    const refFromUrl = searchParams?.get('ref')?.trim().toUpperCase() ?? '';
    const refFromLs = (readReferralCode() ?? '').trim().toUpperCase();
    let refFromCookie = '';
    if (typeof document !== 'undefined') {
      const m = document.cookie.match(/(?:^|;\s*)chq_referral_code=([^;]+)/);
      refFromCookie = decodeURIComponent(m?.[1]?.trim() ?? '').toUpperCase();
    }
    const code = refFromUrl || refFromLs || refFromCookie;
    if (code && /^[A-Z0-9]{8}$/.test(code)) {
      setAppliedReferralCode(code);
      setShowReferral(true);
    }
  }, [searchParams]);

  const updateForm = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const touchValidateStep1 = useCallback(() => {
    const parsed = signupStep1Schema.safeParse({
      phone: form.phone,
      email: form.email.trim(),
      centerName: form.centerName,
      ownerName: form.ownerName,
      city: form.city,
    });
    if (parsed.success) {
      setStep1Errors({});
      return;
    }
    const next: Partial<Record<string, string>> = {};
    for (const iss of parsed.error.issues) {
      const key = iss.path[0] as string;
      if (key === 'phone') next.phone = t('invalidPhoneIntl');
      else if (key === 'email') next.email = t('invalidEmail');
      else if (key === 'centerName') next.centerName = t('centerFieldInvalid');
      else if (key === 'ownerName') next.ownerName = t('ownerFieldInvalid');
      else if (key === 'city') next.city = t('cityRequired');
    }
    setStep1Errors(next);
  }, [form, t]);

  const prevStageRef = useRef(stage);
  useEffect(() => {
    if (stage === 'payment' && prevStageRef.current !== 'payment') {
      void persist(form, 'payment', 3);
    }
    prevStageRef.current = stage;
  }, [stage, form, persist]);

  const handleLocaleToggle = () => {
    const next = locale === 'ar' ? 'en' : 'ar';
    startTransition(() => router.replace(pathname, { locale: next }));
  };

  const applyPromo = async () => {
    const code = promoInputValue.trim().toUpperCase();
    if (!code) return;
    setPromoLoading(true);
    setPromoError('');
    try {
      const res = await fetch('/api/promo/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          planKey: form.plan,
          billingInterval: form.billingPeriod,
        }),
      });
      const data = (await res.json()) as {
        valid?: boolean;
        error?: string;
        discountPct?: number;
        originalAmountEgp?: number;
        discountedAmountEgp?: number;
        savingsEgp?: number;
      };
      if (!res.ok || !data.valid) {
        const errKey = data.error ?? 'generic';
        if (errKey === 'code_expired') setPromoError(t('promoErrorExpired'));
        else if (errKey === 'code_exhausted') setPromoError(t('promoErrorExhausted'));
        else if (errKey === 'already_used') setPromoError(t('promoErrorAlreadyUsed'));
        else setPromoError(t('promoErrorNotFound'));
        return;
      }
      setAppliedPromo({
        code,
        discountPct: data.discountPct ?? 0,
        originalAmountEgp: data.originalAmountEgp ?? 0,
        discountedAmountEgp: data.discountedAmountEgp ?? 0,
        savingsEgp: data.savingsEgp ?? 0,
      });
      setPromoInputValue('');
      setShowPromoInput(false);
    } catch {
      setPromoError(t('promoErrorNotFound'));
    } finally {
      setPromoLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (paymentSubmitting) return;
    if (!termsAccepted || !privacyAccepted) {
      setError(t('consentRequired'));
      return;
    }
    setPaymentSubmitting(true);
    setError('');
    try {
      // Same normalizer step 1 validated with, so the value we submit cannot
      // differ from the value the user was told was valid.
      const phone = normalizePhone(form.phone);
      // Promo takes priority if both exist (edge case - UI prevents this normally).
      let referralEffective = (form.referralCode.trim() || appliedReferralCode || '').trim().toUpperCase();
      if (appliedPromo && referralEffective) {
        referralEffective = '';
      }
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          centerName: form.centerName,
          ownerName: form.ownerName,
          phone,
          email: form.email,
          city: form.city,
          plan: form.plan,
          billingPeriod: form.billingPeriod,
          referralCode: referralEffective || null,
          promoCode: appliedPromo?.code ?? null,
          notes: form.notes,
          initiatePayment: true,
          termsAccepted: true,
          privacyAccepted: true,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        paymob_code?: string;
        paymentUrl?: string;
        success?: boolean;
      };
      if (!res.ok) {
        if (data.error === 'phone_exists') setError(t('errorPhoneExists'));
        else if (data.error === 'phone_blacklisted') setError(t('errorPhoneBlacklisted'));
        else if (data.error === 'payment_unavailable') {
          const code = data.paymob_code;
          if (code === 'invalid_card') setError(t('errors.cardDeclined'));
          else if (code === 'insufficient_funds') setError(t('errors.insufficientFunds'));
          else if (code === '3ds_failed') setError(t('errors.threeDsFailed'));
          else setError(t('errors.paymentGeneric'));
        } else setError(data.error || t('errorGeneric'));
        return;
      }
      if (data.success) {
        clearReferralCode();
        // Trial-first: no payment at signup. Go straight to owner PIN setup
        // (which auto-logs-in on success).
        window.location.href = `/${locale}/set-pin`;
      }
    } catch {
      setError(t('errorGeneric'));
    } finally {
      setPaymentSubmitting(false);
    }
  };

  // True when a referral discount is active (auto-detected or typed).
  const hasActiveReferral = Boolean(form.referralCode.trim() || appliedReferralCode);

  const selectedPlan = SIGNUP_PLANS.find((p) => p.key === form.plan);
  const renewsKey =
    form.billingPeriod === 'monthly'
      ? 'renewsMonthly'
      : form.billingPeriod === 'annual'
        ? 'renewsAnnually'
        : 'renewsQuarterly';
  const renewsAmount = selectedPlan
    ? formatNumber(getTotalAmount(selectedPlan, form.billingPeriod, dynamicPlanPrices), locale)
    : '0';
  const slideAnim = direction === 'forward' ? 'slideIn' : 'slideInBack';

  const stageSubtitle =
    stage === 'info' ? t('stageOneSubtitle') : stage === 'plan' ? t('stageTwoSubtitle') : t('stageThreeTitle');

  const progressWidth = stage === 'info' ? '25%' : stage === 'plan' ? '50%' : '75%';
  const progressNow = stage === 'info' ? 25 : stage === 'plan' ? 50 : 75;
  const currentStepNumber = stage === 'info' ? 1 : stage === 'plan' ? 2 : 3;

  if (stage === 'success') {
    return (
      <div
        data-chq-signup
        className="relative flex min-h-screen flex-col items-center justify-center p-8 text-center font-['Cairo',sans-serif]"
        style={{ background: 'var(--color-surface-0)' }}
      >
        <div className="relative z-10">
          <div
            className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-full"
            style={{
              background: 'var(--color-teal-soft)',
              border: '1px solid var(--color-border-brand)',
            }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-teal)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2
            className="mb-3 text-[32px] font-black tracking-tight"
            style={{ ...PLAYFAIR, color: 'var(--color-text-primary)' }}
          >
            {t('successTitle')}
          </h2>
          <p
            className="mx-auto max-w-xs text-[13px] leading-relaxed"
            style={{ ...SANS, color: 'var(--color-text-secondary)' }}
          >
            {t('successDesc')}
          </p>
        </div>
      </div>
    );
  }

  const orderSummaryRows: {
    lineId: string;
    label: string;
    val: string;
    serif: boolean;
  }[] = [
    {
      lineId: 'plan',
      label: t('plan'),
      val: selectedPlan ? (locale === 'ar' ? selectedPlan.arabicName : selectedPlan.name) : '',
      serif: true,
    },
    {
      lineId: 'students',
      label: t('studentsLabel'),
      val: selectedPlan
        ? `${t('upTo')} ${formatNumber(studentsFor(selectedPlan, dynamicPlanPrices), locale)} ${t('studentsPerWeek')}`
        : '',
      serif: false,
    },
    {
      lineId: 'billing',
      label: tb('billingPeriodLabel'),
      val: tb(`period.${form.billingPeriod}.label` as 'billing.period.monthly.label'),
      serif: true,
    },
    {
      lineId: 'periodRange',
      label: t('periodLabel'),
      val: getPeriodDateRange(form.billingPeriod, locale),
      serif: false,
    },
  ];

  const taxRows: { taxKey: string; label: string; val: string; teal: boolean }[] = [
    {
      taxKey: 'subtotal',
      label: t('subtotal'),
      val: selectedPlan
        ? `${formatNumber(getTotalAmount(selectedPlan, form.billingPeriod, dynamicPlanPrices), locale)} EGP`
        : '',
      teal: false,
    },
    { taxKey: 'vat', label: 'VAT 14%', val: t('included'), teal: true },
  ];

  return (
    <div
      data-chq-signup
      className="relative min-h-screen w-full font-['Cairo',sans-serif]"
      style={{ background: 'var(--color-surface-0)' }}
    >
      <div
        className="fixed top-0 end-0 start-0 z-50 h-[2px]"
        style={{ background: 'var(--color-border)' }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressNow}
      >
        <div
          className="h-full transition-all duration-700 ease-out"
          style={{
            width: progressWidth,
            background: 'linear-gradient(to right, var(--color-teal-deep), var(--color-teal))',
          }}
        />
      </div>

      <div className="absolute end-4 top-6 z-40">
        <button
          type="button"
          onClick={handleLocaleToggle}
          disabled={isPending}
          aria-label={t('localeToggleAria')}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-medium transition-colors"
          style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          <Globe size={13} aria-hidden />
          <span dir="ltr">{locale === 'ar' ? 'EN' : 'AR'}</span>
        </button>
      </div>

      <div className="relative z-10 mx-auto max-w-md px-6 pt-14 pb-20">
        {(stage === 'info' || stage === 'plan' || stage === 'payment') ? (
          <div className="mb-6 flex flex-col items-center gap-2">
            <p
              className="text-center text-[11px] font-semibold uppercase tracking-[0.12em]"
              style={{ ...SANS, color: 'var(--color-teal)' }}
            >
              {currentStepNumber === 1
                ? t('progress.step1Of4')
                : currentStepNumber === 2
                  ? t('progress.step2Of4')
                  : t('progress.step3Of4')}
            </p>
            <div className="flex items-center gap-1.5" aria-hidden>
              {[1, 2, 3, 4].map((step) => {
                const isCompleted = step < currentStepNumber;
                const isActive = step === currentStepNumber;
                const isPayment = step === 4;
                return (
                  <span
                    key={step}
                    className="h-1.5 rounded-full transition-all duration-300"
                    style={{
                      width: isActive ? '1.5rem' : '0.375rem',
                      background: isActive
                        ? 'var(--color-teal)'
                        : isCompleted
                          ? 'var(--color-teal-deep)'
                          : isPayment
                            ? 'var(--color-border-strong)'
                            : 'var(--color-border)',
                    }}
                  />
                );
              })}
            </div>
            <p
              className="text-center text-[10px] tracking-[0.1em]"
              style={{ ...SANS, color: 'var(--color-text-muted)' }}
            >
              {t('progress.step4Payment')}
            </p>
          </div>
        ) : null}
        <div className="mb-12 flex flex-col items-center">
          <span
            className="logo-name text-base"
            style={{ fontFamily: 'var(--font-bodoni)', fontWeight: 700, letterSpacing: '2px' }}
          >
            <span style={{ color: 'var(--color-text-primary)' }}>Tutoring</span>
            <span style={{ color: 'var(--color-teal)' }}>HQ</span>
          </span>
          <span className="mt-0.5 text-[11px]" style={{ ...SANS, color: 'var(--color-text-muted)' }}>
            {stageSubtitle}
          </span>
        </div>

        {stage === 'payment' ? (
          <div
            key="payment"
            style={{
              animationName: direction === 'back' ? 'slideInBack' : 'slideIn',
              animationDuration: '0.4s',
              animationFillMode: 'both',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setDirection('back');
                setStage('plan');
              }}
              style={{
                ...SANS,
                fontSize: '11px',
                color: 'var(--color-text-muted)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: 0,
              }}
            >
              ← {tc('back')}
            </button>

            <h1
              style={{
                ...PLAYFAIR,
                fontSize: '26px',
                fontWeight: 700,
                color: 'var(--color-text-primary)',
                letterSpacing: '-0.3px',
                lineHeight: '1.15',
                marginBottom: '24px',
              }}
            >
              {t('stageThreeTitle')}
            </h1>

            <div style={{ marginBottom: '6px' }}>
              <div
                style={{
                  ...SANS,
                  fontSize: '9px',
                  color: 'var(--color-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '1.5px',
                  marginBottom: '5px',
                }}
              >
                {t('yourCenter')}
              </div>
              <div
                style={{
                  ...PLAYFAIR,
                  fontSize: '20px',
                  fontWeight: 700,
                  color: 'var(--color-text-primary)',
                  lineHeight: '1.1',
                }}
              >
                {form.centerName}
              </div>
              <div
                style={{
                  ...SANS,
                  fontSize: '11px',
                  color: 'var(--color-text-muted)',
                  marginTop: '3px',
                }}
              >
                {CITY_SUMMARY_LABEL[form.city as keyof typeof CITY_SUMMARY_LABEL] || form.city}
              </div>
            </div>

            <div style={{ height: '1px', background: 'var(--color-border)', margin: '16px 0' }} />

            {orderSummaryRows.map(({ lineId, label, val, serif }) => (
              <div
                key={lineId}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}
              >
                <span style={{ ...SANS, fontSize: '11px', color: 'var(--color-text-muted)' }}>{label}</span>
                <span
                  style={{
                    ...(serif ? PLAYFAIR : SANS),
                    fontSize: '11px',
                    color: serif ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    fontWeight: serif ? 600 : 400,
                  }}
                >
                  {val}
                </span>
              </div>
            ))}

            {form.referralCode ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
                <span style={{ ...SANS, fontSize: '11px', color: 'var(--color-text-muted)' }}>{t('referralCode')}</span>
                <span
                  style={{
                    ...SANS,
                    fontSize: '11px',
                    color: 'var(--color-teal)',
                    fontFamily: 'monospace',
                    letterSpacing: '1px',
                  }}
                >
                  {form.referralCode}
                </span>
              </div>
            ) : null}

            <div style={{ height: '1px', background: 'var(--color-border)', margin: '14px 0' }} />

            {taxRows.map(({ taxKey, label, val, teal }, idx) => (
              <div
                key={`${taxKey}-${idx}`}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }}
              >
                <span style={{ ...SANS, fontSize: '11px', color: 'var(--color-text-muted)' }}>{label}</span>
                <span
                  style={{
                    ...SANS,
                    fontSize: teal ? '10px' : '11px',
                    color: teal ? 'var(--color-teal)' : 'var(--color-text-muted)',
                  }}
                >
                  {val}
                </span>
              </div>
            ))}

            {/* Promo code section */}
            <div style={{ marginTop: '14px' }}>
              {appliedPromo ? (
                /* Applied promo badge */
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: '8px', background: 'var(--color-teal-soft)', border: '1px solid var(--color-border-brand)' }}>
                  <div>
                    <span style={{ ...SANS, fontSize: '11px', fontWeight: 700, color: 'var(--color-teal)', letterSpacing: '1px' }}>
                      {appliedPromo.code}
                    </span>
                    <span style={{ ...SANS, fontSize: '10px', color: 'var(--color-teal)', marginInlineStart: '8px' }}>
                      {t('promoApplied', {
                        discountPct: String(appliedPromo.discountPct),
                        savings: formatNumber(appliedPromo.savingsEgp, locale),
                      })}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setAppliedPromo(null); setShowPromoInput(false); }}
                    style={{ ...SANS, fontSize: '10px', color: 'var(--color-danger)', background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                  >
                    {t('promoRemove')}
                  </button>
                </div>
              ) : hasActiveReferral ? (
                /* Blocked: referral is active */
                <div style={{ padding: '9px 12px', borderRadius: '8px', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                  <p style={{ ...SANS, fontSize: '11px', color: 'var(--color-text-muted)', margin: 0, lineHeight: '1.5' }}>
                    {t('removeReferralToUsePromo')}{' '}
                    <button
                      type="button"
                      onClick={() => {
                        updateForm('referralCode', '');
                        setAppliedReferralCode(null);
                      }}
                      style={{ ...SANS, fontSize: '11px', color: 'var(--color-danger)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600 }}
                    >
                      {t('promoRemove')}
                    </button>
                  </p>
                </div>
              ) : !showPromoInput ? (
                /* Entry point */
                <button
                  type="button"
                  onClick={() => setShowPromoInput(true)}
                  style={{ ...SANS, fontSize: '11px', color: 'var(--color-text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  + {t('havePromoCode')}
                </button>
              ) : (
                /* Input form */
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                    <input
                      type="text"
                      dir="ltr"
                      value={promoInputValue}
                      onChange={(e) => {
                        setPromoInputValue(e.target.value.toUpperCase());
                        setPromoError('');
                      }}
                      placeholder={t('promoCodePlaceholder')}
                      style={{
                        ...SANS,
                        flex: 1,
                        fontSize: '13px',
                        background: 'var(--color-surface-2)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '8px',
                        padding: '8px 12px',
                        color: 'var(--color-text-primary)',
                        outline: 'none',
                        letterSpacing: '1px',
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') void applyPromo(); }}
                    />
                    <button
                      type="button"
                      onClick={() => void applyPromo()}
                      disabled={promoLoading || !promoInputValue.trim()}
                      style={{
                        ...SANS,
                        fontSize: '12px',
                        fontWeight: 600,
                        background: 'var(--color-teal)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '8px 14px',
                        cursor: 'pointer',
                        opacity: promoLoading || !promoInputValue.trim() ? 0.5 : 1,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {promoLoading ? '...' : t('promoApplyButton')}
                    </button>
                  </div>
                  {promoError ? (
                    <p style={{ ...SANS, fontSize: '11px', color: 'var(--color-danger)', margin: 0 }}>{promoError}</p>
                  ) : null}
                </div>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
                paddingTop: '14px',
                borderTop: '1px solid var(--color-border)',
                marginTop: '8px',
              }}
            >
              <div>
                <div
                  style={{
                    ...SANS,
                    fontSize: '9px',
                    color: 'var(--color-text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                  }}
                >
                  {t('dueAfterTrial')}
                </div>
              </div>
              <div style={{ textAlign: 'end' }}>
                {appliedPromo ? (
                  <div style={{ ...SANS, fontSize: '11px', color: 'var(--color-text-muted)', textDecoration: 'line-through', textAlign: 'end' }}>
                    {formatNumber(appliedPromo.originalAmountEgp, locale)} EGP
                  </div>
                ) : null}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '6px',
                    justifyContent: 'flex-end',
                  }}
                >
                  <div
                    style={{
                      ...PLAYFAIR,
                      fontSize: '26px',
                      fontWeight: 700,
                      color: appliedPromo ? 'var(--color-teal)' : 'var(--color-text-primary)',
                      lineHeight: '1',
                      letterSpacing: '-0.3px',
                    }}
                  >
                    {selectedPlan
                      ? formatNumber(
                          appliedPromo
                            ? appliedPromo.discountedAmountEgp
                            : getTotalAmount(selectedPlan, form.billingPeriod, dynamicPlanPrices),
                          locale,
                        )
                      : '0'}
                  </div>
                  <div
                    style={{
                      ...SANS,
                      fontSize: '12px',
                      color: 'var(--color-text-muted)',
                      marginBottom: '2px',
                    }}
                  >
                    EGP
                  </div>
                </div>
                <div
                  style={{
                    ...SANS,
                    fontSize: '10px',
                    color: 'var(--color-text-muted)',
                    marginTop: '4px',
                    textAlign: 'end',
                  }}
                >
                  {t('allTaxesIncluded')}
                </div>
                {selectedPlan ? (
                  <div
                    style={{
                      ...SANS,
                      fontSize: '10px',
                      color: 'var(--color-text-muted)',
                      marginTop: '2px',
                      textAlign: 'end',
                    }}
                  >
                    {renewsKey === 'renewsMonthly'
                      ? t('renewsMonthly', { amount: renewsAmount })
                      : renewsKey === 'renewsAnnually'
                        ? t('renewsAnnually', { amount: renewsAmount })
                        : t('renewsQuarterly', { amount: renewsAmount })}
                  </div>
                ) : null}
              </div>
            </div>

            {/* PDPL: two distinct, mandatory consents - terms acceptance and
                data-processing consent are separate checkboxes, both required. */}
            <div className="mt-4 flex items-start gap-2">
              <input
                type="checkbox"
                id="consent-terms"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border border-[var(--color-border-strong)] accent-[var(--color-teal)]"
                style={{ minWidth: '16px', minHeight: '16px' }}
              />
              <label
                htmlFor="consent-terms"
                className="cursor-pointer text-[11px] leading-relaxed text-[var(--color-text-muted)]"
                style={SANS}
              >
                {t.rich('consentTerms', {
                  link: (chunks) => (
                    <a
                      href={`/${locale}/legal/terms`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--color-teal)] underline hover:opacity-80"
                    >
                      {chunks}
                    </a>
                  ),
                })}
              </label>
            </div>

            <div className="mt-3 flex items-start gap-2">
              <input
                type="checkbox"
                id="consent-privacy"
                checked={privacyAccepted}
                onChange={(e) => setPrivacyAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border border-[var(--color-border-strong)] accent-[var(--color-teal)]"
                style={{ minWidth: '16px', minHeight: '16px' }}
              />
              <label
                htmlFor="consent-privacy"
                className="cursor-pointer text-[11px] leading-relaxed text-[var(--color-text-muted)]"
                style={SANS}
              >
                {t.rich('consentPrivacy', {
                  link: (chunks) => (
                    <a
                      href={`/${locale}/legal/privacy`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--color-teal)] underline hover:opacity-80"
                    >
                      {chunks}
                    </a>
                  ),
                })}
              </label>
            </div>

            {error ? (
              <div
                style={{
                  marginBottom: '12px',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid var(--color-danger)',
                  background: 'var(--color-danger-muted)',
                }}
              >
                <p style={{ ...SANS, fontSize: '12px', color: 'var(--color-danger)' }}>{error}</p>
                {error === t('errors.paymentGeneric') ? (
                  <p style={{ ...SANS, fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '8px' }}>
                    <a href="mailto:ops@ehgintelligence.com" style={{ color: 'var(--color-teal)', textDecoration: 'underline' }}>
                      ops@ehgintelligence.com
                    </a>
                  </p>
                ) : null}
              </div>
            ) : null}

            <p
              style={{
                ...SANS,
                textAlign: 'center',
                fontSize: '11px',
                color: 'var(--color-teal)',
                marginBottom: '10px',
                fontWeight: 600,
              }}
            >
              {t('noChargeToday')}
            </p>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!termsAccepted || !privacyAccepted || paymentSubmitting}
              style={{
                ...PLAYFAIR,
                width: '100%',
                padding: '14px',
                borderRadius: '12px',
                background: 'var(--color-teal)',
                color: 'white',
                border: 'none',
                fontSize: '14px',
                fontWeight: 700,
                cursor: 'pointer',
                opacity: !termsAccepted || !privacyAccepted || paymentSubmitting ? 0.35 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'opacity 0.2s',
              }}
            >
              {paymentSubmitting ? (
                <>
                  <div
                    style={{
                      width: '16px',
                      height: '16px',
                      border: '2px solid rgba(255,255,255,0.3)',
                      borderTopColor: 'white',
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                    }}
                  />
                  <span style={{ ...SANS, fontSize: '14px' }}>{t('processing')}</span>
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <rect x="1" y="11" width="22" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  {t('startFreeTrial')}
                </>
              )}
            </button>

            {!error ? (
              <div className="mt-2.5 flex w-full min-w-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-1 px-1">
                <p
                  style={{
                    ...SANS,
                    textAlign: 'center',
                    fontSize: '10px',
                    color: 'var(--color-text-secondary)',
                    marginTop: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '5px',
                    flexWrap: 'wrap',
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <rect x="1" y="11" width="22" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <span className="max-w-full whitespace-normal">{t('securedByPaymob')}</span>
                </p>
              </div>
            ) : null}

            <p
              style={{
                ...SANS,
                textAlign: 'center',
                fontSize: '10px',
                color: 'var(--color-text-muted)',
                marginTop: '6px',
                lineHeight: '1.5',
              }}
            >
              {selectedPlan
                ? (() => {
                    const recurringAmount = getTotalAmount(
                      selectedPlan,
                      form.billingPeriod,
                      dynamicPlanPrices,
                    );
                    const intervalLabel = tb(
                      `period.${form.billingPeriod}.label` as 'billing.period.monthly.label',
                    );
                    if (appliedPromo) {
                      return t('authSentence.withPromo', {
                        firstCycle: formatNumber(
                          appliedPromo.discountedAmountEgp,
                          locale,
                        ),
                        recurring: formatNumber(recurringAmount, locale),
                        interval: intervalLabel,
                      });
                    }
                    return t('authSentence.standard', {
                      amount: formatNumber(recurringAmount, locale),
                      interval: intervalLabel,
                    });
                  })()
                : null}
            </p>
          </div>
        ) : (
          <div
            key={stage}
            style={{
              animationName: slideAnim,
              animationDuration: '0.4s',
              animationTimingFunction: 'ease-out',
              animationFillMode: 'both',
            }}
          >
            {stage === 'info' ? (
              <>
                <div className="mb-10">
                  <h1
                    className="mb-2 text-[28px] font-black leading-tight tracking-tight text-[var(--color-text-primary)]"
                    style={PLAYFAIR}
                  >
                    {t('stageOneTitle')}
                  </h1>
                </div>

                <UnderlineInput
                  id="su-center"
                  required
                  label={t('centerName')}
                  value={form.centerName}
                  onChange={(v) => updateForm('centerName', v)}
                  placeholder={t('centerNamePlaceholder')}
                  tabIndex={1}
                  maxLength={80}
                  counterMax={80}
                  onBlurTrim
                  error={step1Errors.centerName}
                  afterBlur={touchValidateStep1}
                />
                <UnderlineInput
                  id="su-owner"
                  required
                  label={t('ownerName')}
                  value={form.ownerName}
                  onChange={(v) => updateForm('ownerName', v)}
                  placeholder={t('ownerNamePlaceholder')}
                  tabIndex={2}
                  maxLength={80}
                  counterMax={80}
                  onBlurTrim
                  error={step1Errors.ownerName}
                  afterBlur={touchValidateStep1}
                />
                <UnderlineInput
                  id="su-phone"
                  required
                  label={t('phone')}
                  value={form.phone}
                  onChange={(v) => updateForm('phone', v)}
                  type="tel"
                  inputMode="numeric"
                  dir="ltr"
                  placeholder={t('phonePlaceholder')}
                  hint={t('phoneHint')}
                  tabIndex={3}
                  error={step1Errors.phone}
                  afterBlur={touchValidateStep1}
                />
                <UnderlineInput
                  id="su-email"
                  label={t('email')}
                  value={form.email}
                  onChange={(v) => updateForm('email', v)}
                  type="email"
                  dir="ltr"
                  tabIndex={4}
                  error={step1Errors.email}
                  afterBlur={touchValidateStep1}
                />

                <div className="relative mb-8 pt-6">
                  <label
                    htmlFor="su-city"
                    style={{ ...SANS, color: form.city ? 'var(--color-teal)' : 'var(--color-text-muted)' }}
                    className={`pointer-events-none absolute font-medium transition-all duration-300 start-0 ${
                      form.city
                        ? 'top-0 text-[10px] tracking-wider uppercase'
                        : 'top-5 text-[13px]'
                    }`}
                  >
                    {t('city')}
                    <span className="ms-0.5" style={{ color: 'var(--color-teal)' }}>*</span>
                  </label>
                  <select
                    id="su-city"
                    data-chq-underline
                    tabIndex={5}
                    value={form.city}
                    onBlur={touchValidateStep1}
                    onChange={(e) => {
                      updateForm('city', e.target.value);
                      setStep1Errors((p) => ({ ...p, city: undefined }));
                    }}
                    aria-invalid={Boolean(step1Errors.city)}
                    className="w-full cursor-pointer transition-all duration-300"
                    style={{
                      ...PLAYFAIR,
                      width: '100%',
                      minHeight: '44px',
                      height: 'auto',
                      paddingTop: '24px',
                      paddingBottom: '10px',
                      background: 'var(--color-surface-0)',
                      backgroundColor: 'var(--color-surface-0)',
                      border: 'none',
                      borderBottom: step1Errors.city
                        ? '2px solid var(--color-danger)'
                        : form.city
                          ? '1px solid var(--color-border-strong)'
                          : '1px solid var(--color-border)',
                      color: form.city ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                      outline: 'none',
                      WebkitTextFillColor: form.city ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                      appearance: 'none',
                      cursor: 'pointer',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option
                      value=""
                      disabled
                      hidden
                      style={{
                        background: 'var(--color-surface-1)',
                        color: 'var(--color-text-primary)',
                        fontSize: '14px',
                        padding: '8px',
                      }}
                    >
                      {t('selectCity')}
                    </option>
                    {SIGNUP_CITIES.map((city) => (
                      <option
                        key={city.id}
                        value={city.id}
                        style={{
                          background: 'var(--color-surface-1)',
                          color: 'var(--color-text-primary)',
                          fontSize: '14px',
                          padding: '8px',
                        }}
                      >
                        {locale === 'ar' ? city.ar : city.en} - {locale === 'ar' ? city.en : city.ar}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute bottom-2 start-0">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--color-text-muted)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                  {step1Errors.city ? (
                    <p className="mt-1 text-[11px] text-[var(--color-danger)]" style={SANS}>
                      {step1Errors.city}
                    </p>
                  ) : null}
                </div>

                {error ? (
                  <div className="mb-4 rounded-xl border border-[var(--color-danger)] bg-[var(--color-danger-muted)] px-4 py-3">
                    <p className="text-[12px] text-[var(--color-danger)]" style={SANS}>
                      {error}
                    </p>
                  </div>
                ) : null}

                <button
                  type="button"
                  tabIndex={6}
                  onClick={() => {
                    const parsed = signupStep1Schema.safeParse({
                      phone: form.phone,
                      email: form.email.trim(),
                      centerName: form.centerName,
                      ownerName: form.ownerName,
                      city: form.city,
                    });
                    if (!parsed.success) {
                      const next: Partial<Record<string, string>> = {};
                      for (const iss of parsed.error.issues) {
                        const key = iss.path[0] as string;
                        if (key === 'phone') next.phone = t('invalidPhoneIntl');
                        else if (key === 'email') next.email = t('invalidEmail');
                        else if (key === 'centerName') next.centerName = t('centerFieldInvalid');
                        else if (key === 'ownerName') next.ownerName = t('ownerFieldInvalid');
                        else if (key === 'city') next.city = t('cityRequired');
                      }
                      setStep1Errors(next);
                      focusFirstStep1Invalid(next);
                      return;
                    }
                    const snap = {
                      ...form,
                      centerName: parsed.data.centerName,
                      ownerName: parsed.data.ownerName,
                      phone: parsed.data.phone,
                      email: parsed.data.email,
                      city: parsed.data.city,
                    };
                    setForm(snap);
                    setDirection('forward');
                    void persist(snap, 'plan', 1);
                    setStage('plan');
                    setStep1Errors({});
                  }}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--color-teal)] py-4 text-[14px] font-semibold text-white shadow-[0_4px_30px_rgba(13,148,136,0.35)] transition-all duration-300 hover:bg-[var(--color-teal-deep)] hover:shadow-[0_4px_40px_rgba(13,148,136,0.5)] active:scale-[0.98]"
                  style={PLAYFAIR}
                >
                  <span>{t('continueToPlans')}</span>
                  <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                </button>

                <p className="mt-6 text-center text-[11px] text-[var(--color-text-muted)]" style={SANS}>
                  {t('hasAccount')}{' '}
                  <Link href="/login" className="text-[var(--color-teal)] transition-colors hover:text-[var(--color-teal-deep)]">
                    {t('login')}
                  </Link>
                </p>
              </>
            ) : null}

            {stage === 'plan' ? (
              <>
                <div className="mb-8">
                  <h1
                    className="mb-2 text-[28px] font-black leading-tight tracking-tight text-[var(--color-text-primary)]"
                    style={PLAYFAIR}
                  >
                    {t('stageTwoTitle')}
                  </h1>
                  <p className="text-[12px] text-[var(--color-text-muted)]" style={SANS}>
                    {t('stageTwoSubtitle')}
                  </p>
                </div>

                <div className="mb-8 flex gap-6 border-b border-[var(--color-border)] pb-0">
                  {(['monthly', 'annual'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => updateForm('billingPeriod', p)}
                      className={`relative pb-3 text-[12px] font-semibold transition-all duration-200 ${
                        form.billingPeriod === p ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                      }`}
                      style={SANS}
                    >
                      {tb(`period.${p}.label` as 'billing.period.monthly.label')}
                      {form.billingPeriod === p ? (
                        <div className="absolute end-0 bottom-0 start-0 h-[2px] rounded-full bg-[var(--color-teal)]" />
                      ) : null}
                      {p === 'monthly' ? (
                        <span
                          className={`ms-1 text-[9px] ${form.billingPeriod === p ? 'text-[var(--color-brass)]' : 'text-[var(--color-text-muted)]'}`}
                        >
                          {t('monthlyPremiumMark')}
                        </span>
                      ) : null}
                      {p === 'annual' ? (
                        <span
                          className={`ms-1 text-[9px] ${form.billingPeriod === p ? 'text-[var(--color-teal)]' : 'text-[var(--color-text-muted)]'}`}
                        >
                          {t('annualDiscountMark')}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>

                {SIGNUP_PLANS.map((plan) => {
                  const selected = form.plan === plan.key;
                  const price = getDisplayPrice(plan, form.billingPeriod, dynamicPlanPrices);
                  const planStudents = studentsFor(plan, dynamicPlanPrices);
                  return (
                    <button
                      key={plan.key}
                      type="button"
                      onClick={() => updateForm('plan', plan.key)}
                      className={`group relative w-full border-b py-5 text-start transition-all duration-300 ${
                        selected ? 'border-[var(--color-teal)]' : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
                      }`}
                    >
                      {selected ? (
                        <div className="absolute top-0 bottom-0 start-0 w-[2px] rounded-full bg-gradient-to-b from-[var(--color-teal)] to-[var(--color-teal-deep)]" />
                      ) : null}

                      <div className="flex items-center justify-between ps-4">
                        <div className="flex items-center gap-4">
                          <div
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200 ${
                              selected ? 'border-[var(--color-teal)] bg-[var(--color-teal)]' : 'border-[var(--color-border)] group-hover:border-[var(--color-border-strong)]'
                            }`}
                          >
                            {selected ? <div className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                          </div>
                          <div>
                            <div
                              className={`text-[14px] font-bold transition-colors ${
                                selected ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'
                              }`}
                              style={PLAYFAIR}
                            >
                              {locale === 'ar' ? plan.arabicName : plan.name}
                            </div>
                            <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]" style={SANS}>
                              {t('upTo')} {formatNumber(planStudents, locale)} {t('studentsPerWeek')}
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0 text-end">
                          <div
                            className={`text-[20px] font-black leading-none transition-colors ${
                              selected ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'
                            }`}
                            style={PLAYFAIR}
                          >
                            {formatNumber(price, locale, { integerOnly: true })}
                          </div>
                          <div className="mt-0.5 text-[9px] text-[var(--color-text-muted)]" style={SANS}>
                            EGP / {t('month')}
                          </div>
                        </div>
                      </div>

                      {selected ? (
                        <div className="mt-2 flex items-center gap-4 ps-12">
                          <span className="text-[10px] text-[var(--color-text-muted)]" style={SANS}>
                            {formatNumber(getBilledAmount(plan, form.billingPeriod, dynamicPlanPrices), locale)} EGP {t('billedLabel')}
                          </span>
                          <span className="text-[10px] text-[var(--color-teal)]" style={SANS}>
                            {tb('perStudentWeekly', {
                              price: getPerStudentCost(plan, form.billingPeriod, locale, dynamicPlanPrices),
                            })}
                          </span>
                        </div>
                      ) : null}
                    </button>
                  );
                })}

                <button
                  type="button"
                  disabled={!TOP_CENTERS_WHATSAPP}
                  onClick={() => {
                    if (TOP_CENTERS_WHATSAPP) window.open(TOP_CENTERS_WHATSAPP, '_blank');
                  }}
                  className="group w-full border-b border-[var(--color-border)] py-5 text-start transition-all duration-300 hover:border-[var(--color-border-strong)] disabled:pointer-events-none disabled:opacity-40"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div
                        className="text-[14px] font-bold text-[var(--color-text-secondary)] transition-colors group-hover:text-[var(--color-text-primary)]"
                        style={PLAYFAIR}
                      >
                        {locale === 'ar' ? 'كبار السناتر' : 'Top Centers'}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]" style={SANS}>
                        {t('topCentersDesc')}
                      </div>
                    </div>
                    <div className="text-[12px] font-medium text-[var(--color-brass)]" style={PLAYFAIR}>
                      {t('customPricing')} →
                    </div>
                  </div>
                </button>

                <div className="mt-6">
                  {!showReferral ? (
                    <button
                      type="button"
                      onClick={() => setShowReferral(true)}
                      className="text-[11px] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-teal-deep)]"
                      style={SANS}
                    >
                      + {t('haveReferralCode')}
                    </button>
                  ) : appliedPromo ? (
                    /* Blocked: promo is applied on payment stage */
                    <div style={{ padding: '9px 12px', borderRadius: '8px', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                      <p style={{ ...SANS, fontSize: '11px', color: 'var(--color-text-muted)', margin: 0, lineHeight: '1.5' }}>
                        {t('removePromoToUseReferral')}{' '}
                        <button
                          type="button"
                          onClick={() => { setAppliedPromo(null); setShowPromoInput(false); }}
                          style={{ ...SANS, fontSize: '11px', color: 'var(--color-danger)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600 }}
                        >
                          {t('promoRemove')}
                        </button>
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {appliedReferralCode ? (
                        <div
                          className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--color-teal)] bg-[var(--color-teal-soft)] px-3 py-1 text-[11px] font-medium text-[var(--color-teal)]"
                          style={SANS}
                        >
                          <span>{t('referralApplied', { code: appliedReferralCode })}</span>
                          <button
                            type="button"
                            onClick={() => { setAppliedReferralCode(null); setShowReferral(false); }}
                            style={{ ...SANS, fontSize: '10px', color: 'var(--color-danger)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600 }}
                            aria-label={t('promoRemove')}
                          >
                            {t('promoRemove')}
                          </button>
                        </div>
                      ) : null}
                      <UnderlineInput
                        id="su-referral"
                        label={t('referralCode')}
                        value={form.referralCode}
                        onChange={(v) => updateForm('referralCode', v.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())}
                        placeholder={t('referralPlaceholder')}
                        dir="ltr"
                      />
                    </div>
                  )}
                </div>

                {error ? (
                  <div className="mb-4 rounded-xl border border-[var(--color-danger)] bg-[var(--color-danger-muted)] px-4 py-3">
                    <p className="text-[12px] text-[var(--color-danger)]" style={SANS}>
                      {error}
                    </p>
                  </div>
                ) : null}

                <div className="mt-10 flex gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      setDirection('back');
                      setStage('info');
                    }}
                    className="px-6 py-3.5 text-[13px] font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
                    style={SANS}
                  >
                    ← {tc('back')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDirection('forward');
                      void persist(form, 'payment', 2);
                      setStage('payment');
                    }}
                    disabled={!form.plan || !form.ownerName.trim()}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[var(--color-teal)] py-3.5 text-[14px] font-semibold text-white shadow-[0_4px_30px_rgba(13,148,136,0.35)] transition-all duration-200 hover:bg-[var(--color-teal-deep)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30"
                    style={PLAYFAIR}
                  >
                    <span>{t('reviewOrder')}</span>
                    <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                  </button>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
