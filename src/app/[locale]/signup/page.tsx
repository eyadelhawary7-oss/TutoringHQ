'use client';

import { useState, useEffect, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link, useRouter, usePathname } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { Globe } from 'lucide-react';

const TOP_CENTERS_WHATSAPP =
  'https://wa.me/201220601410?text=I%20am%20interested%20in%20the%20TOP%20CENTERS%20plan';

const CITIES = [
  { id: 'cairo', ar: 'القاهرة', en: 'Cairo', emoji: '🏙️' },
  { id: 'giza', ar: 'الجيزة', en: 'Giza', emoji: '🏛️' },
  { id: 'alexandria', ar: 'الإسكندرية', en: 'Alexandria', emoji: '🌊' },
  { id: 'sixth_october', ar: '6 أكتوبر', en: '6th October', emoji: '🏘️' },
  { id: 'sheikh_zayed', ar: 'الشيخ زايد', en: 'Sheikh Zayed', emoji: '✨' },
  { id: 'nasr_city', ar: 'مدينة نصر', en: 'Nasr City', emoji: '🌆' },
  { id: 'new_cairo', ar: 'القاهرة الجديدة', en: 'New Cairo', emoji: '🏗️' },
  { id: 'heliopolis', ar: 'مصر الجديدة', en: 'Heliopolis', emoji: '🌿' },
  { id: 'maadi', ar: 'المعادي', en: 'Maadi', emoji: '🌳' },
  { id: 'other', ar: 'أخرى', en: 'Other', emoji: '📍' },
] as const;

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

const PERIODS: BillingPeriodUi[] = ['monthly', 'quarterly', 'annual'];

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

function FloatingInput({
  label,
  value,
  onChange,
  type = 'text',
  placeholder = '',
  hint = '',
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
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  dir?: 'ltr' | 'rtl';
  id?: string;
}) {
  const [focused, setFocused] = useState(false);
  const active = focused || value.length > 0;

  return (
    <div className="relative mb-5">
      <label
        htmlFor={id}
        className={`pointer-events-none absolute z-10 transition-all duration-200 start-4 ${
          active ? 'top-2 text-[10px] font-medium text-teal-400' : 'top-4 text-sm text-slate-500'
        }`}
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={active ? placeholder : ''}
        inputMode={inputMode}
        dir={dir}
        className={`w-full rounded-2xl border bg-slate-900 px-4 pb-3 pt-7 text-sm text-white transition-all duration-200 outline-none ${
          focused
            ? 'border-teal-500 shadow-[0_0_0_3px_rgba(13,148,136,0.15)]'
            : 'border-slate-700/60 hover:border-slate-600'
        }`}
      />
      {hint ? <p className="mt-1.5 px-1 text-xs text-slate-500">{hint}</p> : null}
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
  const progressPct = stage === 'info' ? 33 : stage === 'plan' ? 66 : 100;
  const slideAnim = direction === 'forward' ? 'slideIn' : 'slideInBack';

  const cityLabel = (id: string) => {
    const c = CITIES.find((x) => x.id === id);
    if (!c) return id;
    return locale === 'ar' ? c.ar : c.en;
  };

  if (stage === 'success') {
    return (
      <div
        data-chq-signup
        className="flex min-h-screen flex-col items-center justify-center bg-[#080D14] p-6 text-center font-['Cairo',sans-serif]"
      >
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border-2 border-teal-500 bg-teal-900/40 shadow-[0_0_40px_rgba(13,148,136,0.3)]">
          <svg
            width="36"
            height="36"
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
        <h2 className="mb-3 text-2xl font-bold text-white">{t('successTitle')}</h2>
        <p className="max-w-sm leading-relaxed text-slate-400">{t('successDesc')}</p>
        <Link href="/login" className="mt-8 text-sm font-semibold text-teal-400 hover:underline">
          {t('login')}
        </Link>
      </div>
    );
  }

  return (
    <div
      data-chq-signup
      className="relative flex min-h-screen flex-col bg-[#080D14] font-['Cairo',sans-serif]"
    >
      <div
        className="fixed start-0 end-0 top-0 z-50 h-[3px] bg-slate-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressPct}
      >
        <div
          className="h-full bg-gradient-to-r from-teal-600 to-teal-400 transition-all duration-700 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="absolute end-4 top-6 z-40">
        <button
          type="button"
          onClick={handleLocaleToggle}
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:text-white"
        >
          <Globe size={13} />
          <span>{locale === 'ar' ? 'EN' : 'ع'}</span>
        </button>
      </div>

      <div className="mx-auto flex max-w-lg flex-col px-4 pt-16 pb-12">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-xl bg-teal-600 text-sm font-black text-white">
            CH
          </div>
          <div className="text-lg font-bold text-white">CenterHQ</div>
          <p className="mt-1 text-sm text-slate-400">
            {stage === 'info'
              ? t('headlineInfo')
              : stage === 'plan'
                ? t('headlinePlan')
                : t('headlinePayment')}
          </p>
        </div>

        {error ? (
          <div className="mb-4 rounded-2xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm font-medium text-red-300">
            {error}
          </div>
        ) : null}

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
              <h1 className="mb-8 text-center text-2xl font-bold text-white">{t('headlineInfo')}</h1>
              <FloatingInput
                id="su-center"
                label={t('centerName')}
                value={form.centerName}
                onChange={(v) => updateForm('centerName', v)}
                placeholder={t('centerNamePlaceholder')}
              />
              <FloatingInput
                id="su-owner"
                label={t('ownerName')}
                value={form.ownerName}
                onChange={(v) => updateForm('ownerName', v)}
                placeholder={t('ownerNamePlaceholder')}
              />
              <FloatingInput
                id="su-phone"
                label={t('phone')}
                value={form.phone}
                onChange={(v) => updateForm('phone', v)}
                type="tel"
                inputMode="numeric"
                dir="ltr"
                placeholder={t('phonePlaceholder')}
                hint={t('phoneHelper')}
              />
              <FloatingInput
                id="su-email"
                label={t('email')}
                value={form.email}
                onChange={(v) => updateForm('email', v)}
                type="email"
                dir="ltr"
              />

              <div className="mb-5">
                <label className="mb-3 block text-sm text-slate-400">{t('city')}</label>
                <div className="grid grid-cols-2 gap-2">
                  {CITIES.map((city) => (
                    <button
                      key={city.id}
                      type="button"
                      onClick={() => updateForm('city', city.id)}
                      className={`flex items-center gap-2.5 rounded-2xl border p-3 text-sm font-medium transition-all duration-200 ${
                        form.city === city.id
                          ? 'border-teal-500 bg-teal-950/40 text-white shadow-[0_0_0_3px_rgba(13,148,136,0.15)]'
                          : 'border-slate-700/60 bg-slate-900 text-slate-400 hover:border-slate-500 hover:text-white'
                      }`}
                    >
                      <span className="text-lg">{city.emoji}</span>
                      <span>{locale === 'ar' ? city.ar : city.en}</span>
                      {form.city === city.id ? (
                        <svg
                          className="ms-auto h-3.5 w-3.5 text-teal-400"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setDirection('forward');
                  setStage('plan');
                }}
                disabled={!form.centerName || !form.phone || !form.city}
                className="w-full rounded-2xl bg-teal-600 py-4 text-base font-semibold text-white shadow-[0_4px_24px_rgba(13,148,136,0.3)] transition-all duration-200 hover:bg-teal-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('continueToPlans')} →
              </button>
            </>
          ) : null}

          {stage === 'plan' ? (
            <>
              <h1 className="mb-2 text-center text-2xl font-bold text-white">{t('headlinePlan')}</h1>
              <p className="mb-8 text-center text-sm text-slate-400">{t('subtitlePlan')}</p>

              <div className="relative mb-8 flex rounded-2xl border border-slate-700/60 bg-slate-900 p-1">
                <div
                  className="absolute top-1 bottom-1 rounded-xl bg-teal-600 transition-all duration-300 ease-out"
                  style={{
                    width: 'calc(33.33% - 4px)',
                    insetInlineStart: `calc(${
                      form.billingPeriod === 'monthly' ? '0' : form.billingPeriod === 'quarterly' ? '33.33' : '66.66'
                    }% + 4px)`,
                  }}
                />
                {PERIODS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => updateForm('billingPeriod', p)}
                    className={`relative z-10 flex-1 rounded-xl py-2.5 text-center text-xs font-semibold transition-colors duration-300 ${
                      form.billingPeriod === p ? 'text-white' : 'text-slate-400'
                    }`}
                  >
                    <div>{tb(`period.${p}.label` as 'billing.period.monthly.label')}</div>
                    <div className="mt-0.5 text-[10px] font-normal opacity-80">
                      {p === 'monthly' ? t('monthlyPremiumMark') : null}
                      {p === 'quarterly' ? tb('period.quarterly.recommended') : null}
                      {p === 'annual' ? tb('period.annual.free') : null}
                    </div>
                  </button>
                ))}
              </div>

              {SIGNUP_PLANS.map((plan) => (
                <button
                  key={plan.key}
                  type="button"
                  onClick={() => updateForm('plan', plan.key)}
                  className={`relative mb-3 w-full overflow-hidden rounded-3xl border-2 p-5 text-start transition-all duration-300 ${
                    form.plan === plan.key
                      ? 'border-teal-500 bg-gradient-to-br from-teal-950/60 to-slate-900 shadow-[0_0_30px_rgba(13,148,136,0.2)]'
                      : 'border-slate-700/40 bg-slate-900/60 hover:border-slate-600'
                  }`}
                >
                  {plan.key === 'starter' ? (
                    <div className="absolute top-4 start-4 rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-bold text-white">
                      {t('mostPopular')}
                    </div>
                  ) : null}

                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200 ${
                          form.plan === plan.key ? 'border-teal-500 bg-teal-500' : 'border-slate-600'
                        }`}
                      >
                        {form.plan === plan.key ? <div className="h-2 w-2 rounded-full bg-white" /> : null}
                      </div>
                      <div>
                        <div className="text-base font-bold text-white">
                          {locale === 'ar' ? plan.arabicName : plan.name}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {t('upTo')} {plan.students.toLocaleString('en-US')} {t('studentsPerWeek')}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 text-end ms-4">
                      <div className="text-xl font-black text-white">
                        {getDisplayPrice(plan, form.billingPeriod).toLocaleString('en-US')}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {tc('egp')} / {t('month')}
                      </div>
                    </div>
                  </div>

                  {form.plan === plan.key ? (
                    <div className="mt-3 flex items-center gap-4 border-t border-teal-900/60 pt-3 text-xs text-slate-400">
                      <span>
                        {getBilledAmount(plan, form.billingPeriod).toLocaleString('en-US')} {tc('egp')}{' '}
                        {t('billedLabel')}
                      </span>
                      <span className="text-teal-500">
                        {tb('perStudentWeekly', { price: getPerStudentCost(plan, form.billingPeriod) })}
                      </span>
                    </div>
                  ) : null}
                </button>
              ))}

              <button
                type="button"
                onClick={() => window.open(TOP_CENTERS_WHATSAPP, '_blank')}
                className="mb-3 w-full rounded-3xl border-2 border-amber-600/40 bg-amber-950/20 p-5 text-start transition-all duration-300 hover:border-amber-500/60"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-white">{t('topCentersTitle')}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{t('topCentersDesc')}</div>
                  </div>
                  <div className="text-sm font-semibold text-amber-400">{t('customPricing')}</div>
                </div>
              </button>

              {!showReferral ? (
                <button
                  type="button"
                  onClick={() => setShowReferral(true)}
                  className="mb-6 block text-xs text-slate-500 underline decoration-transparent underline-offset-2 transition-colors hover:text-teal-400 hover:decoration-teal-400"
                >
                  {t('haveReferralCode')}
                </button>
              ) : (
                <div className="mb-6">
                  <FloatingInput
                    id="su-ref"
                    label={t('referralCode')}
                    value={form.referralCode}
                    onChange={(v) => updateForm('referralCode', v.toUpperCase())}
                    placeholder={t('referralPlaceholder')}
                    dir="ltr"
                  />
                </div>
              )}

              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDirection('back');
                    setStage('info');
                  }}
                  className="flex-1 rounded-2xl border border-slate-700 py-4 text-sm font-semibold text-slate-400 transition-all duration-200 hover:border-slate-500 hover:text-white"
                >
                  {tc('back')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDirection('forward');
                    setStage('payment');
                  }}
                  disabled={!form.plan || !form.ownerName.trim()}
                  className="flex-[2] rounded-2xl bg-teal-600 py-4 font-semibold text-white shadow-[0_4px_24px_rgba(13,148,136,0.3)] transition-all duration-200 hover:bg-teal-500 active:scale-[0.98] disabled:opacity-40"
                >
                  {t('reviewOrder')} →
                </button>
              </div>
            </>
          ) : null}

          {stage === 'payment' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setDirection('back');
                  setStage('plan');
                }}
                className="mb-6 flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-white"
              >
                ← {tc('back')}
              </button>

              <h1 className="mb-6 text-center text-2xl font-bold text-white">{t('headlinePayment')}</h1>

              <div className="mb-6 rounded-3xl border border-slate-700/60 bg-slate-900 p-5">
                <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-teal-700/50 bg-teal-900/40">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0D9488" strokeWidth="2">
                      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                      <polyline points="9 22 9 12 15 12 15 22" />
                    </svg>
                  </div>
                  <div>
                    <div className="font-bold text-white">{form.centerName}</div>
                    <div className="text-xs text-slate-500">{cityLabel(form.city)}</div>
                  </div>
                </div>

                <div className="space-y-2 border-b border-slate-800 py-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">{t('plan')}</span>
                    <span className="font-medium text-white">
                      {selectedPlan ? (locale === 'ar' ? selectedPlan.arabicName : selectedPlan.name) : ''}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">{tb('changePeriod')}</span>
                    <span className="font-medium text-white">
                      {tb(`period.${form.billingPeriod}.label` as 'billing.period.monthly.label')}
                    </span>
                  </div>
                  {form.referralCode ? (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">{t('referralCode')}</span>
                      <span className="font-mono font-medium text-teal-400">{form.referralCode}</span>
                    </div>
                  ) : null}
                </div>

                <div className="pt-4">
                  <div className="flex items-end justify-between">
                    <span className="text-sm text-slate-400">{t('totalDue')}</span>
                    <div className="text-end">
                      <div className="text-2xl font-black text-white">
                        {getTotalAmount(selectedPlan, form.billingPeriod).toLocaleString('en-US')} {tc('egp')}
                      </div>
                      <div className="text-xs text-slate-500">
                        {selectedPlan
                          ? t('thenMonthly', {
                              price: getDisplayPrice(selectedPlan, form.billingPeriod).toLocaleString('en-US'),
                            })
                          : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <label className="group mb-6 flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={form.agreeTerms}
                  onChange={(e) => updateForm('agreeTerms', e.target.checked)}
                  className="sr-only"
                />
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-all duration-200 ${
                    form.agreeTerms
                      ? 'border-teal-600 bg-teal-600'
                      : 'border-slate-600 group-hover:border-slate-400'
                  }`}
                  aria-hidden
                >
                  {form.agreeTerms ? (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : null}
                </span>
                <span className="text-sm leading-relaxed text-slate-400">{t('terms')}</span>
              </label>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={!form.agreeTerms || loading}
                className="flex w-full items-center justify-center gap-3 rounded-2xl bg-teal-600 py-4 text-base font-bold text-white shadow-[0_8px_32px_rgba(13,148,136,0.4)] transition-all duration-200 hover:bg-teal-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="1" y="11" width="22" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    {t('confirmAndPay')}
                  </>
                )}
              </button>

              <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-slate-600">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="1" y="11" width="22" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {t('securedByPaymob')}
              </p>
            </>
          ) : null}
        </div>

        <p className="mt-8 text-center text-sm text-slate-400">
          {t('hasAccount')}{' '}
          <Link href="/login" className="font-semibold text-teal-400 hover:underline">
            {t('login')}
          </Link>
        </p>
      </div>
    </div>
  );
}
