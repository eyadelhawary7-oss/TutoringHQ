'use client';

import { useState, useEffect, FormEvent, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link, useRouter, usePathname } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { Globe, CheckCircle, Check, X } from 'lucide-react';
import { PLAN_TIERS, getEffectiveMonthlyRate, getTotalForPeriod, getPerStudentPerWeek } from '@/lib/plan-tiers';
import type { BillingPeriod } from '@/lib/plan-tiers';

const WHATSAPP_ADMIN = 'https://wa.me/201220601410';
const TOP_CENTERS_WHATSAPP = 'https://wa.me/201220601410?text=I%20am%20interested%20in%20the%20TOP%20CENTERS%20plan';

const PLANS = PLAN_TIERS.map((p) => ({
  value: p.id,
  nameAr: p.nameAr,
  nameEn: p.nameEn,
  fee: p.monthlyFee,
  limit: p.maxStudentsPerWeek,
  setupFee: p.setupFee,
  perStudentWeek: p.isCustom ? null : getPerStudentPerWeek(p),
  custom: p.isCustom ?? false,
}));

type BillingPeriodOption = {
  value: BillingPeriod
  label: string
  badge?: string
}

const BILLING_PERIODS: BillingPeriodOption[] = [
  { value: 'monthly', label: 'شهري' },
  { value: 'quarterly', label: 'ربع سنوي' },
  { value: 'biannual', label: 'نصف سنوي' },
  { value: 'yearly', label: 'سنوي', badge: 'شهرين مجاناً' },
];

export default function SignupPage() {
  const t = useTranslations('signup');
  const tl = useTranslations('landing');
  const tc = useTranslations('common');
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
    plan: 'nascent',
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
    const newLocale = locale === 'ar' ? 'en' : 'ar';
    localStorage.setItem('preferred-locale', newLocale);
    startTransition(() => {
      router.replace(pathname, { locale: newLocale as 'ar' | 'en' });
    });
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
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12" style={{ background: 'var(--gradient-hero)' }}>
        <div className="w-full max-w-sm text-center">
          <div className="rounded-2xl border border-white/10 p-8 shadow-xl" style={{ background: 'hsl(var(--card) / 0.95)', backdropFilter: 'blur(20px)' }}>
            <CheckCircle size={56} className="mx-auto mb-4" style={{ color: 'hsl(var(--scanner-green))' }} />
            <h2 className="text-xl font-bold text-foreground mb-2">{t('requestSubmitted')}</h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-4">{t('receivedRequest')}</p>

            <div className="rounded-lg p-4 mb-4 text-start border border-border" style={{ background: 'hsl(var(--accent) / 0.5)' }}>
              <h3 className="font-semibold text-foreground mb-3 text-center">{t('nextStepsTitle')}</h3>
              <ol className="space-y-2 text-muted-foreground text-sm">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs text-white" style={{ background: 'hsl(var(--primary))' }}>1</span>
                  <span>{t('step1')}</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs text-white" style={{ background: 'hsl(var(--primary))' }}>2</span>
                  <span>{t('step2')}</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs text-white" style={{ background: 'hsl(var(--primary))' }}>3</span>
                  <span>{t('step3')}</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs text-white" style={{ background: 'hsl(var(--primary))' }}>4</span>
                  <span>{t('step4')}</span>
                </li>
              </ol>
            </div>

            <a
              href={WHATSAPP_ADMIN}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 hover:underline text-sm"
              style={{ color: 'hsl(var(--primary))' }}
            >
              {t('contactUsWhatsApp')}
            </a>

            <Link href="/" className="mt-4 block text-sm font-medium" style={{ color: 'hsl(var(--primary))' }}>
              ← {tc('back')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const getBillingLabel = (planFee: number) => {
    const period = billingPeriod as BillingPeriod;
    const total = getTotalForPeriod(planFee, period);
    if (period === 'monthly') return `يُدفع شهرياً: ${total.toLocaleString('en-US')} جنيه`;
    if (period === 'quarterly') return `يُدفع كل 3 شهور: ${total.toLocaleString('en-US')} جنيه`;
    if (period === 'biannual') return `يُدفع كل 6 شهور: ${total.toLocaleString('en-US')} جنيه`;
    if (period === 'yearly') return `يُدفع سنوياً: ${total.toLocaleString('en-US')} جنيه`;
    return '';
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12 font-['Cairo',sans-serif]" style={{ background: 'var(--gradient-hero)', fontFamily: "'Cairo', sans-serif" }} dir="rtl">
      {/* Language toggle */}
      <div className="absolute top-4 end-4">
        <button
          onClick={handleLocaleToggle}
          disabled={isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/20 text-white/70 hover:text-white transition-colors"
        >
          <Globe size={13} />
          <span>{locale === 'ar' ? 'EN' : 'ع'}</span>
        </button>
      </div>

      <div className="w-full max-w-lg">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-black text-xl mb-3 shadow-lg" style={{ background: 'hsl(var(--primary))' }}>CH</div>
          <h1 className="text-xl font-black text-white">CenterHQ</h1>
          <p className="text-white/50 text-sm mt-1">{t('title')}</p>
        </div>

        <div className="rounded-2xl border border-white/10 p-6 shadow-xl" style={{ background: 'hsl(var(--card) / 0.95)', backdropFilter: 'blur(20px)' }}>
            {error && (
            <div className="rounded-lg px-3 py-2.5 text-sm font-medium mb-4" style={{ background: 'hsl(var(--destructive) / 0.1)', color: 'hsl(var(--destructive))' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Center Name */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t('centerName')}</label>
              <input
                type="text"
                value={formData.centerName}
                onChange={e => setFormData(f => ({ ...f, centerName: e.target.value }))}
                placeholder={t('centerNamePlaceholder')}
                className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>

            {/* Owner Name */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t('ownerName')}</label>
              <input
                type="text"
                value={formData.ownerName}
                onChange={e => setFormData(f => ({ ...f, ownerName: e.target.value }))}
                placeholder={t('ownerNamePlaceholder')}
                className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t('phone')}</label>
              <input
                type="tel"
                inputMode="numeric"
                value={formData.phone}
                onChange={e => setFormData(f => ({ ...f, phone: e.target.value }))}
                placeholder="+20 1XXXXXXXXX"
                className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                dir="ltr"
                required
              />
              <p className="text-muted-foreground text-xs mt-1">{t('phoneHelper')}</p>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t('email')}</label>
              <input
                type="email"
                value={formData.email}
                onChange={e => setFormData(f => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* City */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t('city')}</label>
              <select
                value={formData.city}
                onChange={e => setFormData(f => ({ ...f, city: e.target.value }))}
                required
                className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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

            {/* Billing Period */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">دورة الفاتورة</label>
              <div className="flex flex-wrap gap-2">
                {BILLING_PERIODS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setBillingPeriod(opt.value)}
                    className={`relative rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                      billingPeriod === opt.value ? 'text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                    style={billingPeriod === opt.value ? { backgroundColor: '#0D9488' } : {}}
                  >
                    {opt.label}
                    {opt.badge && (
                      <span className="absolute -top-1.5 -start-1 bg-amber-100 text-amber-700 text-xs rounded-full px-2 py-0.5 whitespace-nowrap">
                        {opt.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Plan */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">{t('selectPlan')}</label>
              <div className="grid grid-cols-1 gap-2">
                {PLANS.map(plan => (
                  <label
                    key={plan.value}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      formData.plan === plan.value
                        ? 'border-primary/60 bg-primary/5'
                        : 'border-border hover:border-primary/30'
                    }`}
                    style={plan.custom ? { border: '2px solid #F59E0B', boxShadow: '0 0 12px rgba(245,158,11,0.25)' } : {}}
                    onClick={(e) => {
                      if (plan.custom) {
                        e.preventDefault();
                        window.open(TOP_CENTERS_WHATSAPP, '_blank');
                      }
                    }}
                  >
                    <input
                      type="radio"
                      name="plan"
                      value={plan.value}
                      checked={formData.plan === plan.value}
                      onChange={e => {
                        if (!plan.custom) {
                          setFormData(f => ({ ...f, plan: e.target.value }));
                        }
                      }}
                      className="hidden"
                      disabled={plan.custom}
                    />
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${formData.plan === plan.value ? 'border-primary' : 'border-border'}`}>
                      {formData.plan === plan.value && <div className="w-2 h-2 rounded-full" style={{ background: 'hsl(var(--primary))' }} />}
                    </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-sm text-foreground">{locale === 'ar' ? plan.nameAr : plan.nameEn}</span>
                          {plan.custom ? (
                            <span className="text-sm font-bold text-muted-foreground font-mono">{tl('custom')}</span>
                          ) : (
                            <>
                              <span className="text-sm font-bold text-foreground font-mono">{getEffectiveMonthlyRate(plan.fee, billingPeriod).toLocaleString('en-US')} {tc('egp')}</span>
                              <span className="text-base font-normal text-slate-400">{tc('perMonth')}</span>
                            </>
                          )}
                        </div>
                        {!plan.custom && (
                          <>
                            <p className="text-xs text-slate-500 mt-0.5">{getBillingLabel(plan.fee)}</p>
                            {billingPeriod === 'yearly' && (
                              <span className="inline-block mt-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">شهرين مجاناً</span>
                            )}
                            <p className="text-xs text-muted-foreground mt-0.5">حتى {plan.limit.toLocaleString('en-US')} طالب/أسبوع</p>
                          </>
                        )}
                        {plan.perStudentWeek && (
                          <p className="text-xs font-medium mt-0.5" style={{ color: '#16A34A' }}>• {plan.perStudentWeek} {tc('perStudentPerWeek')}</p>
                        )}
                        {plan.custom && (
                          <p className="text-xs text-green-600 mt-0.5 font-medium">{t('contactWhatsApp')}</p>
                        )}
                      </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Referral */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{locale === 'ar' ? 'كود الإحالة (اختياري)' : 'Referral Code (optional)'}</label>
              <div className="relative">
                <input
                  type="text"
                  value={formData.referralCode}
                  onChange={e => {
                    setFormData(f => ({ ...f, referralCode: e.target.value }));
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
                  placeholder={locale === 'ar' ? 'مثال: NASR-7X4K' : 'e.g. NASR-7X4K'}
                  className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring uppercase"
                  dir="ltr"
                />
                {referralValidation === 'valid' && (
                  <span className="absolute end-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-green-600 text-sm">
                    <Check className="w-4 h-4" /> {locale === 'ar' ? '✓ كود صحيح' : 'Valid code'}
                  </span>
                )}
                {referralValidation === 'invalid' && (
                  <span className="absolute end-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-red-600 text-sm">
                    <X className="w-4 h-4" /> {locale === 'ar' ? 'كود غير صحيح' : 'Invalid code'}
                  </span>
                )}
                {referralValidation === 'checking' && (
                  <span className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{locale === 'ar' ? 'جاري التحقق...' : 'Checking...'}</span>
                )}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {t('notes')} ({t('optional')})
              </label>
              <textarea
                value={formData.notes}
                onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
                placeholder={t('notesPlaceholder')}
                rows={2}
                className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Terms */}
            <label className="flex items-start gap-3 cursor-pointer">
              <div
                onClick={() => setFormData(f => ({ ...f, terms: !f.terms }))}
                className={`w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5 border-2 transition-colors ${formData.terms ? 'border-primary' : 'border-border'}`}
                style={formData.terms ? { background: 'hsl(var(--primary))' } : {}}
              >
                {formData.terms && <svg viewBox="0 0 10 8" className="w-3 h-3 fill-white"><path d="M9 1L3.5 7 1 4.5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <span className="text-sm text-muted-foreground leading-relaxed">{t('terms')}</span>
            </label>

            <button
              type="submit"
              disabled={loading || !formData.terms}
              className="w-full py-3.5 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white font-bold rounded-xl transition-all shadow-md hover:shadow-lg text-base tracking-wide disabled:opacity-50"
            >
              {loading ? t('submitting') : t('submitRequest')}
            </button>
          </form>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            {t('alreadyHaveAccount')}{' '}
            <Link href="/login" className="font-semibold hover:underline" style={{ color: 'hsl(var(--primary))' }}>
              {t('login')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
