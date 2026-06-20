'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { formatCurrency, formatNumber } from '@/lib/formatNumber';
import { ORDERED_SUBSCRIPTION_PLAN_KEYS, PLANS } from '@/lib/pricing';
import type { SubscriptionPlanKey } from '@/lib/pricing';
import { Menu, X, Check } from 'lucide-react';
import PricingBannerClient from '@/components/landing/PricingBannerClient';
import PublicLocaleToggle from '@/components/PublicLocaleToggle';
import PlanComparisonTable from '@/components/teacher/PlanComparisonTable';
import { usePublicPlanPrices } from '@/hooks/usePublicPlanPrices';

const CONTACT_MAIL = 'mailto:support@ehgintelligence.com';

type Audience = 'center' | 'teacher';

export default function PricingPageClient() {
  const t = useTranslations('pricingPage');
  const tp = useTranslations('pricingPage.teacher');
  const m = useTranslations('landing.marketing');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [audience, setAudience] = useState<Audience>(
    searchParams?.get('for') === 'teacher' ? 'teacher' : 'center',
  );
  const dynamicPlanPrices = usePublicPlanPrices();

  const freeFeatures = [tp('freeFeature1'), tp('freeFeature2')];
  const standardFeatures = [
    tp('feature1'),
    tp('feature2'),
    tp('feature3'),
    tp('feature4'),
    tp('standardCapSummary'),
    tp('standardGuestLimit'),
  ];
  const proFeatures = (tp.raw('proFeatures') as string[]) ?? [];
  const scaleFeatures = (tp.raw('scaleFeatures') as string[]) ?? [];

  const selectAudience = (next: Audience) => {
    setAudience(next);
    // Keep the URL shareable/bookmarkable without a full navigation.
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('for', next);
      window.history.replaceState(null, '', url.toString());
    }
  };

  return (
    <main
      data-chq-pricing
      className="min-h-screen bg-[var(--color-surface-0)] text-[var(--color-text-primary)]"
    >
      <PricingBannerClient locale={locale} variant="strip" />
      <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-surface-1)]/90 backdrop-blur-md">
        <div className="relative mx-auto flex h-14 max-w-6xl items-center px-4 md:h-16 md:px-6">
          <button
            type="button"
            className="absolute start-4 top-1/2 z-10 inline-flex -translate-y-1/2 rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)] md:hidden btn-press chq-focus"
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? m('closeMenuAria') : m('openMenuAria')}
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <X className="h-6 w-6" aria-hidden /> : <Menu className="h-6 w-6" aria-hidden />}
          </button>
          <div className="mx-auto flex w-full max-w-full items-center justify-center gap-4 md:mx-0 md:justify-between">
            <Link href="/" locale={locale} className="flex items-center gap-2 btn-press chq-focus rounded-lg">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-teal)] text-xs font-bold text-white">
                CH
              </span>
              <span className="text-lg tracking-tight">
                <span
                  style={{
                    fontFamily: 'var(--font-bodoni)',
                    fontWeight: 700,
                    letterSpacing: '2px',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  CENTER
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-bodoni)',
                    fontWeight: 700,
                    letterSpacing: '2px',
                    color: 'var(--color-teal)',
                  }}
                >
                  HQ
                </span>
              </span>
            </Link>

            <nav className="hidden flex-1 items-center justify-center gap-8 md:flex" aria-label="Main">
              <Link
                href="/"
                className="text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] btn-press chq-focus rounded-lg px-1 py-0.5"
              >
                {t('navHome')}
              </Link>
              <PublicLocaleToggle />
              <Link
                href="/teacher/signup"
                className="rounded-xl bg-[var(--color-teal)] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-teal-deep)] inline-flex btn-press chq-focus"
              >
                {m('finalCtaButton')}
              </Link>
            </nav>
          </div>
        </div>

        {mobileOpen ? (
          <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-1)]/95 px-4 py-4 md:hidden">
            <div className="flex flex-col gap-1">
              <Link
                href="/"
                className="rounded-xl px-3 py-3 text-[var(--color-text-secondary)] btn-press chq-focus"
                onClick={() => setMobileOpen(false)}
              >
                {t('navHome')}
              </Link>
              <div className="px-3 py-2">
                <PublicLocaleToggle />
              </div>
              <Link
                href="/teacher/signup"
                className="mt-2 rounded-xl bg-[var(--color-teal)] py-3 text-center font-semibold text-white btn-press chq-focus"
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
          <h1 className="text-center text-3xl font-bold text-[var(--color-text-primary)] md:text-4xl">{t('title')}</h1>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-[var(--color-text-muted)] md:text-base">{t('subtitle')}</p>

          {/* Audience toggle: Centers (teal) / Teachers (brass) */}
          <div className="mt-8 flex justify-center">
            <div
              role="tablist"
              aria-label={t('title')}
              className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-surface-1)] p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={audience === 'center'}
                onClick={() => selectAudience('center')}
                className="rounded-full px-5 py-2 text-sm font-semibold transition-colors btn-press chq-focus"
                style={
                  audience === 'center'
                    ? { background: 'var(--color-teal)', color: '#ffffff' }
                    : { color: 'var(--color-text-secondary)' }
                }
              >
                {t('toggleCenters')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={audience === 'teacher'}
                onClick={() => selectAudience('teacher')}
                className="rounded-full px-5 py-2 text-sm font-semibold transition-colors btn-press chq-focus"
                style={
                  audience === 'teacher'
                    ? { background: 'var(--color-brass)', color: '#ffffff' }
                    : { color: 'var(--color-text-secondary)' }
                }
              >
                {t('toggleTeachers')}
              </button>
            </div>
          </div>

          {audience === 'center' ? (
            <>
              <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-5">
                {ORDERED_SUBSCRIPTION_PLAN_KEYS.map((planKey) => {
                  const p = PLANS[planKey as SubscriptionPlanKey];
                  const dyn = dynamicPlanPrices[planKey as SubscriptionPlanKey];
                  const title = locale === 'ar' ? p.arabicName : p.englishName;
                  const cap = dyn.weeklyStudentLimit ?? p.weeklyStudentLimit;
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
                          ? 'border-[var(--color-teal)]/50 bg-[var(--color-surface-1)] ring-1 ring-[var(--color-teal)]/25'
                          : 'border-[var(--color-border)] bg-[var(--color-surface-1)]'
                      }`}
                    >
                      <div className="flex min-h-[28px] flex-wrap items-center gap-2">
                        {isEntry ? (
                          <span className="inline-block rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
                            {t('badgeEntry')}
                          </span>
                        ) : null}
                        {isPopular ? (
                          <span className="inline-block rounded-full bg-[var(--color-teal)] px-2 py-0.5 text-xs font-medium text-white">
                            {t('badgePopular')}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-3 text-lg font-bold text-[var(--color-text-primary)]">{title}</p>
                      <dl className="mt-4 space-y-2 text-sm">
                        <div className="flex justify-between gap-2 border-b border-[var(--color-border-subtle)] pb-2">
                          <dt className="text-[var(--color-text-secondary)]">{t('colMonthly')}</dt>
                          <dd className="font-mono font-semibold tabular-nums text-[var(--color-text-primary)]">
                            {formatCurrency(dyn.monthlyListPrice, locale)}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2 border-b border-[var(--color-border-subtle)] pb-2">
                          <dt className="text-[var(--color-text-secondary)]">{t('colQuarterly')}</dt>
                          <dd className="font-mono font-semibold tabular-nums text-[var(--color-text-primary)]">
                            {formatCurrency(dyn.quarterlyAllIn, locale)}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-[var(--color-text-secondary)]">{t('colAnnual')}</dt>
                          <dd className="font-mono font-semibold tabular-nums text-[var(--color-text-primary)]">
                            {formatCurrency(dyn.annualEffectiveMonthly, locale)}
                          </dd>
                        </div>
                      </dl>
                      <p className="mt-4 text-xs text-[var(--color-text-secondary)]">{studentsLine}</p>
                      <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">{t('priceDisclaimer')}</p>
                      <Link
                        href="/signup"
                        className="mt-6 inline-flex w-full justify-center rounded-xl bg-[var(--color-teal)] py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-[var(--color-teal-deep)] btn-press chq-focus"
                      >
                        {t('ctaSignup')}
                      </Link>
                    </div>
                  );
                })}
              </div>

              <div className="mt-10 rounded-2xl border border-[var(--color-teal)]/30 bg-[var(--color-teal-soft)] p-6 md:p-8">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-[var(--color-text-primary)] md:text-2xl">{t('topCentersTitle')}</h2>
                    <p className="mt-1 text-sm text-[var(--color-teal-deep)]">{t('topCentersSubtitle')}</p>
                    <p className="mt-2 text-sm text-[var(--color-text-muted)]">{t('topCentersStudents')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setContactOpen(true)}
                    className="shrink-0 rounded-xl border border-[var(--color-teal)]/40 bg-[var(--color-teal)]/10 px-6 py-3 text-sm font-semibold text-[var(--color-teal-deep)] transition-colors hover:bg-[var(--color-teal)]/20 btn-press chq-focus"
                  >
                    {t('topCentersCta')}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="mx-auto mt-12 max-w-6xl">
              <div className="text-center">
                <h2 className="text-xl font-bold text-[var(--color-text-primary)] md:text-2xl">{tp('heading')}</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--color-text-secondary)]">{tp('sub')}</p>
              </div>
              <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {/* Free — the hook */}
                <div
                  className="flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-start shadow-[var(--shadow-card)]"
                  style={{ borderTopColor: 'var(--color-brass)', borderTopWidth: '3px' }}
                >
                  <p className="text-lg font-bold text-[var(--color-text-primary)]">{tp('freeName')}</p>
                  <p className="mt-3 text-2xl font-bold text-[var(--color-text-primary)]">{tp('freePrice')}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{tp('freeNote')}</p>
                  <ul className="mt-5 space-y-2.5">
                    {freeFeatures.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)]">
                        <Check size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--color-brass)' }} aria-hidden />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/teacher/signup"
                    className="mt-6 inline-flex w-full justify-center rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-0)] px-6 py-3 text-center text-sm font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-2)] btn-press chq-focus"
                  >
                    {tp('freeCta')}
                  </Link>
                </div>

                {/* Standard (499) */}
                <div
                  className="flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-start shadow-[var(--shadow-card)]"
                  style={{ borderTopColor: 'var(--color-brass)', borderTopWidth: '3px' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-lg font-bold text-[var(--color-text-primary)]">{tp('planName')}</p>
                    <span
                      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
                      style={{ background: 'var(--color-brass-soft)', color: 'var(--color-brass)' }}
                    >
                      {tp('trialBadge')}
                    </span>
                  </div>
                  <p className="mt-3 text-2xl font-bold text-[var(--color-text-primary)]">{tp('price')}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{tp('priceNote')}</p>
                  <p className="mt-1 text-xs font-medium" style={{ color: 'var(--color-brass)' }}>{tp('perStudent')}</p>
                  <ul className="mt-5 space-y-2.5">
                    {standardFeatures.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)]">
                        <Check size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--color-brass)' }} aria-hidden />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/teacher/signup"
                    className="mt-6 inline-flex w-full justify-center rounded-xl px-6 py-3 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90 btn-press chq-focus"
                    style={{ background: 'var(--color-brass)' }}
                  >
                    {tp('cta')}
                  </Link>
                </div>

                {/* Pro (999) — Best for Part-Time */}
                <div
                  className="flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-start shadow-[var(--shadow-card)]"
                  style={{ borderTopColor: 'var(--color-brass)', borderTopWidth: '3px' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-lg font-bold text-[var(--color-text-primary)]">{tp('proTitle')}</p>
                    <span
                      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
                      style={{ background: 'var(--color-brass)' }}
                    >
                      {tp('bestForPartTime')}
                    </span>
                  </div>
                  <p className="mt-3 text-2xl font-bold text-[var(--color-text-primary)]">{tp('proPrice')}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{tp('proPriceNote')}</p>
                  <p className="mt-1 text-xs font-medium" style={{ color: 'var(--color-brass)' }}>{tp('proPerStudent')}</p>
                  <ul className="mt-5 space-y-2.5">
                    {proFeatures.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)]">
                        <Check size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--color-brass)' }} aria-hidden />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/teacher/signup?plan=pro"
                    className="mt-6 inline-flex w-full justify-center rounded-xl px-6 py-3 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90 btn-press chq-focus"
                    style={{ background: 'var(--color-brass)' }}
                  >
                    {tp('proCtaButton')}
                  </Link>
                </div>

                {/* Scale (2499) */}
                <div
                  className="flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-start shadow-[var(--shadow-card)]"
                  style={{ borderTopColor: 'var(--color-brass)', borderTopWidth: '3px' }}
                >
                  <p className="text-lg font-bold text-[var(--color-text-primary)]">{tp('scaleTitle')}</p>
                  <p className="mt-3 text-2xl font-bold text-[var(--color-text-primary)]">{tp('scalePrice')}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{tp('scalePriceNote')}</p>
                  <p className="mt-1 text-xs font-medium" style={{ color: 'var(--color-brass)' }}>{tp('scalePerStudent')}</p>
                  <ul className="mt-5 space-y-2.5">
                    {scaleFeatures.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)]">
                        <Check size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--color-brass)' }} aria-hidden />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/teacher/signup?plan=scale"
                    className="mt-6 inline-flex w-full justify-center rounded-xl px-6 py-3 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90 btn-press chq-focus"
                    style={{ background: 'var(--color-brass)' }}
                  >
                    {tp('scaleCtaButton')}
                  </Link>
                </div>
              </div>
              <p className="mx-auto mt-6 max-w-2xl text-center text-xs text-[var(--color-text-muted)]">
                {tp('justification')}
              </p>
              <p className="mx-auto mt-2 max-w-2xl text-center text-xs text-[var(--color-text-muted)]">
                {tp('activeStudentNote')}
              </p>
              <PlanComparisonTable />
            </div>
          )}
        </div>
      </section>

      <footer className="border-t border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-8 md:px-6">
        <p className="mx-auto max-w-4xl text-center text-xs text-[var(--color-text-muted)]">{t('footerNote')}</p>
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
            className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="pricing-contact-title" className="text-lg font-bold text-[var(--color-text-primary)]">
              {t('contactModalTitle')}
            </h2>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">{t('contactModalBody')}</p>
            <a
              href={CONTACT_MAIL}
              className="mt-6 flex w-full justify-center rounded-xl bg-[var(--color-teal)] py-3 text-sm font-semibold text-white hover:bg-[var(--color-teal-deep)]"
            >
              {t('contactModalEmail')}
            </a>
            <button
              type="button"
              className="mt-3 w-full rounded-xl border border-[var(--color-border)] py-2.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]"
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
