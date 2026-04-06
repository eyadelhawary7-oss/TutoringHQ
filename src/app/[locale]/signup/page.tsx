'use client';

import { useState, useEffect, FormEvent, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link, useRouter, usePathname } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { Globe, CheckCircle, Check, X } from 'lucide-react';
import {
  PLANS,
  getPlanPrice,
  getPerStudentWeeklyCost,
  getSignupDisplayMonthlyPrice,
  formatPrice,
  type BillingPeriod,
  type PlanKey,
} from '@/lib/pricing';

const WHATSAPP_ADMIN = 'https://wa.me/201220601410';
const TOP_CENTERS_WHATSAPP = 'https://wa.me/201220601410?text=I%20am%20interested%20in%20the%20TOP%20CENTERS%20plan';

const SIGNUP_PLAN_ORDER: PlanKey[] = ['nano', 'starter', 'pro', 'business', 'enterprise', 'top_centers'];

const SIGNUP_PLANS = SIGNUP_PLAN_ORDER.map((value) => {
  const p = PLANS[value];
  return {
    value,
    nameAr: p.arabicName,
    nameEn: p.englishName,
    limit: p.weeklyStudentLimit ?? 0,
    perStudentWeek: value === 'top_centers' ? null : getPerStudentWeeklyCost(value),
    custom: value === 'top_centers',
  };
});

const BILLING_PERIODS: BillingPeriod[] = ['monthly', 'quarterly', 'annual'];

const inputClass =
  'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-600/50';

export default function SignupPage() {
  const t = useTranslations('signup');
  const tl = useTranslations('landing');
  const tc = useTranslations('common');
  const tb = useTranslations('billing');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('quarterly');
  const [formData, setFormData] = useState({
    centerName: '',
    ownerName: '',
    phone: '',
    email: '',
    plan: 'nano',
    referralCode: '',
    terms: false,
    city: '',
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [referralValidation, setReferralValidation] = useState<'idle' | 'valid' | 'invalid' | 'checking'>('idle');
  const searchParams = useSearchParams();

  useEffect(() => {
    const refFromUrl = searchParams?.get('ref')?.trim().toUpperCase();
    const refFromStorage = typeof window !== 'undefined' ? localStorage.getItem('referral_code')?.trim().toUpperCase() : null;
    const code = refFromUrl || refFromStorage;
    if (code) {
      setFormData((f) => ({ ...f, referralCode: code }));
    }
  }, [searchParams]);

  const handleLocaleToggle = () => {
    const next = locale === 'ar' ? 'en' : 'ar';
    startTransition(() => router.replace(pathname, { locale: next }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formData.terms) return;
    setLoading(true);
    setError('');
    try {
      let phone = formData.phone.replace(/\s/g, '').replace(/\D/g, '');
      if (!phone.startsWith('+')) {
        if (phone.startsWith('0')) phone = '+20' + phone.substring(1);
        else if (!phone.startsWith('20')) phone = '+20' + phone;
        else phone = '+' + phone;
      }
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, phone, billing_period: billingPeriod }),
      });
      const data = await response.json();
      if (response.ok) {
        setSubmitted(true);
      } else {
        setError(data.error || 'Signup failed');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const getBillingLabel = (planKey: PlanKey) => {
    const total = getPlanPrice(planKey, billingPeriod);
    const amount = formatPrice(total);
    if (billingPeriod === 'monthly') return tb('billedMonthlyLine', { amount });
    if (billingPeriod === 'quarterly') return tb('billedQuarterlyLine', { amount });
    return tb('billedAnnuallyLine', { amount });
  };

  if (submitted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#080D14] px-4 py-12 font-['Cairo',sans-serif]">
        <div className="w-full max-w-sm text-center">
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-8 shadow-xl">
            <CheckCircle size={56} className="mx-auto mb-4 text-teal-500" />
            <h2 className="mb-2 text-xl font-bold text-white">{t('requestSubmitted')}</h2>
            <p className="mb-4 text-sm leading-relaxed text-slate-300">{t('receivedRequest')}</p>

            <div className="mb-4 rounded-lg border border-slate-700 bg-slate-800/60 p-4 text-start">
              <h3 className="mb-3 text-center font-semibold text-white">{t('nextStepsTitle')}</h3>
              <ol className="space-y-2 text-sm text-slate-300">
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs text-white">1</span>
                  <span>{t('step1')}</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs text-white">2</span>
                  <span>{t('step2')}</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs text-white">3</span>
                  <span>{t('step3')}</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs text-white">4</span>
                  <span>{t('step4')}</span>
                </li>
              </ol>
            </div>

            <a
              href={WHATSAPP_ADMIN}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-teal-400 hover:underline"
            >
              {t('contactUsWhatsApp')}
            </a>

            <Link href="/" className="mt-4 block text-sm font-medium text-teal-400 hover:underline">
              ← {tc('back')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-[#080D14] px-4 py-12 font-['Cairo',sans-serif]">
      <div className="absolute end-4 top-4">
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

      <div className="w-full max-w-lg">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-teal-600 text-sm font-bold text-white">CH</div>
          <h1 className="text-xl font-bold text-white">CenterHQ</h1>
          <p className="mt-1 text-sm text-slate-400">{t('title')}</p>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
          {error ? (
            <div className="mb-4 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2.5 text-sm font-medium text-red-300">{error}</div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300" htmlFor="signup-center">
                {t('centerName')}
              </label>
              <input
                id="signup-center"
                type="text"
                value={formData.centerName}
                onChange={(e) => setFormData((f) => ({ ...f, centerName: e.target.value }))}
                placeholder={t('centerNamePlaceholder')}
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300" htmlFor="signup-owner">
                {t('ownerName')}
              </label>
              <input
                id="signup-owner"
                type="text"
                value={formData.ownerName}
                onChange={(e) => setFormData((f) => ({ ...f, ownerName: e.target.value }))}
                placeholder={t('ownerNamePlaceholder')}
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300" htmlFor="signup-phone">
                {t('phone')}
              </label>
              <input
                id="signup-phone"
                type="tel"
                inputMode="numeric"
                value={formData.phone}
                onChange={(e) => setFormData((f) => ({ ...f, phone: e.target.value }))}
                placeholder={t('phonePlaceholder')}
                className={inputClass}
                dir="ltr"
                required
              />
              <p className="mt-1 text-xs text-slate-400">{t('phoneHelper')}</p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300" htmlFor="signup-email">
                {t('email')}
              </label>
              <input
                id="signup-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData((f) => ({ ...f, email: e.target.value }))}
                className={inputClass}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300" htmlFor="signup-city">
                {t('city')}
              </label>
              <select
                id="signup-city"
                value={formData.city}
                onChange={(e) => setFormData((f) => ({ ...f, city: e.target.value }))}
                required
                className={inputClass}
              >
                <option value="">{t('selectCity')}</option>
                <option value="Cairo">القاهرة - Cairo</option>
                <option value="Giza">الجيزة - Giza</option>
                <option value="Alexandria">الإسكندرية - Alexandria</option>
                <option value="Qalyubia">القليوبية - Qalyubia</option>
                <option value="6th October">6 أكتوبر - 6th October</option>
                <option value="Nasr City">مدينة نصر - Nasr City</option>
                <option value="Heliopolis">مصر الجديدة - Heliopolis</option>
                <option value="Other">أخرى - Other</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">{tb('changePeriod')}</label>
              <div className="flex gap-1 rounded-xl bg-slate-800 p-1">
                {BILLING_PERIODS.map((period) => (
                  <button
                    key={period}
                    type="button"
                    onClick={() => setBillingPeriod(period)}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                      billingPeriod === period ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <span className="block">{tb(`period.${period}.label` as 'billing.period.monthly.label')}</span>
                    {period === 'monthly' ? (
                      <span className="block text-[10px] opacity-70">{tb('period.monthly.premium')}</span>
                    ) : null}
                    {period === 'quarterly' ? (
                      <span className="block text-[10px] opacity-70">{tb('period.quarterly.recommended')}</span>
                    ) : null}
                    {period === 'annual' ? (
                      <span className="block text-[10px] opacity-70">{tb('period.annual.free')}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-slate-300">{t('selectPlan')}</p>
              <div className="grid grid-cols-1 gap-2">
                {SIGNUP_PLANS.map((plan) => {
                  const selected = formData.plan === plan.value;
                  const baseCard =
                    'cursor-pointer rounded-xl border p-4 transition-all ' +
                    (plan.custom
                      ? 'border-amber-500/60 bg-slate-800/50 shadow-[0_0_12px_rgba(245,158,11,0.2)] hover:border-amber-500'
                      : selected
                        ? 'border-teal-600 bg-teal-900/20'
                        : 'border-slate-700 bg-slate-800/50 hover:border-teal-600/50');
                  const displayMonthly =
                    !plan.custom && plan.value !== 'top_centers'
                      ? getSignupDisplayMonthlyPrice(plan.value, billingPeriod)
                      : 0;
                  return (
                    <div
                      key={plan.value}
                      role="button"
                      tabIndex={0}
                      className={baseCard}
                      onClick={() => {
                        if (plan.custom) {
                          window.open(TOP_CENTERS_WHATSAPP, '_blank');
                        } else {
                          setFormData((f) => ({ ...f, plan: plan.value }));
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (plan.custom) {
                            window.open(TOP_CENTERS_WHATSAPP, '_blank');
                          } else {
                            setFormData((f) => ({ ...f, plan: plan.value }));
                          }
                        }
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-white">{locale === 'ar' ? plan.nameAr : plan.nameEn}</div>
                          {!plan.custom ? (
                            <div className="text-xs text-slate-400">
                              {tb('studentsLimit', { limit: plan.limit.toLocaleString('en-US') })}
                            </div>
                          ) : (
                            <div className="text-xs text-slate-400">{t('topCentersDesc')}</div>
                          )}
                        </div>
                        <div className="text-end">
                          {plan.custom ? (
                            <div className="font-bold text-white">{tl('custom')}</div>
                          ) : (
                            <>
                              <div className="font-bold text-white">
                                {displayMonthly.toLocaleString('en-US')} {tc('egp')}
                              </div>
                              <div className="text-xs text-slate-500">{t('perMonthAbbr')}</div>
                            </>
                          )}
                        </div>
                      </div>
                      {!plan.custom ? (
                        <>
                          <p className="mt-2 text-xs text-slate-400">{getBillingLabel(plan.value)}</p>
                          {plan.perStudentWeek != null ? (
                            <p className="mt-1 text-xs font-medium text-teal-400/90">
                              • {tb('perStudentWeekly', { price: formatPrice(plan.perStudentWeek) })}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <p className="mt-2 text-xs font-medium text-amber-400/90">{t('contactWhatsApp')}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300" htmlFor="signup-referral">
                {t('referralCode')}
              </label>
              <div className="relative">
                <input
                  id="signup-referral"
                  type="text"
                  value={formData.referralCode}
                  onChange={(e) => {
                    setFormData((f) => ({ ...f, referralCode: e.target.value }));
                    setReferralValidation('idle');
                  }}
                  onBlur={async () => {
                    const code = formData.referralCode.trim().toUpperCase();
                    if (!code) {
                      setReferralValidation('idle');
                      return;
                    }
                    setReferralValidation('checking');
                    try {
                      const res = await fetch('/api/referral/validate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ code }),
                      });
                      const data = await res.json();
                      setReferralValidation(data.valid ? 'valid' : 'invalid');
                    } catch {
                      setReferralValidation('invalid');
                    }
                  }}
                  placeholder={t('referralPlaceholder')}
                  className={`${inputClass} uppercase`}
                  dir="ltr"
                />
                {referralValidation === 'valid' ? (
                  <span className="absolute end-3 top-1/2 flex -translate-y-1/2 items-center gap-1 text-sm text-emerald-400">
                    <Check className="h-4 w-4" /> {locale === 'ar' ? '✓ كود صحيح' : 'Valid code'}
                  </span>
                ) : null}
                {referralValidation === 'invalid' ? (
                  <span className="absolute end-3 top-1/2 flex -translate-y-1/2 items-center gap-1 text-sm text-red-400">
                    <X className="h-4 w-4" /> {locale === 'ar' ? 'كود غير صحيح' : 'Invalid code'}
                  </span>
                ) : null}
                {referralValidation === 'checking' ? (
                  <span className="absolute end-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                    {locale === 'ar' ? 'جاري التحقق...' : 'Checking...'}
                  </span>
                ) : null}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300" htmlFor="signup-notes">
                {t('notes')}
              </label>
              <textarea
                id="signup-notes"
                value={formData.notes}
                onChange={(e) => setFormData((f) => ({ ...f, notes: e.target.value }))}
                placeholder={t('notesPlaceholder')}
                rows={2}
                className={inputClass}
              />
            </div>

            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={formData.terms}
                onChange={(e) => setFormData((f) => ({ ...f, terms: e.target.checked }))}
                className="peer sr-only"
              />
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-teal-500 ${
                  formData.terms ? 'border-teal-500 bg-teal-600' : 'border-slate-600 bg-slate-800'
                }`}
                aria-hidden
              >
                {formData.terms ? (
                  <svg viewBox="0 0 10 8" className="h-3 w-3 stroke-white" fill="none" strokeWidth="1.5">
                    <path d="M9 1L3.5 7 1 4.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </span>
              <span className="text-sm leading-relaxed text-slate-300">{t('terms')}</span>
            </label>

            <button
              type="submit"
              disabled={loading || !formData.terms}
              className="w-full rounded-xl bg-teal-600 py-3.5 text-base font-bold tracking-wide text-white shadow-md transition-all hover:bg-teal-500 disabled:opacity-50"
            >
              {loading ? t('submitting') : t('submit')}
            </button>
          </form>

          <p className="mt-4 text-center text-sm text-slate-400">
            {t('hasAccount')}{' '}
            <Link href="/login" className="font-semibold text-teal-400 hover:underline">
              {t('login')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
