'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Link, useRouter, usePathname } from '@/i18n/routing';
import { QrCode, CreditCard, Calendar, BarChart3, Wifi, Bluetooth, Globe } from 'lucide-react';
import { toAr } from '@/lib/number-utils';
import { useTransition } from 'react';
import Image from 'next/image';

const TOP_CENTERS_WHATSAPP = 'https://wa.me/201220601410?text=مرحباً، أنا مهتم بخطة كبار السناتر لأكثر من 2000 طالب أسبوعياً';

const PLANS = [
  { key: 'planStarter', fee: 2000, limit: 150, setupFee: 1000, tier: 'starter' as const, perStudentWeek: '3.33', studentLabelKey: 'studentsLimit' as const, studentLabelCount: 150 },
  { key: 'planPro', fee: 4500, limit: 500, setupFee: 2000, tier: 'pro' as const, popular: true, perStudentWeek: '2.25', studentLabelKey: 'studentsLimit' as const, studentLabelCount: 500 },
  { key: 'planBusiness', fee: 6500, limit: 1000, setupFee: 3000, tier: 'business' as const, perStudentWeek: '1.63', studentLabelKey: 'studentsLimit' as const, studentLabelCount: 1000 },
  { key: 'planEnterprise', fee: 9000, limit: 2000, setupFee: 5000, tier: 'enterprise' as const, perStudentWeek: '1.13', studentLabelKey: 'studentsLimit' as const, studentLabelCount: 2000 },
  { key: 'planTopCenters', fee: 0, limit: 0, setupFee: 0, tier: 'top_centers' as const, custom: true, perStudentWeek: null, studentLabelKey: 'topCentersLimit' as const },
];

const FEATURES = [
  { key: 'feature1', icon: QrCode, color: 'hsl(var(--primary))', bgColor: 'hsl(var(--primary) / 0.12)' },
  { key: 'feature2', icon: CreditCard, color: '#16A34A', bgColor: '#16A34A18' },
  { key: 'feature3', icon: Calendar, color: '#7C3AED', bgColor: '#7C3AED18' },
  { key: 'feature4', icon: BarChart3, color: '#F59E0B', bgColor: '#F59E0B18' },
  { key: 'feature5', icon: Wifi, color: '#DC2626', bgColor: '#DC262618' },
  { key: 'feature6', icon: Bluetooth, color: '#0EA5E9', bgColor: '#0EA5E918' },
];

function formatPrice(n: number, locale: string) {
  if (locale === 'ar') {
    return toAr(n);
  }
  return new Intl.NumberFormat('en-US').format(n);
}

export default function LandingPage() {
  const t = useTranslations('landing');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const handleLocaleToggle = () => {
    const newLocale = locale === 'ar' ? 'en' : 'ar';
    localStorage.setItem('preferred-locale', newLocale);
    startTransition(() => {
      router.replace(pathname, { locale: newLocale as 'ar' | 'en' });
    });
  };

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
            <a href="#features" className="text-sm text-white/70 hover:text-white transition-colors">{t('features')}</a>
            <a href="#pricing" className="text-sm text-white/70 hover:text-white transition-colors">{t('pricing')}</a>
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleLocaleToggle}
              disabled={isPending}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-white/70 hover:text-white border border-white/20 hover:border-white/40 transition-colors"
            >
              <Globe size={13} />
              <span>{locale === 'ar' ? 'EN' : 'ع'}</span>
            </button>
            <Link
              href="/login"
              className="px-4 py-1.5 rounded-lg text-sm font-medium border border-white/30 text-white hover:bg-white/10 transition-colors"
            >
              {t('login')}
            </Link>
            <Link
              href="/signup"
              className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-colors hidden sm:block"
              style={{ background: 'hsl(var(--primary))' }}
            >
              {t('register')}
            </Link>
          </div>
        </div>
      </header>

      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden min-h-[640px] md:min-h-[720px] flex items-center" style={{ background: 'var(--gradient-hero)' }}>
        {/* Hero image */}
        <div className="absolute inset-0">
          <Image
            src="/hero-scanner.jpg"
            alt="CenterHQ Scanner"
            fill
            className="object-cover opacity-20"
            sizes="100vw"
            priority
          />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, hsl(var(--navy) / 0.2), hsl(var(--navy) / 0.5), hsl(var(--navy)))' }} />
        </div>

        <div className="container mx-auto px-4 relative z-10 py-20 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium mb-6 border border-white/20" style={{ background: 'hsl(var(--primary) / 0.2)', color: 'hsl(var(--primary-light))' }}>
            <QrCode size={13} />
            <span>{t('heroPillBadge')}</span>
          </div>
          <h1 className="text-6xl sm:text-7xl md:text-8xl font-black text-white mb-6 tracking-tight">
            {t('heroTitle')}
          </h1>
          <p className="text-lg sm:text-xl text-white/70 max-w-2xl mx-auto mb-10 leading-relaxed">
            {t('heroSubtitle')}
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link
              href="/signup"
              className="px-8 py-3.5 rounded-xl font-bold text-white text-base transition-all hover:opacity-90 active:scale-95"
              style={{ background: 'hsl(var(--primary))' }}
            >
              {t('register')}
            </Link>
            <Link
              href="/login"
              className="px-8 py-3.5 rounded-xl font-medium text-white text-base border border-white/30 hover:bg-white/10 transition-colors"
            >
              {t('login')}
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section id="features" className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-foreground text-center mb-3">{t('features')}</h2>
          <p className="text-center text-muted-foreground mb-12 max-w-lg mx-auto">{t('featuresSubtitleAr')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(({ key, icon: Icon, color, bgColor }) => (
              <div key={key} className="ch-card p-6 hover:shadow-md transition-shadow group">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110" style={{ background: bgColor, color }}>
                  <Icon size={24} />
                </div>
                <h3 className="font-bold text-foreground mb-2">{t(`${key}Title`)}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{t(`${key}Desc`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Pricing ─── */}
      <section id="pricing" className="py-20" style={{ background: 'hsl(var(--muted))' }}>
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-foreground text-center mb-3">{t('pricing')}</h2>
          <p className="text-center text-muted-foreground mb-12">{t('pricingNote')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 max-w-6xl mx-auto">
            {PLANS.map((plan) => (
              <div
                key={plan.key}
                className={`relative ch-card p-5 flex flex-col transition-all hover:shadow-md ${plan.popular ? 'ring-2 ring-primary scale-[1.02]' : ''}`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold text-white whitespace-nowrap" style={{ background: 'hsl(var(--primary))' }}>
                    {t('mostPopular')}
                  </div>
                )}

                <div className="mb-4">
                  <h3 className="font-bold text-foreground text-lg">{t(plan.key)}</h3>
                  {plan.custom ? (
                    <div className="mt-2">
                      <span className="text-2xl font-black text-foreground font-mono">{t('custom')}</span>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-3xl font-black text-foreground font-mono">{formatPrice(plan.fee, locale)}</span>
                      <span className="text-sm text-muted-foreground">{tc('egp')}</span>
                    </div>
                  )}
                  {!plan.custom && <p className="text-xs text-muted-foreground mt-1">{t('monthlyFee')}</p>}
                  <ul className="mt-1 space-y-0.5 text-[13px]" style={{ color: '#64748B' }} dir="rtl">
                    <li>• {plan.studentLabelKey === 'topCentersLimit' ? t('topCentersLimit') : t('studentsLimit', { count: formatPrice(plan.studentLabelCount!, locale) })}</li>
                    {plan.perStudentWeek ? (
                      <li>• {t('perStudentWeek', { amount: plan.perStudentWeek })}</li>
                    ) : plan.custom ? (
                      <li>• {t('customPricingNote')}</li>
                    ) : null}
                  </ul>
                </div>

                <div className="flex-1">
                  {!plan.custom && (
                    <p className="text-[12px]" style={{ color: '#64748B' }}>
                      {t('setupFeeShort', { amount: formatPrice(plan.setupFee, locale) })}
                    </p>
                  )}
                </div>

                {plan.custom ? (
                  <a
                    href={TOP_CENTERS_WHATSAPP}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-5 block w-full text-center py-2.5 rounded-xl text-sm font-semibold border border-border text-foreground hover:bg-muted transition-colors"
                  >
                    {t('contactUs')}
                  </a>
                ) : (
                  <Link
                    href="/signup"
                    className={`mt-5 block w-full text-center py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                      plan.popular
                        ? 'text-white'
                        : 'border border-border text-foreground hover:bg-muted'
                    }`}
                    style={plan.popular ? { background: 'hsl(var(--primary))' } : {}}
                  >
                    {t('register')}
                  </Link>
                )}
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
            <span className="text-white/70 text-sm">{t('copyright')}</span>
          </div>
          <a
            href={TOP_CENTERS_WHATSAPP}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white transition-colors"
            style={{ background: '#25D366' }}
          >
            <span>💬</span>
            <span>{t('contactWhatsapp')}</span>
          </a>
        </div>
      </footer>
    </div>
  );
}
