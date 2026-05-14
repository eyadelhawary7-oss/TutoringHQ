'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { formatCurrency, formatNumber } from '@/lib/formatNumber';
import { ORDERED_SUBSCRIPTION_PLAN_KEYS, PLANS } from '@/lib/pricing';
import type { SubscriptionPlanKey } from '@/lib/pricing';
import { Menu, X } from 'lucide-react';
import PricingBannerClient from '@/components/landing/PricingBannerClient';

const CONTACT_MAIL = 'mailto:eyad@ehgintelligence.com';

export default function PricingPageClient() {
  const t = useTranslations('pricingPage');
  const m = useTranslations('landing.marketing');
  const locale = useLocale();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

  return (
    <main
      data-chq-pricing
      className="min-h-screen bg-[#080f1a] text-white [&_h1]:text-white [&_h2]:text-white [&_p]:text-[var(--color-text-secondary)]"
    >
      <PricingBannerClient locale={locale} variant="strip" />
      <header className="sticky top-0 z-50 border-b border-slate-800/60 bg-[#080f1a]/90 backdrop-blur-md">
        <div className="relative mx-auto flex h-14 max-w-6xl items-center px-4 md:h-16 md:px-6">
          <button
            type="button"
            className="absolute start-4 top-1/2 z-10 inline-flex -translate-y-1/2 rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white md:hidden btn-press chq-focus [&_svg]:text-slate-300"
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? m('closeMenuAria') : m('openMenuAria')}
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <X className="h-6 w-6" aria-hidden /> : <Menu className="h-6 w-6" aria-hidden />}
          </button>
          <div className="mx-auto flex w-full max-w-full items-center justify-center gap-4 md:mx-0 md:justify-between">
            <Link href="/" locale={locale} className="flex items-center gap-2 btn-press chq-focus rounded-lg">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-600 text-xs font-bold text-white">
                CH
              </span>
              <span className="text-lg tracking-tight">
                <span
                  style={{
                    fontFamily: 'var(--font-bodoni)',
                    fontWeight: 700,
                    letterSpacing: '2px',
                    color: '#f8fafc',
                  }}
                >
                  CENTER
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-bodoni)',
                    fontWeight: 700,
                    letterSpacing: '2px',
                    color: '#0D9488',
                  }}
                >
                  HQ
                </span>
              </span>
            </Link>

            <nav className="hidden flex-1 items-center justify-center gap-8 md:flex" aria-label="Main">
              <Link
                href="/"
                className="text-sm text-slate-300 transition-colors hover:text-white btn-press chq-focus rounded-lg px-1 py-0.5"
              >
                {t('navHome')}
              </Link>
              <Link
                href="/signup"
                className="rounded-xl bg-teal-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-500 inline-flex btn-press chq-focus"
              >
                {m('finalCtaButton')}
              </Link>
            </nav>
          </div>
        </div>

        {mobileOpen ? (
          <div className="border-t border-slate-800/60 bg-[#080f1a]/95 px-4 py-4 md:hidden">
            <div className="flex flex-col gap-1">
              <Link
                href="/"
                className="rounded-xl px-3 py-3 text-slate-300 btn-press chq-focus"
                onClick={() => setMobileOpen(false)}
              >
                {t('navHome')}
              </Link>
              <Link
                href="/signup"
                className="mt-2 rounded-xl bg-teal-600 py-3 text-center font-semibold text-white btn-press chq-focus"
                onClick={() => setMobileOpen(false)}
              >
                {m('finalCtaButton')}
              </Link>
            </div>
          </div>
        ) : null}
      </header>

      <section className="px-4 py-14 md:px-6 md:py-20">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-center text-3xl font-bold md:text-4xl">{t('title')}</h1>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-slate-400 md:text-base">{t('subtitle')}</p>

          <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-5">
            {ORDERED_SUBSCRIPTION_PLAN_KEYS.map((planKey) => {
              const p = PLANS[planKey as SubscriptionPlanKey];
              const title = locale === 'ar' ? p.arabicName : p.englishName;
              const cap = p.weeklyStudentLimit;
              const studentsLine =
                cap != null
                  ? locale === 'ar'
                    ? t('studentsCapAr', { count: formatNumber(cap, locale) })
                    : t('studentsCapEn', { count: formatNumber(cap, locale) })
                  : '';
              const isPopular = p.landingBadge === 'popular';
              const isEntry = p.landingBadge === 'entry';

              return (
                <div
                  key={planKey}
                  className={`flex flex-col rounded-2xl border p-6 text-start ${
                    isPopular
                      ? 'border-teal-600/60 bg-slate-800 ring-1 ring-teal-600/30'
                      : 'border-slate-700 bg-[var(--color-surface-2)]'
                  }`}
                >
                  <div className="flex min-h-[28px] flex-wrap items-center gap-2">
                    {isEntry ? (
                      <span className="inline-block rounded-full border border-slate-600 bg-[var(--color-surface-2)] px-2 py-0.5 text-xs text-slate-400">
                        {t('badgeEntry')}
                      </span>
                    ) : null}
                    {isPopular ? (
                      <span className="inline-block rounded-full border border-teal-700/50 bg-teal-900/30 px-2 py-0.5 text-xs font-medium text-teal-400">
                        {t('badgePopular')}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-lg font-bold text-white">{title}</p>
                  <dl className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between gap-2 border-b border-slate-700/80 pb-2">
                      <dt className="text-slate-400">{t('colMonthly')}</dt>
                      <dd className="font-mono font-semibold tabular-nums text-white">
                        {formatCurrency(p.monthlyListPrice, locale)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2 border-b border-slate-700/80 pb-2">
                      <dt className="text-slate-400">{t('colQuarterly')}</dt>
                      <dd className="font-mono font-semibold tabular-nums text-white">
                        {formatCurrency(p.quarterlyAllIn, locale)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-400">{t('colAnnual')}</dt>
                      <dd className="font-mono font-semibold tabular-nums text-white">
                        {formatCurrency(p.annualEffectiveMonthly, locale)}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-4 text-xs text-slate-500">{studentsLine}</p>
                  <p className="mt-2 text-[11px] text-slate-600">{t('priceDisclaimer')}</p>
                  <Link
                    href="/signup"
                    className="mt-6 inline-flex w-full justify-center rounded-xl bg-teal-600 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-teal-500 btn-press chq-focus"
                  >
                    {t('ctaSignup')}
                  </Link>
                </div>
              );
            })}
          </div>

          <div className="mt-10 rounded-2xl border border-teal-800/50 bg-gradient-to-br from-slate-900/80 to-teal-950/40 p-6 md:p-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-bold text-white md:text-2xl">{t('topCentersTitle')}</h2>
                <p className="mt-1 text-sm text-teal-100/90">{t('topCentersSubtitle')}</p>
                <p className="mt-2 text-sm text-slate-400">{t('topCentersStudents')}</p>
              </div>
              <button
                type="button"
                onClick={() => setContactOpen(true)}
                className="shrink-0 rounded-xl border border-teal-500/50 bg-teal-600/20 px-6 py-3 text-sm font-semibold text-teal-200 transition-colors hover:bg-teal-600/30 btn-press chq-focus"
              >
                {t('topCentersCta')}
              </button>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800/60 bg-[#080f1a] px-4 py-8 md:px-6">
        <p className="mx-auto max-w-4xl text-center text-xs text-slate-600">{t('footerNote')}</p>
      </footer>

      {contactOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pricing-contact-title"
          onClick={() => setContactOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#0f172a] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="pricing-contact-title" className="text-lg font-bold text-white">
              {t('contactModalTitle')}
            </h2>
            <p className="mt-2 text-sm text-slate-400">{t('contactModalBody')}</p>
            <a
              href={CONTACT_MAIL}
              className="mt-6 flex w-full justify-center rounded-xl bg-teal-600 py-3 text-sm font-semibold text-white hover:bg-teal-500"
            >
              {t('contactModalEmail')}
            </a>
            <button
              type="button"
              className="mt-3 w-full rounded-xl border border-slate-600 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
              onClick={() => setContactOpen(false)}
            >
              {t('contactModalClose')}
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
