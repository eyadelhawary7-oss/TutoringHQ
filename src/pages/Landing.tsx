import React from 'react';
import { Link } from 'react-router-dom';
import { QrCode, CreditCard, Calendar, BarChart3, Wifi, Bluetooth, Globe, ArrowLeft } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useLanguage } from '@/contexts/LanguageContext';
import heroImage from '@/assets/hero-scanner.jpg';

const PLANS = [
  { key: 'planStarter', fee: 2000, limit: 150, setupFee: 1000, tier: 'starter' as const, perStudentWeek: '3.33', studentLabel: 'حتى 150 طالب/أسبوع' },
  { key: 'planPro', fee: 4500, limit: 500, setupFee: 2000, tier: 'pro' as const, popular: true, perStudentWeek: '2.25', studentLabel: 'حتى 500 طالب/أسبوع' },
  { key: 'planBusiness', fee: 6500, limit: 1000, setupFee: 3000, tier: 'business' as const, perStudentWeek: '1.63', studentLabel: 'حتى 1,000 طالب/أسبوع' },
  { key: 'planEnterprise', fee: 9000, limit: 2000, setupFee: 5000, tier: 'enterprise' as const, badge: 'الأفضل قيمة', perStudentWeek: '1.13', studentLabel: 'حتى 2,000 طالب/أسبوع' },
  { key: 'planTopCenters', fee: 0, limit: 0, setupFee: 0, tier: 'top_centers' as const, custom: true, perStudentWeek: null, studentLabel: '2,000+ طالب/أسبوع' },
];

const FEATURES = [
  { key: 'feature1', icon: QrCode, color: 'hsl(var(--primary))' },
  { key: 'feature2', icon: CreditCard, color: '#16A34A' },
  { key: 'feature3', icon: Calendar, color: '#7C3AED' },
  { key: 'feature4', icon: BarChart3, color: '#F59E0B' },
  { key: 'feature5', icon: Wifi, color: '#DC2626' },
  { key: 'feature6', icon: Bluetooth, color: '#0EA5E9' },
];

function formatPrice(n: number, locale: string) {
  if (locale === 'ar') {
    return new Intl.NumberFormat('ar-EG').format(n);
  }
  return new Intl.NumberFormat('en-US').format(n);
}

export default function Landing() {
  const { t } = useTranslation();
  const { locale, setLocale } = useLanguage();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'hsl(var(--background))' }}>
      {/* ─── Header ─── */}
      <header className="sticky top-0 z-40 border-b border-white/10" style={{ background: 'hsl(var(--navy))' }}>
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm" style={{ background: 'hsl(var(--primary))' }}>CH</div>
            <span className="font-bold text-white text-lg hidden sm:block">CenterHQ</span>
          </div>

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-6">
            <a href="#features" className="text-sm text-white/70 hover:text-white transition-colors">{t('landing.features')}</a>
            <a href="#pricing" className="text-sm text-white/70 hover:text-white transition-colors">{t('landing.pricing')}</a>
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-white/70 hover:text-white border border-white/20 hover:border-white/40 transition-colors"
            >
              <Globe size={13} />
              <span>{locale === 'ar' ? 'EN' : 'ع'}</span>
            </button>
            <Link
              to="/login"
              className="px-4 py-1.5 rounded-lg text-sm font-medium border border-white/30 text-white hover:bg-white/10 transition-colors"
            >
              {t('landing.login')}
            </Link>
            <Link
              to="/signup"
              className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-colors hidden sm:block"
              style={{ background: 'hsl(var(--primary))' }}
            >
              {t('landing.register')}
            </Link>
          </div>
        </div>
      </header>

      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden min-h-[560px] flex items-center" style={{ background: 'var(--gradient-hero)' }}>
        {/* Hero image */}
        <div className="absolute inset-0">
          <img src={heroImage} alt="CenterHQ Scanner" className="w-full h-full object-cover opacity-20" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, hsl(var(--navy) / 0.4), hsl(var(--navy)))' }} />
        </div>

        <div className="container mx-auto px-4 relative z-10 py-20 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium mb-6 border border-white/20" style={{ background: 'hsl(var(--primary) / 0.2)', color: 'hsl(var(--primary-light))' }}>
            <QrCode size={13} />
            <span>سناتر × QR × إنترنت</span>
          </div>
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-black text-white mb-6 tracking-tight">
            {t('landing.heroTitle')}
          </h1>
          <p className="text-lg sm:text-xl text-white/70 max-w-2xl mx-auto mb-10 leading-relaxed">
            {t('landing.heroSubtitle')}
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link
              to="/signup"
              className="px-8 py-3.5 rounded-xl font-bold text-white text-base transition-all hover:opacity-90 active:scale-95"
              style={{ background: 'hsl(var(--primary))' }}
            >
              {t('landing.register')}
            </Link>
            <Link
              to="/login"
              className="px-8 py-3.5 rounded-xl font-medium text-white text-base border border-white/30 hover:bg-white/10 transition-colors"
            >
              {t('landing.login')}
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section id="features" className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-foreground text-center mb-3">{t('landing.features')}</h2>
          <p className="text-center text-muted-foreground mb-12 max-w-lg mx-auto">كل ما تحتاجه لإدارة سنترك في مكان واحد</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(({ key, icon: Icon, color }) => (
              <div key={key} className="ch-card p-6 hover:shadow-md transition-shadow group">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110" style={{ background: `${color}18`, color }}>
                  <Icon size={24} />
                </div>
                <h3 className="font-bold text-foreground mb-2">{t(`landing.${key}Title`)}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{t(`landing.${key}Desc`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Pricing ─── */}
      <section id="pricing" className="py-20" style={{ background: 'hsl(var(--muted))' }}>
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-foreground text-center mb-3">{t('landing.pricing')}</h2>
          <p className="text-center text-muted-foreground mb-12">{t('landing.pricingNote')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 max-w-6xl mx-auto">
            {PLANS.map((plan) => (
              <div
                key={plan.key}
                className={`relative ch-card p-5 flex flex-col transition-all hover:shadow-md ${plan.popular ? 'ring-2 ring-primary scale-[1.02]' : ''} ${'badge' in plan && plan.badge ? 'ring-2 ring-green-500' : ''}`}
                style={plan.custom ? { border: '2px solid #F59E0B', boxShadow: '0 0 12px rgba(245, 158, 11, 0.3), 0 0 0 1px #F59E0B', background: 'linear-gradient(135deg, #FFFBEB 0%, #FFFFFF 100%)' } : {}}
              >
                {plan.popular && (
                  <div className="absolute -top-3 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold text-white whitespace-nowrap" style={{ background: 'hsl(var(--primary))' }}>
                    الأكثر اختياراً
                  </div>
                )}
                {'badge' in plan && plan.badge && !plan.popular && (
                  <div className="absolute -top-3 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold text-white whitespace-nowrap bg-green-600">
                    {plan.badge}
                  </div>
                )}

                <div className="mb-4">
                  <h3 className="font-bold text-foreground text-lg">{t(`landing.${plan.key}`)}</h3>
                  {plan.custom ? (
                    <div className="mt-2">
                      <span className="text-2xl font-black text-foreground font-mono">{t('landing.custom')}</span>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-3xl font-black text-foreground font-mono">{formatPrice(plan.fee, locale)}</span>
                    </div>
                  )}
                  {!plan.custom && <p className="text-xs text-muted-foreground mt-1">جنيه/شهر</p>}
                  <p className="mt-1" dir="rtl" style={{ color: '#64748B', fontSize: '13px' }}>• {plan.studentLabel}</p>
                  {plan.perStudentWeek ? (
                    <p dir="rtl" style={{ color: '#64748B', fontSize: '13px' }}>• {plan.perStudentWeek} جنيه/طالب/أسبوع</p>
                  ) : plan.custom ? (
                    <p dir="rtl" style={{ color: '#64748B', fontSize: '13px' }}>• تسعير مخصص حسب الاحتياج</p>
                  ) : null}
                </div>

                <div className="flex-1">
                  {!plan.custom && (
                    <div style={{ color: '#64748B', fontSize: '12px' }}>
                      رسوم تفعيل لمرة واحدة: <span className="font-mono font-semibold">{formatPrice(plan.setupFee, locale)}</span> جنيه
                    </div>
                  )}
                </div>

                <Link
                  to={plan.custom ? '#' : '/signup'}
                  className={`mt-5 block w-full text-center py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                    plan.popular
                      ? 'text-white'
                      : 'border border-border text-foreground hover:bg-muted'
                  }`}
                  style={plan.popular ? { background: 'hsl(var(--primary))' } : {}}
                  onClick={e => plan.custom && e.preventDefault()}
                >
                  {plan.custom ? t('landing.contactUs') : t('landing.register')}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="py-8 border-t border-border" style={{ background: 'hsl(var(--navy))' }}>
        <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ background: 'hsl(var(--primary))' }}>CH</div>
            <span className="text-white/70 text-sm">{t('landing.copyright')}</span>
          </div>
          <a
            href="https://wa.me/201000000000"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white transition-colors"
            style={{ background: '#25D366' }}
          >
            <span>💬</span>
            <span>{t('landing.contactWhatsapp')}</span>
          </a>
        </div>
      </footer>
    </div>
  );
}
