import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Globe, CheckCircle, MessageCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useLanguage } from '@/contexts/LanguageContext';

const PLANS = [
  { value: 'starter', name: 'سنتر صغير', subtitle: 'Starter · حتى 150 طالب', fee: 2000, limit: 150, perStudentWeek: '3.33' },
  { value: 'pro', name: 'سنتر متوسط', subtitle: 'Pro · حتى 500 طالب', fee: 4500, limit: 500, perStudentWeek: '2.25' },
  { value: 'business', name: 'سنتر كبير', subtitle: 'Business · حتى 1,000 طالب', fee: 6500, limit: 1000, perStudentWeek: '1.63' },
  { value: 'enterprise', name: 'سنتر ضخم', subtitle: 'Enterprise · حتى 2,000 طالب', fee: 9000, limit: 2000, perStudentWeek: '1.13' },
  { value: 'top_centers', name: 'ميجا سنتر', subtitle: 'Top Centers · 2,000+ طالب', fee: 0, limit: 0, custom: true, perStudentWeek: null },
];

export default function Signup() {
  const { t } = useTranslation();
  const { locale, setLocale } = useLanguage();
  const [form, setForm] = useState({
    centerName: '', ownerName: '', phone: '', email: '', plan: 'pro', referralCode: '', terms: false,
  });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.terms) return;
    setLoading(true);
    await new Promise(r => setTimeout(r, 1200));
    setLoading(false);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12" style={{ background: 'var(--gradient-hero)' }}>
        <div className="w-full max-w-sm text-center">
          <div className="rounded-2xl border border-white/10 p-8 shadow-xl" style={{ background: 'hsl(var(--card) / 0.95)', backdropFilter: 'blur(20px)' }}>
            <CheckCircle size={56} className="mx-auto mb-4" style={{ color: 'hsl(var(--scanner-green))' }} />
            <h2 className="text-xl font-bold text-foreground mb-2">{t('signup.successTitle')}</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">{t('signup.successMessage')}</p>
            <Link to="/" className="mt-6 block text-sm font-medium" style={{ color: 'hsl(var(--primary))' }}>← {t('common.back')}</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12" style={{ background: 'var(--gradient-hero)' }}>
      {/* Language toggle */}
      <div className="absolute top-4 end-4">
        <button
          onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/20 text-white/70 hover:text-white transition-colors"
        >
          <Globe size={13} />
          <span>{locale === 'ar' ? 'EN' : 'ع'}</span>
        </button>
      </div>

      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-black text-xl mb-3 shadow-lg" style={{ background: 'hsl(var(--primary))' }}>CH</div>
          <h1 className="text-xl font-black text-white">CenterHQ</h1>
          <p className="text-white/50 text-sm mt-1">{t('signup.title')}</p>
        </div>

        <div className="rounded-2xl border border-white/10 p-6 shadow-xl" style={{ background: 'hsl(var(--card) / 0.95)', backdropFilter: 'blur(20px)' }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Center Name */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t('signup.centerName')}</label>
              <input
                type="text"
                value={form.centerName}
                onChange={e => setForm(f => ({ ...f, centerName: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>

            {/* Owner Name */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t('signup.ownerName')}</label>
              <input
                type="text"
                value={form.ownerName}
                onChange={e => setForm(f => ({ ...f, ownerName: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t('signup.phone')}</label>
              <input
                type="tel"
                inputMode="numeric"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="01XXXXXXXXX"
                className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                dir="ltr"
                required
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t('signup.email')}</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Plan */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">{t('signup.plan')}</label>
              <div className="grid grid-cols-1 gap-2">
                {PLANS.map(plan => {
                  if (plan.custom) {
                    return (
                      <div
                        key={plan.value}
                        className="relative rounded-xl p-3"
                        style={{
                          background: '#FEF3C7',
                          border: '1.5px solid #B45309',
                        }}
                      >
                        <div className="absolute -top-2.5 end-3 px-2 py-0.5 rounded-full text-white font-bold" style={{ background: '#B45309', fontSize: '11px' }}>
                          👑 ميجا سنتر
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-1">
                          <span className="font-semibold text-sm" style={{ color: '#0F172A' }}>{plan.name}</span>
                          <span className="text-sm font-bold font-mono" style={{ color: '#B45309' }}>{t('landing.custom')}</span>
                        </div>
                        <p className="mt-0.5" style={{ color: '#64748B', fontSize: '13px' }}>{plan.subtitle}</p>
                        <a
                          href="https://wa.me/201220601410"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2.5 flex items-center justify-center gap-2 w-full rounded-full text-sm font-semibold transition-colors hover:bg-green-50"
                          style={{ border: '1.5px solid #25D366', color: '#25D366', background: 'white', height: '40px' }}
                        >
                          <MessageCircle size={15} />
                          <span>تواصل معنا على واتساب</span>
                        </a>
                      </div>
                    );
                  }
                  return (
                    <label
                      key={plan.value}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                        form.plan === plan.value
                          ? 'border-primary/60 bg-primary/5'
                          : 'border-border hover:border-primary/30'
                      }`}
                    >
                      <input
                        type="radio"
                        name="plan"
                        value={plan.value}
                        checked={form.plan === plan.value}
                        onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
                        className="hidden"
                      />
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${form.plan === plan.value ? 'border-primary' : 'border-border'}`}>
                        {form.plan === plan.value && <div className="w-2 h-2 rounded-full" style={{ background: 'hsl(var(--primary))' }} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-sm text-foreground">{plan.name}</span>
                          <span className="text-sm font-bold text-foreground font-mono">{plan.fee.toLocaleString()} {t('common.egp')}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{plan.subtitle}</p>
                        {plan.perStudentWeek && (
                          <p className="text-xs font-medium mt-0.5" style={{ color: '#16A34A' }}>بس {plan.perStudentWeek} جنيه للطالب أسبوعياً</p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Referral */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t('signup.referralCode')}</label>
              <input
                type="text"
                value={form.referralCode}
                onChange={e => setForm(f => ({ ...f, referralCode: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring uppercase"
                dir="ltr"
              />
            </div>

            {/* Terms */}
            <label className="flex items-start gap-3 cursor-pointer">
              <div
                onClick={() => setForm(f => ({ ...f, terms: !f.terms }))}
                className={`w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5 border-2 transition-colors ${form.terms ? 'border-primary' : 'border-border'}`}
                style={form.terms ? { background: 'hsl(var(--primary))' } : {}}
              >
                {form.terms && <svg viewBox="0 0 10 8" className="w-3 h-3 fill-white"><path d="M9 1L3.5 7 1 4.5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <span className="text-sm text-muted-foreground leading-relaxed">{t('signup.terms')}</span>
            </label>

            <button
              type="submit"
              disabled={loading || !form.terms}
              className="w-full py-3 rounded-xl font-bold text-white text-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
              style={{ background: 'hsl(var(--primary))' }}
            >
              {loading ? t('common.loading') : t('signup.submit')}
            </button>
          </form>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            {t('signup.alreadyAccount')}{' '}
            <Link to="/login" className="font-semibold hover:underline" style={{ color: 'hsl(var(--primary))' }}>
              {t('signup.loginLink')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
