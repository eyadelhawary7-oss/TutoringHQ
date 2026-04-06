'use client';

import { useState, useEffect, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link, useRouter, usePathname } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { Globe } from 'lucide-react';

const PLAYFAIR = {
  fontFamily: "var(--font-playfair), 'Didot', 'Bodoni MT', Georgia, serif",
} as const;
const SANS = { fontFamily: 'system-ui, -apple-system, sans-serif' } as const;

const TOP_CENTERS_WHATSAPP =
  'https://wa.me/201220601410?text=I%20am%20interested%20in%20the%20TOP%20CENTERS%20plan';

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

const SIGNUP_PLANS = [
  {
    key: 'nano',
    name: 'Nano',
    arabicName: 'ناشئ',
    students: 100,
    allInPrice: 2000,
    monthlyPrice: 2500,
    annualPrice: 20400,
  },
  {
    key: 'starter',
    name: 'Starter',
    arabicName: 'أساسي',
    students: 250,
    allInPrice: 4500,
    monthlyPrice: 5200,
    annualPrice: 45900,
  },
  {
    key: 'pro',
    name: 'Pro',
    arabicName: 'محترف',
    students: 500,
    allInPrice: 8000,
    monthlyPrice: 9200,
    annualPrice: 81600,
  },
  {
    key: 'business',
    name: 'Business',
    arabicName: 'أعمال',
    students: 1000,
    allInPrice: 13000,
    monthlyPrice: 15000,
    annualPrice: 132600,
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    arabicName: 'مؤسسات',
    students: 2000,
    allInPrice: 18500,
    monthlyPrice: 21300,
    annualPrice: 188700,
  },
] as const;

type SignupPlan = (typeof SIGNUP_PLANS)[number];
type BillingPeriodUi = 'monthly' | 'quarterly' | 'annual';

function display99Price(price: number): number {
  if (!Number.isFinite(price) || price <= 1) return price;
  return price - 1;
}

function getDisplayPrice(plan: SignupPlan, period: string): number {
  const base =
    period === 'monthly'
      ? plan.monthlyPrice
      : period === 'annual'
        ? Math.round(plan.annualPrice / 12)
        : plan.allInPrice;
  return display99Price(base);
}

function getTotalAmount(plan: SignupPlan | undefined, period: string): number {
  if (!plan) return 0;
  if (period === 'monthly') return display99Price(plan.monthlyPrice);
  if (period === 'annual') return display99Price(plan.annualPrice);
  return display99Price(plan.allInPrice * 3);
}

function getPerStudentCost(plan: SignupPlan, period: string): string {
  const monthly = getDisplayPrice(plan, period);
  const weekly = monthly / 4.33;
  const perStudent = weekly / plan.students;
  return perStudent.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getBilledAmount(plan: SignupPlan, period: string): number {
  return getTotalAmount(plan, period);
}

const getPeriodDateRange = (period: string): string => {
  const now = new Date();
  const start = now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const end = new Date(now);
  if (period === 'monthly') end.setMonth(end.getMonth() + 1);
  else if (period === 'quarterly') end.setMonth(end.getMonth() + 3);
  else end.setFullYear(end.getFullYear() + 1);
  const endStr = end.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
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
}) {
  const [focused, setFocused] = useState(false);
  const active = focused || value.length > 0;

  return (
    <div className="group relative mb-8">
      <label
        htmlFor={id}
        style={SANS}
        className={`pointer-events-none absolute font-medium transition-all duration-300 start-0 ${
          active
            ? 'top-0 text-[10px] tracking-wider text-teal-400 uppercase'
            : 'top-5 text-[13px] text-slate-500'
        }`}
      >
        {label}
        {required ? <span className="ms-0.5 text-teal-500">*</span> : null}
      </label>
      <input
        id={id}
        data-chq-underline
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={active ? placeholder : ''}
        inputMode={inputMode}
        dir={dir}
        className="w-full border-0 border-b bg-transparent pt-6 pb-2 text-white outline-none transition-all duration-300 placeholder-slate-600"
        style={{
          ...PLAYFAIR,
          fontSize: '15px',
          borderBottomColor: focused ? '#0D9488' : value ? '#334155' : '#1e293b',
          borderBottomWidth: focused ? '2px' : '1px',
        }}
      />
      {focused ? (
        <div className="animate-[expandWidth_0.3s_ease-out] absolute end-0 bottom-0 start-0 h-[2px] origin-start rounded-full bg-gradient-to-r from-teal-600 to-teal-300" />
      ) : null}
      {hint ? (
        <p className="mt-2 text-[11px] text-slate-600" style={SANS}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type Stage = 'info' | 'plan' | 'payment' | 'success';

export default function SignupPage() {
  const t = useTranslations('signup');
  const tc = useTranslations('common');
  const tb = useTranslations('billing');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [stage, setStage] = useState<Stage>('info');
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [form, setForm] = useState({
    centerName: '',
    ownerName: '',
    phone: '',
    email: '',
    city: '',
    plan: 'starter',
    billingPeriod: 'quarterly' as BillingPeriodUi,
    referralCode: '',
    notes: '',
    agreeTerms: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showReferral, setShowReferral] = useState(false);

  useEffect(() => {
    const refFromUrl = searchParams?.get('ref')?.trim().toUpperCase();
    const refFromStorage =
      typeof window !== 'undefined' ? localStorage.getItem('referral_code')?.trim().toUpperCase() : null;
    const code = refFromUrl || refFromStorage;
    if (code) {
      setForm((f) => ({ ...f, referralCode: code }));
      setShowReferral(true);
    }
  }, [searchParams]);

  const updateForm = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleLocaleToggle = () => {
    const next = locale === 'ar' ? 'en' : 'ar';
    startTransition(() => router.replace(pathname, { locale: next }));
  };

  const handleSubmit = async () => {
    if (!form.agreeTerms || loading) return;
    setLoading(true);
    setError('');
    try {
      let phone = form.phone.replace(/\s/g, '').replace(/\D/g, '');
      if (!phone.startsWith('+')) {
        if (phone.startsWith('0')) phone = '+20' + phone.substring(1);
        else if (!phone.startsWith('20')) phone = '+20' + phone;
        else phone = '+' + phone;
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
          referralCode: form.referralCode || null,
          notes: form.notes,
          initiatePayment: true,
        }),
      });
      const data = (await res.json()) as { error?: string; paymentUrl?: string; success?: boolean };
      if (!res.ok) {
        if (data.error === 'phone_exists') setError(t('errorPhoneExists'));
        else if (data.error === 'phone_blacklisted') setError(t('errorPhoneBlacklisted'));
        else if (data.error === 'payment_unavailable') setError(t('paymentUnavailable'));
        else setError(data.error || t('errorGeneric'));
        return;
      }
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl;
      } else if (data.success) {
        setStage('success');
      }
    } catch {
      setError(t('errorGeneric'));
    } finally {
      setLoading(false);
    }
  };

  const selectedPlan = SIGNUP_PLANS.find((p) => p.key === form.plan);
  const slideAnim = direction === 'forward' ? 'slideIn' : 'slideInBack';

  const stageSubtitle =
    stage === 'info' ? t('stageOneSubtitle') : stage === 'plan' ? t('stageTwoSubtitle') : t('stageThreeTitle');

  const progressWidth = stage === 'info' ? '33%' : stage === 'plan' ? '66%' : '100%';
  const progressNow = stage === 'info' ? 33 : stage === 'plan' ? 66 : 100;

  if (stage === 'success') {
    return (
      <div
        data-chq-signup
        className="relative flex min-h-screen flex-col items-center justify-center bg-[#080D14] p-8 text-center font-['Cairo',sans-serif]"
      >
        <div className="pointer-events-none fixed inset-0" aria-hidden>
          <div
            className="absolute top-1/2 left-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(13,148,136,0.15) 0%, transparent 70%)',
            }}
          />
        </div>
        <div className="relative z-10">
          <div className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-full border border-teal-700/50 bg-teal-950/50 shadow-[0_0_40px_rgba(13,148,136,0.3)]">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#0D9488"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="mb-3 text-[32px] font-black tracking-tight text-white" style={PLAYFAIR}>
            {t('successTitle')}
          </h2>
          <p className="mx-auto max-w-xs text-[13px] leading-relaxed text-slate-500" style={SANS}>
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
        ? `${t('upTo')} ${selectedPlan.students.toLocaleString('en-US')} ${t('studentsPerWeek')}`
        : '',
      serif: false,
    },
    {
      lineId: 'billing',
      label: tb('changePeriod'),
      val: tb(`period.${form.billingPeriod}.label` as 'billing.period.monthly.label'),
      serif: true,
    },
    {
      lineId: 'periodRange',
      label: t('periodLabel'),
      val: getPeriodDateRange(form.billingPeriod),
      serif: false,
    },
  ];

  const taxRows: { taxKey: string; label: string; val: string; teal: boolean }[] = [
    {
      taxKey: 'subtotal',
      label: t('subtotal'),
      val: selectedPlan ? `${getTotalAmount(selectedPlan, form.billingPeriod).toLocaleString('en-US')} EGP` : '',
      teal: false,
    },
    { taxKey: 'vat', label: 'VAT 14%', val: t('included'), teal: true },
    { taxKey: 'service', label: t('serviceFee'), val: t('included'), teal: true },
    { taxKey: 'stamp', label: t('stampDuty'), val: t('included'), teal: true },
  ];

  return (
    <div data-chq-signup className="relative min-h-screen bg-[#080D14] font-['Cairo',sans-serif]">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div
          className="absolute top-[-20%] left-1/2 h-[600px] w-[600px] -translate-x-1/2 rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(13,148,136,0.12) 0%, transparent 70%)',
            animation: 'breathe 6s ease-in-out infinite',
          }}
        />
      </div>

      <div
        className="fixed top-0 right-0 left-0 z-50 h-[2px] bg-slate-800/50"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressNow}
      >
        <div
          className="h-full bg-gradient-to-r from-teal-600 to-teal-300 transition-all duration-700 ease-out"
          style={{ width: progressWidth }}
        />
      </div>

      <div className="absolute end-4 top-6 z-40">
        <button
          type="button"
          onClick={handleLocaleToggle}
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-[10px] font-medium text-slate-300 transition-colors hover:text-white"
        >
          <Globe size={13} />
          <span>{locale === 'ar' ? 'EN' : 'ع'}</span>
        </button>
      </div>

      <div className="relative z-10 mx-auto max-w-md px-6 pt-14 pb-20">
        <div className="mb-12 flex flex-col items-center">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-teal-600 shadow-[0_0_20px_rgba(13,148,136,0.4)]">
            <span className="text-sm font-black text-white">CH</span>
          </div>
          <div className="logo-name text-base font-bold tracking-wide text-white" style={PLAYFAIR}>
            CenterHQ
          </div>
          <span className="mt-0.5 text-[11px] text-slate-600" style={SANS}>
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
                color: '#475569',
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
                color: '#f8fafc',
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
                  color: '#334155',
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
                  color: '#f8fafc',
                  lineHeight: '1.1',
                }}
              >
                {form.centerName}
              </div>
              <div
                style={{
                  ...SANS,
                  fontSize: '11px',
                  color: '#475569',
                  marginTop: '3px',
                }}
              >
                {CITY_SUMMARY_LABEL[form.city as keyof typeof CITY_SUMMARY_LABEL] || form.city}
              </div>
            </div>

            <div style={{ height: '1px', background: '#0f172a', margin: '16px 0' }} />

            {orderSummaryRows.map(({ lineId, label, val, serif }) => (
              <div
                key={lineId}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}
              >
                <span style={{ ...SANS, fontSize: '11px', color: '#475569' }}>{label}</span>
                <span
                  style={{
                    ...(serif ? PLAYFAIR : SANS),
                    fontSize: '11px',
                    color: serif ? '#f8fafc' : '#64748b',
                    fontWeight: serif ? 600 : 400,
                  }}
                >
                  {val}
                </span>
              </div>
            ))}

            {form.referralCode ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
                <span style={{ ...SANS, fontSize: '11px', color: '#475569' }}>{t('referralCode')}</span>
                <span
                  style={{
                    ...SANS,
                    fontSize: '11px',
                    color: '#0D9488',
                    fontFamily: 'monospace',
                    letterSpacing: '1px',
                  }}
                >
                  {form.referralCode}
                </span>
              </div>
            ) : null}

            <div style={{ height: '1px', background: '#0f172a', margin: '14px 0' }} />

            {taxRows.map(({ taxKey, label, val, teal }, idx) => (
              <div
                key={`${taxKey}-${idx}`}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }}
              >
                <span style={{ ...SANS, fontSize: '11px', color: '#475569' }}>{label}</span>
                <span
                  style={{
                    ...SANS,
                    fontSize: teal ? '10px' : '11px',
                    color: teal ? '#0D9488' : '#64748b',
                  }}
                >
                  {val}
                </span>
              </div>
            ))}

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
                paddingTop: '14px',
                borderTop: '1px solid #1e293b',
                marginTop: '8px',
              }}
            >
              <div>
                <div
                  style={{
                    ...SANS,
                    fontSize: '9px',
                    color: '#334155',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                  }}
                >
                  {t('totalDue')}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div
                  style={{
                    ...PLAYFAIR,
                    fontSize: '26px',
                    fontWeight: 700,
                    color: '#f8fafc',
                    lineHeight: '1',
                    letterSpacing: '-0.3px',
                  }}
                >
                  {selectedPlan
                    ? `${getTotalAmount(selectedPlan, form.billingPeriod).toLocaleString('en-US')} EGP`
                    : '0 EGP'}
                </div>
                <div
                  style={{
                    ...SANS,
                    fontSize: '10px',
                    color: '#334155',
                    marginTop: '4px',
                  }}
                >
                  {t('allTaxesIncluded')}
                </div>
                <div
                  style={{
                    ...SANS,
                    fontSize: '10px',
                    color: '#334155',
                    marginTop: '2px',
                  }}
                >
                  {selectedPlan
                    ? t('thenMonthly', {
                        price: getDisplayPrice(selectedPlan, form.billingPeriod).toLocaleString('en-US'),
                      })
                    : ''}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', margin: '22px 0 16px' }}>
              <button
                type="button"
                aria-pressed={form.agreeTerms}
                onClick={() => updateForm('agreeTerms', !form.agreeTerms)}
                style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: '4px',
                  border: `1.5px solid ${form.agreeTerms ? '#0D9488' : '#1e293b'}`,
                  background: form.agreeTerms ? '#0D9488' : 'transparent',
                  flexShrink: 0,
                  marginTop: '1px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                }}
              >
                {form.agreeTerms ? (
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : null}
              </button>
              <span style={{ ...SANS, fontSize: '12px', color: '#475569', lineHeight: '1.6' }}>{t('terms')}</span>
            </div>

            {error ? (
              <div
                style={{
                  marginBottom: '12px',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid rgba(239,68,68,0.3)',
                  background: 'rgba(127,29,29,0.2)',
                }}
              >
                <p style={{ ...SANS, fontSize: '12px', color: '#f87171' }}>{error}</p>
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!form.agreeTerms || loading}
              style={{
                ...PLAYFAIR,
                width: '100%',
                padding: '14px',
                borderRadius: '12px',
                background: '#0D9488',
                color: 'white',
                border: 'none',
                fontSize: '14px',
                fontWeight: 700,
                cursor: 'pointer',
                opacity: !form.agreeTerms || loading ? 0.35 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'opacity 0.2s',
              }}
            >
              {loading ? (
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
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <rect x="1" y="11" width="22" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  {t('confirmAndPay')}
                </>
              )}
            </button>

            <p
              style={{
                ...SANS,
                textAlign: 'center',
                fontSize: '10px',
                color: '#1e293b',
                marginTop: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="1" y="11" width="22" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              {t('securedByPaymob')}
            </p>

            <p
              style={{
                ...SANS,
                textAlign: 'center',
                fontSize: '10px',
                color: '#1e293b',
                marginTop: '6px',
                lineHeight: '1.5',
              }}
            >
              {t('authNote', {
                amount: selectedPlan
                  ? getTotalAmount(selectedPlan, form.billingPeriod).toLocaleString('en-US')
                  : '0',
                period: tb(`period.${form.billingPeriod}.label` as 'billing.period.monthly.label'),
              })}
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
                    className="mb-2 text-[28px] font-black leading-tight tracking-tight text-white"
                    style={PLAYFAIR}
                  >
                    {t('stageOneTitle')}
                  </h1>
                  <p className="text-[12px] text-slate-500" style={SANS}>
                    {t('stageOneSubtitle')}
                  </p>
                </div>

                <UnderlineInput
                  id="su-center"
                  required
                  label={t('centerName')}
                  value={form.centerName}
                  onChange={(v) => updateForm('centerName', v)}
                  placeholder={t('centerNamePlaceholder')}
                />
                <UnderlineInput
                  id="su-owner"
                  required
                  label={t('ownerName')}
                  value={form.ownerName}
                  onChange={(v) => updateForm('ownerName', v)}
                  placeholder={t('ownerNamePlaceholder')}
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
                />
                <UnderlineInput
                  id="su-email"
                  label={t('email')}
                  value={form.email}
                  onChange={(v) => updateForm('email', v)}
                  type="email"
                  dir="ltr"
                />

                <div className="relative mb-8">
                  <label
                    htmlFor="su-city"
                    style={SANS}
                    className={`pointer-events-none absolute font-medium transition-all duration-300 start-0 ${
                      form.city
                        ? 'top-0 text-[10px] tracking-wider text-teal-400 uppercase'
                        : 'top-5 text-[13px] text-slate-500'
                    }`}
                  >
                    {t('city')}
                    <span className="ms-0.5 text-teal-500">*</span>
                  </label>
                  <select
                    id="su-city"
                    data-chq-underline
                    value={form.city}
                    onChange={(e) => updateForm('city', e.target.value)}
                    className="w-full cursor-pointer appearance-none border-0 border-b bg-transparent pt-6 pb-2 text-[14px] text-white outline-none transition-all duration-300"
                    style={{
                      ...PLAYFAIR,
                      borderBottomColor: form.city ? '#334155' : '#1e293b',
                      borderBottomWidth: '1px',
                    }}
                  >
                    <option value="" disabled hidden style={{ background: '#080D14' }}>
                      {t('selectCity')}
                    </option>
                    <option value="cairo" style={{ background: '#0f172a' }}>
                      القاهرة - Cairo
                    </option>
                    <option value="giza" style={{ background: '#0f172a' }}>
                      الجيزة - Giza
                    </option>
                    <option value="alexandria" style={{ background: '#0f172a' }}>
                      الإسكندرية - Alexandria
                    </option>
                    <option value="sixth_october" style={{ background: '#0f172a' }}>
                      6 أكتوبر - 6th October
                    </option>
                    <option value="sheikh_zayed" style={{ background: '#0f172a' }}>
                      الشيخ زايد - Sheikh Zayed
                    </option>
                    <option value="nasr_city" style={{ background: '#0f172a' }}>
                      مدينة نصر - Nasr City
                    </option>
                    <option value="new_cairo" style={{ background: '#0f172a' }}>
                      القاهرة الجديدة - New Cairo
                    </option>
                    <option value="heliopolis" style={{ background: '#0f172a' }}>
                      مصر الجديدة - Heliopolis
                    </option>
                    <option value="maadi" style={{ background: '#0f172a' }}>
                      المعادي - Maadi
                    </option>
                    <option value="other" style={{ background: '#0f172a' }}>
                      أخرى - Other
                    </option>
                  </select>
                  <div className="pointer-events-none absolute bottom-2 start-0">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#475569"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </div>

                {error ? (
                  <div className="mb-4 rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3">
                    <p className="text-[12px] text-red-400" style={SANS}>
                      {error}
                    </p>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => {
                    setDirection('forward');
                    setStage('plan');
                  }}
                  disabled={!form.centerName || !form.phone || !form.city}
                  className="mt-4 w-full rounded-2xl bg-teal-600 py-4 text-[14px] font-semibold text-white shadow-[0_4px_30px_rgba(13,148,136,0.35)] transition-all duration-300 hover:bg-teal-500 hover:shadow-[0_4px_40px_rgba(13,148,136,0.5)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30"
                  style={PLAYFAIR}
                >
                  {t('continueToPlans')} →
                </button>

                <p className="mt-6 text-center text-[11px] text-slate-700" style={SANS}>
                  {t('hasAccount')}{' '}
                  <Link href="/login" className="text-teal-600 transition-colors hover:text-teal-400">
                    {t('login')}
                  </Link>
                </p>
              </>
            ) : null}

            {stage === 'plan' ? (
              <>
                <div className="mb-8">
                  <h1
                    className="mb-2 text-[28px] font-black leading-tight tracking-tight text-white"
                    style={PLAYFAIR}
                  >
                    {t('stageTwoTitle')}
                  </h1>
                  <p className="text-[12px] text-slate-500" style={SANS}>
                    {t('stageTwoSubtitle')}
                  </p>
                </div>

                <div className="mb-8 flex gap-6 border-b border-slate-800 pb-0">
                  {(['monthly', 'quarterly', 'annual'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => updateForm('billingPeriod', p)}
                      className={`relative pb-3 text-[12px] font-semibold transition-all duration-200 ${
                        form.billingPeriod === p ? 'text-white' : 'text-slate-600 hover:text-slate-400'
                      }`}
                      style={SANS}
                    >
                      {tb(`period.${p}.label` as 'billing.period.monthly.label')}
                      {form.billingPeriod === p ? (
                        <div className="absolute end-0 bottom-0 start-0 h-[2px] rounded-full bg-teal-500" />
                      ) : null}
                      {p === 'monthly' ? (
                        <span
                          className={`ms-1 text-[9px] ${form.billingPeriod === p ? 'text-amber-400' : 'text-slate-700'}`}
                        >
                          +15%
                        </span>
                      ) : null}
                      {p === 'annual' ? (
                        <span
                          className={`ms-1 text-[9px] ${form.billingPeriod === p ? 'text-teal-400' : 'text-slate-700'}`}
                        >
                          -15%
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>

                {SIGNUP_PLANS.map((plan) => {
                  const selected = form.plan === plan.key;
                  const price = getDisplayPrice(plan, form.billingPeriod);
                  return (
                    <button
                      key={plan.key}
                      type="button"
                      onClick={() => updateForm('plan', plan.key)}
                      className={`group relative w-full border-b py-5 text-start transition-all duration-300 ${
                        selected ? 'border-teal-900' : 'border-slate-800/60 hover:border-slate-700'
                      }`}
                    >
                      {selected ? (
                        <div className="absolute top-0 bottom-0 start-0 w-[2px] rounded-full bg-gradient-to-b from-teal-500 to-teal-700" />
                      ) : null}

                      <div className="flex items-center justify-between ps-4">
                        <div className="flex items-center gap-4">
                          <div
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200 ${
                              selected ? 'border-teal-500 bg-teal-500' : 'border-slate-700 group-hover:border-slate-500'
                            }`}
                          >
                            {selected ? <div className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                          </div>
                          <div>
                            <div
                              className={`text-[14px] font-bold transition-colors ${
                                selected ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
                              }`}
                              style={PLAYFAIR}
                            >
                              {locale === 'ar' ? plan.arabicName : plan.name}
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-600" style={SANS}>
                              {t('upTo')} {plan.students.toLocaleString('en-US')} {t('studentsPerWeek')}
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0 text-end">
                          <div
                            className={`text-[20px] font-black leading-none transition-colors ${
                              selected ? 'text-white' : 'text-slate-400'
                            }`}
                            style={PLAYFAIR}
                          >
                            {price.toLocaleString('en-US')}
                          </div>
                          <div className="mt-0.5 text-[9px] text-slate-600" style={SANS}>
                            EGP / {t('month')}
                          </div>
                        </div>
                      </div>

                      {selected ? (
                        <div className="mt-2 flex items-center gap-4 ps-12">
                          <span className="text-[10px] text-slate-600" style={SANS}>
                            {getBilledAmount(plan, form.billingPeriod).toLocaleString('en-US')} EGP {t('billedLabel')}
                          </span>
                          <span className="text-[10px] text-teal-600" style={SANS}>
                            {tb('perStudentWeekly', { price: getPerStudentCost(plan, form.billingPeriod) })}
                          </span>
                        </div>
                      ) : null}

                      {plan.key === 'starter' ? (
                        <div className="absolute top-5 end-0">
                          <span
                            className="text-[9px] font-semibold tracking-wider text-teal-400 uppercase"
                            style={SANS}
                          >
                            {t('mostPopular')}
                          </span>
                        </div>
                      ) : null}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => window.open(TOP_CENTERS_WHATSAPP, '_blank')}
                  className="group w-full border-b border-slate-800/60 py-5 text-start transition-all duration-300 hover:border-slate-700"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div
                        className="text-[14px] font-bold text-slate-400 transition-colors group-hover:text-slate-200"
                        style={PLAYFAIR}
                      >
                        {locale === 'ar' ? 'كبار السناتر' : 'Top Centers'}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-600" style={SANS}>
                        {t('topCentersDesc')}
                      </div>
                    </div>
                    <div className="text-[12px] font-medium text-amber-500/70" style={PLAYFAIR}>
                      {t('customPricing')} →
                    </div>
                  </div>
                </button>

                <div className="mt-6">
                  {!showReferral ? (
                    <button
                      type="button"
                      onClick={() => setShowReferral(true)}
                      className="text-[11px] text-slate-700 transition-colors hover:text-teal-500"
                      style={SANS}
                    >
                      + {t('haveReferralCode')}
                    </button>
                  ) : (
                    <UnderlineInput
                      id="su-ref"
                      label={t('referralCode')}
                      value={form.referralCode}
                      onChange={(v) => updateForm('referralCode', v.toUpperCase())}
                      placeholder="NASR-7X4K"
                      dir="ltr"
                    />
                  )}
                </div>

                {error ? (
                  <div className="mb-4 rounded-xl border border-red-900/50 bg-red-950/30 px-4 py-3">
                    <p className="text-[12px] text-red-400" style={SANS}>
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
                    className="px-6 py-3.5 text-[13px] font-medium text-slate-600 transition-colors hover:text-white"
                    style={SANS}
                  >
                    ← {tc('back')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDirection('forward');
                      setStage('payment');
                    }}
                    disabled={!form.plan || !form.ownerName.trim()}
                    className="flex-1 rounded-2xl bg-teal-600 py-3.5 text-[14px] font-semibold text-white shadow-[0_4px_30px_rgba(13,148,136,0.35)] transition-all duration-200 hover:bg-teal-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30"
                    style={PLAYFAIR}
                  >
                    {t('reviewOrder')} →
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
