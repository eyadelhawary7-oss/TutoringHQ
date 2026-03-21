'use client';

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

type Plan = {
  key: string
  priceMonth: string | null
  pricePer: string | null
  earlyPrice: string | null
  students: string
  hasEarly: boolean
  popular: boolean
  isTopCenters: boolean
}

export default function LocaleHomePage() {
  const t = useTranslations('landing');
  const locale = useLocale();

  const plans: Plan[] = [
    {
      key: 'nano',
      priceMonth: '1,200',
      pricePer: '4.00',
      earlyPrice: '720',
      students: '75',
      hasEarly: true,
      popular: false,
      isTopCenters: false,
    },
    {
      key: 'starter',
      priceMonth: '2,000',
      pricePer: '3.33',
      earlyPrice: '1,200',
      students: '150',
      hasEarly: true,
      popular: false,
      isTopCenters: false,
    },
    {
      key: 'pro',
      priceMonth: '4,500',
      pricePer: '2.25',
      earlyPrice: '2,700',
      students: '500',
      hasEarly: true,
      popular: true,
      isTopCenters: false,
    },
    {
      key: 'business',
      priceMonth: '6,500',
      pricePer: '1.63',
      earlyPrice: null,
      students: '1,000',
      hasEarly: false,
      popular: false,
      isTopCenters: false,
    },
    {
      key: 'enterprise',
      priceMonth: '9,000',
      pricePer: '1.13',
      earlyPrice: null,
      students: '2,000',
      hasEarly: false,
      popular: false,
      isTopCenters: false,
    },
    {
      key: 'top_centers',
      priceMonth: null,
      pricePer: null,
      earlyPrice: null,
      students: '2,000+',
      hasEarly: false,
      popular: false,
      isTopCenters: true,
    },
  ];

  const featureItems: { key: string; icon: ReactNode }[] = [
    {
      key: 'qr',
      icon: (
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="3" height="3" rx="0.5" />
          <rect x="18" y="14" width="3" height="3" rx="0.5" />
          <rect x="14" y="18" width="3" height="3" rx="0.5" />
          <rect x="18" y="18" width="3" height="3" rx="0.5" />
        </svg>
      ),
    },
    {
      key: 'payments',
      icon: (
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
        </svg>
      ),
    },
    {
      key: 'whatsapp',
      icon: (
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <polyline points="9 11 12 14 15 11" />
        </svg>
      ),
    },
    {
      key: 'analytics',
      icon: (
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      ),
    },
    {
      key: 'students',
      icon: (
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      key: 'branches',
      icon: (
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
      ),
    },
  ];

  const stats = [
    { value: t('stats.centers_value'), label: t('stats.centers_label') },
    { value: t('stats.methods_value'), label: t('stats.methods_label') },
    { value: t('stats.uptime_value'), label: t('stats.uptime_label') },
    { value: t('stats.support_value'), label: t('stats.support_label') },
  ];

  return (
    <main className="bg-surface-0 min-h-screen">
      <nav
        className="fixed top-0 inset-x-0 z-50 h-16 md:h-18
                bg-surface-1/90 backdrop-blur-md
                border-b border-[var(--color-border-subtle)]"
      >
        <div className="container mx-auto px-4 md:px-8 h-full flex items-center justify-between">
          <span className="font-bold text-xl text-white tracking-tight">
            Center<span className="text-brand-500">HQ</span>
          </span>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              locale={locale === 'ar' ? 'en' : 'ar'}
              className="btn btn-ghost text-sm px-3 py-2 font-mono"
            >
              {locale === 'ar' ? 'EN' : 'عر'}
            </Link>
            <Link href="/login" className="btn btn-ghost text-sm px-4 py-2">
              {t('nav.login')}
            </Link>
            <Link href="/signup" className="btn btn-primary text-sm px-4 py-2">
              {t('nav.signup')}
            </Link>
          </div>
        </div>
      </nav>

      <section
        className="min-h-[100svh] pt-24"
        style={{
          background: `radial-gradient(ellipse 80% 60% at 60% 20%, rgba(13,148,136,0.12) 0%, transparent 60%), var(--color-surface-0)`,
        }}
      >
        <div className="container mx-auto px-4 md:px-8 flex flex-col lg:flex-row items-center gap-12 py-16 lg:py-24">
          <div className="flex-1 flex flex-col items-start">
            <span
              className="inline-flex items-center gap-2 px-3 py-1 rounded-badge
                       bg-[rgba(13,148,136,0.12)] border border-[var(--color-border-brand)]
                       text-brand-400 text-xs font-semibold mb-6 animate-fade-in"
            >
              {t('hero.badge')}
            </span>

            <h1
              className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6
                     animate-fade-in [animation-delay:80ms]"
            >
              <span className="block text-white">{t('hero.headline_1')}</span>
              <span className="block text-brand-400 text-glow-brand">{t('hero.headline_2')}</span>
            </h1>

            <p
              className="text-base md:text-lg text-[var(--color-text-secondary)]
                    max-w-xl mb-8 leading-relaxed
                    animate-fade-in [animation-delay:160ms]"
            >
              {t('hero.subheadline')}
            </p>

            <div className="flex flex-wrap gap-3 animate-fade-in [animation-delay:240ms]">
              <Link href="/signup" className="btn btn-primary px-6 py-3 text-base">
                {t('hero.cta_primary')}
              </Link>
              <a href="#features" className="btn btn-ghost px-6 py-3 text-base">
                {t('hero.cta_secondary')}
              </a>
            </div>
          </div>

          <div className="flex-shrink-0 w-56 md:w-64 animate-fade-in [animation-delay:120ms]">
            <div
              className="relative mx-auto
                      bg-surface-2 rounded-[2rem] p-2
                      border border-[var(--color-border-default)]
                      shadow-brand-sm"
            >
              <div
                className="bg-surface-0 rounded-[1.6rem] overflow-hidden
                        aspect-[9/16] relative
                        flex flex-col items-center justify-center gap-4 p-6"
              >
                <div
                  className="absolute top-0 inset-x-0 h-10 bg-surface-1
                          flex items-center justify-center
                          border-b border-[var(--color-border-subtle)]"
                >
                  <span className="text-brand-400 text-xs font-semibold">CenterHQ</span>
                </div>

                <div className="relative w-36 h-36 md:w-40 md:h-40">
                  <div className="absolute top-0 start-0 w-10 h-10 border-2 border-brand-500 rounded-sm" />
                  <div className="absolute top-0 end-0 w-10 h-10 border-2 border-brand-500 rounded-sm" />
                  <div className="absolute bottom-0 start-0 w-10 h-10 border-2 border-brand-500 rounded-sm" />
                  <div className="absolute inset-3 grid grid-cols-6 gap-0.5">
                    {Array.from({ length: 36 }).map((_, i) => (
                      <div key={i} className="bg-[var(--color-navy-700)] rounded-[1px]" />
                    ))}
                  </div>
                  <div className="qr-scan-line" />
                </div>

                <div
                  className="flex items-center gap-2 px-3 py-1.5 rounded-badge
                          bg-[rgba(16,185,129,0.15)] border border-[rgba(16,185,129,0.30)]"
                >
                  <span className="w-2 h-2 rounded-full bg-[var(--color-success)] animate-pulse" />
                  <span className="text-[var(--color-success)] text-xs font-medium">
                    {t('hero.demo_attendance')}
                  </span>
                </div>

                <div
                  className="absolute bottom-0 inset-x-0 h-12 bg-surface-1
                          border-t border-[var(--color-border-subtle)]
                          flex items-center justify-center"
                >
                  <div className="flex gap-3">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className={`w-1.5 h-1.5 rounded-full ${
                          i === 0 ? 'bg-brand-500' : 'bg-[var(--color-surface-4)]'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-surface-1 border-y border-[var(--color-border-subtle)] py-8">
        <div className="container mx-auto px-4 md:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, i) => (
              <div key={i} className="flex flex-col items-center text-center gap-1">
                <span className="text-2xl md:text-3xl font-bold text-white">{stat.value}</span>
                <span className="text-sm text-[var(--color-text-secondary)]">{stat.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="bg-surface-0 py-20 md:py-28">
        <div className="container mx-auto px-4 md:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">{t('features.title')}</h2>
            <p className="text-[var(--color-text-secondary)] text-lg">{t('features.subtitle')}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {featureItems.map(({ key, icon }) => (
              <div
                key={key}
                className="card p-6 flex flex-col gap-4
                     transition-all duration-normal ease-out
                     hover:shadow-brand-sm hover:border-[var(--color-border-brand)]
                     group cursor-default"
              >
                <div
                  className="w-11 h-11 rounded-lg flex items-center justify-center
                          bg-[rgba(13,148,136,0.12)] text-brand-400
                          group-hover:bg-[rgba(13,148,136,0.18)]
                          transition-colors duration-fast"
                >
                  {icon}
                </div>
                <h3 className="text-lg font-semibold text-white">{t(`features.items.${key}.title`)}</h3>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  {t(`features.items.${key}.desc`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-surface-1 py-20 md:py-28">
        <div className="container mx-auto px-4 md:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">{t('pricing.title')}</h2>
            <p className="text-[var(--color-text-secondary)] text-lg">{t('pricing.subtitle')}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {plans.map((plan) => (
              <div
                key={plan.key}
                className={[
                  'card p-6 flex flex-col gap-5 relative',
                  'transition-all duration-normal ease-out',
                  plan.popular
                    ? 'border-[var(--color-brand-500)] shadow-brand-md ring-1 ring-[var(--color-brand-500)]'
                    : plan.isTopCenters
                      ? 'border-[var(--color-gold-500)] shadow-gold-sm ring-1 ring-[var(--color-gold-500)]'
                      : '',
                ].join(' ')}
              >
                {plan.popular && (
                  <span
                    className="absolute -top-3 left-1/2 -translate-x-1/2
                             badge badge-brand text-xs whitespace-nowrap"
                  >
                    {t('pricing.popular')}
                  </span>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-xl font-bold text-white">{t(`pricing.plans.${plan.key}.name`)}</span>
                  <span className="badge badge-neutral text-xs">
                    {plan.isTopCenters ? t('pricing.students_more') : t('pricing.students_up_to')}{' '}
                    {plan.students} {t('pricing.students_unit')}
                  </span>
                </div>

                {plan.isTopCenters ? (
                  <span className="text-2xl font-bold text-gold-400">
                    {t('pricing.plans.top_centers.price_month')}
                  </span>
                ) : (
                  <div className="flex flex-col gap-1">
                    {plan.hasEarly && (
                      <span className="badge badge-brand text-xs self-start">{t('pricing.early_badge')}</span>
                    )}
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-white">{plan.pricePer ?? ''}</span>
                      <span className="text-sm text-[var(--color-text-secondary)]">
                        {t('pricing.per_student')}
                      </span>
                    </div>
                    {plan.hasEarly ? (
                      <div className="flex items-center gap-2 text-sm flex-wrap">
                        <span className="line-through text-[var(--color-text-disabled)]">
                          {plan.priceMonth ?? ''}
                        </span>
                        <span className="text-[var(--color-success)] font-semibold">
                          {plan.earlyPrice ?? ''}
                        </span>
                        <span className="text-[var(--color-text-tertiary)]">{t('pricing.per_month')}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-sm">
                        <span className="text-white font-medium">{plan.priceMonth ?? ''}</span>
                        <span className="text-[var(--color-text-tertiary)]">{t('pricing.per_month')}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="divider" />

                {plan.isTopCenters ? (
                  <Link
                    href="/signup"
                    className="btn btn-ghost w-full py-2.5 mt-auto
                         border-[var(--color-gold-500)] text-gold-400"
                  >
                    {t('pricing.enterprise_cta')}
                  </Link>
                ) : (
                  <Link href="/signup" className="btn btn-primary w-full py-2.5 mt-auto">
                    {t('pricing.cta')}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-surface-2 border-y border-[var(--color-border-default)] py-20">
        <div className="container mx-auto px-4 md:px-8 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">{t('cta.title')}</h2>
          <p className="text-[var(--color-text-secondary)] text-lg mb-8">{t('cta.subtitle')}</p>
          <Link href="/signup" className="btn btn-primary px-8 py-4 text-lg shadow-brand-md">
            {t('cta.button')}
          </Link>
          <p className="text-[var(--color-text-tertiary)] text-sm mt-4">{t('cta.note')}</p>
        </div>
      </section>

      <footer className="bg-surface-0 border-t border-[var(--color-border-subtle)] py-8">
        <div className="container mx-auto px-4 md:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <span className="text-[var(--color-text-secondary)] text-sm">{t('footer.tagline')}</span>
          <span className="font-bold text-white">
            Center<span className="text-brand-500">HQ</span>
          </span>
          <span className="text-[var(--color-text-tertiary)] text-xs">{t('footer.rights')}</span>
        </div>
      </footer>
    </main>
  );
}
