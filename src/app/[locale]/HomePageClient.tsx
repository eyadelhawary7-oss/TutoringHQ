'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { HeroVisuals } from '@/components/landing/HeroVisuals';
import { ComparisonTable } from '@/components/landing/ComparisonTable';
import { LandingFAQ } from '@/components/landing/LandingFAQ';
import { TrustSignals } from '@/components/landing/TrustSignals';
import { Link } from '@/i18n/routing';
import { formatCurrency, formatNumber } from '@/lib/formatNumber';
import { PLANS, ORDERED_SUBSCRIPTION_PLAN_KEYS } from '@/lib/pricing';
import {
  getSupportWhatsAppDisplayLabel,
  getSupportWhatsAppWaMeBase,
} from '@/lib/supportWhatsApp';
import { Menu, X } from 'lucide-react';
import PricingBannerClient from '@/components/landing/PricingBannerClient';
import PromoPopup from '@/components/landing/PromoPopup';
import SummerRibbon from '@/components/summer/SummerRibbon';
import SummerPopup from '@/components/summer/SummerPopup';
import { usePublicPlanPrices } from '@/hooks/usePublicPlanPrices';
import { SITE } from '@/config/site';

const WA_SUPPORT = getSupportWhatsAppWaMeBase();
const WA_SUPPORT_LABEL = getSupportWhatsAppDisplayLabel();


/**
 * The CENTER journey landing page (rendered at /center). Cream throughout: the
 * dark theme is the user-toggle option only, so every surface uses the cream
 * token system from globals.css. The QR-to-income story for center owners.
 */
export default function HomePageClient() {
  const t = useTranslations('landing');
  const m = useTranslations('landing.marketing');
  const tPricingTile = useTranslations('pricing.tile');
  const footerT = useTranslations('footer');
  const locale = useLocale();
  const [mobileOpen, setMobileOpen] = useState(false);

  const heroLines = t('heroTitle').split('\n').filter((line) => line.length > 0);
  const featureKeys = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'] as const;
  const primaryPlanKeys = ORDERED_SUBSCRIPTION_PLAN_KEYS.slice(0, 3);
  const secondaryPlanKeys = ORDERED_SUBSCRIPTION_PLAN_KEYS.slice(3);
  const dynamicPlanPrices = usePublicPlanPrices();

  const renderHeroTitleLines = () =>
    heroLines.map((line, i) => {
      const isLast = i === heroLines.length - 1;
      if (!isLast) {
        return (
          <span key={i} className="block text-[var(--color-text-primary)]">
            {line}
          </span>
        );
      }
      const trimmed = line.trim();
      const words = trimmed.split(/\s+/).filter(Boolean);
      if (words.length <= 1) {
        return (
          <span key={i} className="block text-[var(--color-teal)]">
            {line}
          </span>
        );
      }
      const lastWord = words[words.length - 1];
      const beforeLast = words.slice(0, -1).join(' ');
      return (
        <span key={i} className="block text-[var(--color-text-primary)]">
          {beforeLast}{' '}
          <span className="text-[var(--color-teal)]">{lastWord}</span>
        </span>
      );
    });

  return (
    <main
      data-chq-landing
      className="min-h-screen bg-[var(--color-surface-0)] text-[var(--color-text-primary)]"
    >
      <SummerRibbon locale={locale} portal="combined" ctaHref="/signup" />
      <SummerPopup locale={locale} portal="combined" ctaHref="/signup" />
      <PricingBannerClient locale={locale} variant="strip" />
      <PromoPopup locale={locale} />
      <header className="fixed start-0 end-0 top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-surface-1)]/90 backdrop-blur-md">
        <div className="relative mx-auto flex h-14 max-w-6xl items-center px-4 md:h-16 md:px-6">
          <button
            type="button"
            className="absolute start-4 top-1/2 z-10 inline-flex -translate-y-1/2 rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)] md:hidden btn-press chq-focus"
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? m('closeMenuAria') : m('openMenuAria')}
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
          <div className="mx-auto flex w-full max-w-full items-center justify-center gap-4 md:mx-0 md:justify-between">
            <Link
              href="/center"
              locale={locale}
              className="flex items-center gap-2 btn-press chq-focus rounded-lg"
            >
              <span className="text-lg tracking-tight">
                <span
                  style={{
                    fontFamily: 'var(--font-bodoni)',
                    fontWeight: 700,
                    letterSpacing: '2px',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  Tutoring
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
              <a
                href="#features"
                className="text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] btn-press chq-focus rounded-lg px-1 py-0.5"
              >
                {m('navFeatures')}
              </a>
              <Link
                href="/pricing"
                className="text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] btn-press chq-focus rounded-lg px-1 py-0.5"
              >
                {m('navPricing')}
              </Link>
              <Link
                href="/teacher/landing"
                className="text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] btn-press chq-focus rounded-lg px-1 py-0.5"
              >
                {m('navTeacher')}
              </Link>
              {WA_SUPPORT ? (
                <a
                  href={WA_SUPPORT}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] btn-press chq-focus rounded-lg px-1 py-0.5"
                >
                  {m('navContact')}
                </a>
              ) : (
                <span className="text-sm text-[var(--color-text-muted)]">{m('navContact')}</span>
              )}
            </nav>

            <div className="hidden items-center gap-2 md:flex">
              <Link
                href="/center"
                locale={locale === 'ar' ? 'en' : 'ar'}
                className="inline-flex rounded-lg px-2 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] btn-press chq-focus"
                aria-label={m('switchLocaleAria')}
              >
                <span dir="ltr">{locale === 'ar' ? 'EN' : 'AR'}</span>
              </Link>
              <Link
                href="/login"
                className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] btn-press chq-focus rounded-lg px-2 py-1"
              >
                {m('login')}
              </Link>
              <Link
                href="/teacher/signup"
                className="rounded-xl bg-[var(--color-teal)] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-teal-deep)] inline-flex btn-press chq-focus"
              >
                {t('navSignup')}
              </Link>
            </div>
          </div>
        </div>

        {mobileOpen ? (
          <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-4 md:hidden">
            <div className="flex flex-col gap-1">
              <a
                href="#features"
                className="rounded-xl px-3 py-3 text-[var(--color-text-secondary)] btn-press chq-focus"
                onClick={() => setMobileOpen(false)}
              >
                {m('navFeatures')}
              </a>
              <Link
                href="/pricing"
                className="rounded-xl px-3 py-3 text-[var(--color-text-secondary)] btn-press chq-focus"
                onClick={() => setMobileOpen(false)}
              >
                {m('navPricing')}
              </Link>
              <Link
                href="/teacher/landing"
                className="rounded-xl px-3 py-3 text-[var(--color-text-secondary)] btn-press chq-focus"
                onClick={() => setMobileOpen(false)}
              >
                {m('navTeacher')}
              </Link>
              {WA_SUPPORT ? (
                <a
                  href={WA_SUPPORT}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl px-3 py-3 text-[var(--color-text-secondary)] btn-press chq-focus"
                  onClick={() => setMobileOpen(false)}
                >
                  {m('navContact')}
                </a>
              ) : (
                <span className="rounded-xl px-3 py-3 text-[var(--color-text-muted)]">{m('navContact')}</span>
              )}
              <Link
                href="/login"
                className="rounded-xl px-3 py-3 text-[var(--color-text-secondary)] btn-press chq-focus"
                onClick={() => setMobileOpen(false)}
              >
                {m('login')}
              </Link>
              <Link
                href="/teacher/signup"
                className="mt-2 rounded-xl bg-[var(--color-teal)] py-3 text-center font-semibold text-white btn-press chq-focus"
                onClick={() => setMobileOpen(false)}
              >
                {t('navSignup')}
              </Link>
            </div>
          </div>
        ) : null}
      </header>

      <section
        className="px-4 pb-16 pt-24 md:px-6 md:pb-24 md:pt-28"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 80% 40% at 50% 0%, rgba(14,107,97,0.07), transparent 70%)',
        }}
      >
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 md:grid-cols-2 md:gap-16">
          <div className="text-center md:text-start">
            <span className="mb-6 inline-flex items-center rounded-full border border-[var(--color-teal)]/40 bg-[var(--color-teal-soft)] px-3 py-1 text-xs text-[var(--color-teal-deep)]">
              {m('heroBadge')}
            </span>
            <h1 className="text-4xl font-bold leading-tight md:text-5xl">
              {renderHeroTitleLines()}
            </h1>
            <p className="mx-auto mt-6 max-w-md text-lg text-[var(--color-text-secondary)] md:mx-0">{t('heroSub')}</p>
            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center md:justify-start">
              <Link
                href="/signup"
                className="rounded-xl bg-[var(--color-teal)] px-8 py-4 text-center text-lg font-semibold text-white transition-colors hover:bg-[var(--color-teal-deep)] btn-press chq-focus"
              >
                {t('heroCta')}
              </Link>
              <a
                href="#how-it-works"
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] px-8 py-4 text-center text-lg font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)] btn-press chq-focus"
              >
                {t('watchDemo')}
              </a>
            </div>
          </div>

          <div className="flex justify-center md:justify-end">
            {/* The phone mockup is an intentionally dark visual; it sits inside a
                slightly darker tile so it reads as a deliberate device frame
                rather than a dark patch floating on the cream page. */}
            <div className="rounded-[var(--radius-card)] bg-[var(--color-surface-2)] p-5 shadow-[var(--shadow-card)] md:p-6">
              <HeroVisuals locale={locale as 'ar' | 'en'} />
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-16 md:px-6 md:py-20">
        <div className="mx-auto max-w-[700px] text-center">
          <h2 className="text-2xl font-bold text-[var(--color-text-primary)] md:text-3xl">{t('problem.heading')}</h2>
          <p className="mx-auto mt-6 text-base leading-relaxed text-[var(--color-text-secondary)]">
            {t('problem.body')}
          </p>
          <p className="mx-auto mt-6 text-lg font-medium text-[var(--color-teal-deep)]">{t('problem.connector')}</p>
        </div>
      </section>

      <section
        id="how-it-works"
        className="scroll-mt-20 px-4 py-16 md:px-6 md:py-24"
      >
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-10 text-center text-2xl font-bold text-[var(--color-text-primary)] md:mb-14 md:text-3xl">
            {m('howTitle')}
          </h2>
          <div className="flex flex-col items-center gap-10 md:flex-row md:items-start md:justify-center md:gap-0">
            {[
              { title: m('step1Title'), desc: m('step1Desc') },
              { title: m('step2Title'), desc: m('step2Desc') },
              { title: m('step3Title'), desc: m('step3Desc') },
            ].flatMap((step, idx) => {
              const block = (
                <div
                  key={`step-${idx}`}
                  className="flex max-w-xs flex-col items-center text-center md:max-w-[220px] md:shrink-0"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--color-teal)]/40 bg-[var(--color-teal-soft)] text-lg font-bold text-[var(--color-teal-deep)]">
                    {idx + 1}
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-[var(--color-text-primary)]">{step.title}</h3>
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{step.desc}</p>
                </div>
              );
              if (idx < 2) {
                return [
                  block,
                  <div
                    key={`line-${idx}`}
                    className="hidden h-0 w-12 shrink-0 self-center border-t-2 border-dashed border-[var(--color-border-strong)] md:mx-4 md:mt-6 md:block md:w-16 lg:w-24"
                    aria-hidden
                  />,
                ];
              }
              return [block];
            })}
          </div>
        </div>
      </section>

      <ComparisonTable />

      <section
        id="features"
        className="scroll-mt-20 border-t border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-16 md:px-6 md:py-24"
      >
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-10 text-center text-2xl font-bold text-[var(--color-text-primary)] md:mb-14 md:text-3xl">
            {t('featuresTitle')}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
            {featureKeys.map((k) => (
              <div
                key={k}
                className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-0)] p-5"
              >
                <div
                  className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-teal)]/30 bg-[var(--color-teal-soft)]"
                  aria-hidden
                >
                  <div className="h-3 w-3 rounded-sm bg-[var(--color-teal)]" />
                </div>
                <h3 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">
                  {m(`${k}Title` as 'f1Title')}
                </h3>
                <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">{m(`${k}Desc` as 'f1Desc')}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="pricing-preview"
        className="scroll-mt-20 px-4 py-16 md:px-6 md:py-24"
      >
        <div className="mx-auto max-w-5xl">
          <PricingBannerClient locale={locale} variant="section" />
        </div>
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="text-2xl font-bold text-[var(--color-text-primary)] md:text-3xl">{t('pricingTitle')}</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-[var(--color-text-muted)] md:text-base">
            {m('pricingSubtitle')}
          </p>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {primaryPlanKeys.map((planKey) => {
              const p = PLANS[planKey];
              const dyn = dynamicPlanPrices[planKey];
              const priceLine = `${formatCurrency(dyn.quarterlyAllIn, locale)}${m('pricePerMonthSuffix')}`;
              const quarterlyTotal = dyn.quarterlyAllIn * 3;
              const quarterlyDisclosure = tPricingTile('quarterlyDisclosure', {
                amount: formatCurrency(quarterlyTotal, locale),
              });
              const planTitle = locale === 'ar' ? p.arabicName : p.englishName;
              const cap = dyn.weeklyStudentLimit ?? p.weeklyStudentLimit;
              const studentsLine =
                cap != null
                  ? locale === 'ar'
                    ? `حتى ${formatNumber(cap, locale)} طالب`
                    : `Up to ${formatNumber(cap, locale)} students`
                  : '';
              const isStarter = planKey === 'starter';
              const isSolo = planKey === 'solo';
              return (
                <div
                  key={planKey}
                  className={`rounded-2xl border p-6 text-start ${
                    isStarter
                      ? 'border-[var(--color-teal)]/50 bg-[var(--color-surface-1)] ring-1 ring-[var(--color-teal)]/25'
                      : 'border-[var(--color-border)] bg-[var(--color-surface-1)]'
                  }`}
                >
                  <div className="flex min-h-[28px] flex-wrap items-center gap-2">
                    {isSolo ? (
                      <span className="inline-block rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
                        {m('soloBadge')}
                      </span>
                    ) : null}
                    {isStarter ? (
                      <span className="inline-block rounded-full border border-[var(--color-teal)]/30 bg-[var(--color-teal-soft)] px-2 py-0.5 text-xs font-medium text-[var(--color-teal-deep)]">
                        {m('popularBadge')}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-base font-bold text-[var(--color-text-primary)]">{planTitle}</p>
                  <p className="mt-2 text-2xl font-bold text-[var(--color-text-primary)]">{priceLine}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{quarterlyDisclosure}</p>
                  <p className="mt-3 text-xs text-[var(--color-text-muted)]">{studentsLine}</p>
                </div>
              );
            })}
          </div>
          <div className="mt-8 border-t border-[var(--color-border)] pt-6">
            <p className="mb-4 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              {t('pricing.largerCentresHeading')}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {secondaryPlanKeys.map((planKey) => {
                const p = PLANS[planKey];
                const dyn = dynamicPlanPrices[planKey];
                const priceLine = `${formatCurrency(dyn.quarterlyAllIn, locale)}${m('pricePerMonthSuffix')}`;
                const quarterlyTotal = dyn.quarterlyAllIn * 3;
                const quarterlyDisclosure = tPricingTile('quarterlyDisclosure', {
                  amount: formatCurrency(quarterlyTotal, locale),
                });
                const planTitle = locale === 'ar' ? p.arabicName : p.englishName;
                const cap = dyn.weeklyStudentLimit ?? p.weeklyStudentLimit;
                const studentsLine =
                  cap != null
                    ? locale === 'ar'
                      ? `حتى ${formatNumber(cap, locale)} طالب`
                      : `Up to ${formatNumber(cap, locale)} students`
                    : '';
                return (
                  <div
                    key={planKey}
                    className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-start"
                  >
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">{planTitle}</p>
                    <p className="mt-1.5 text-lg font-bold text-[var(--color-text-primary)]">{priceLine}</p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">{quarterlyDisclosure}</p>
                    <p className="mt-2 text-xs text-[var(--color-text-muted)]">{studentsLine}</p>
                  </div>
                );
              })}
            </div>
          </div>
          <Link
            href="/pricing"
            className="mt-10 inline-flex rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] px-6 py-3 text-sm font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)] btn-press chq-focus"
          >
            {m('pricingCta')}
          </Link>
        </div>
      </section>

      <LandingFAQ />

      <TrustSignals />

      <section className="border-y border-[var(--color-border)] bg-[var(--color-teal-soft)] px-4 py-16 md:px-6 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold text-[var(--color-text-primary)] md:text-3xl">{t('finalCtaTitle')}</h2>
          <div className="mt-3 flex flex-col gap-1">
            <p className="text-sm text-[var(--color-text-secondary)] md:text-base">{t('finalCta.setup')}</p>
            <p className="text-sm text-[var(--color-text-secondary)] md:text-base">{t('finalCta.payment')}</p>
          </div>
          <Link
            href="/signup"
            className="mt-8 inline-flex rounded-xl bg-[var(--color-teal)] px-8 py-4 text-lg font-semibold text-white transition-colors hover:bg-[var(--color-teal-deep)] btn-press chq-focus"
          >
            {m('finalCtaButton')}
          </Link>
        </div>
      </section>

      <section className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-12 md:px-6 md:py-16">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-teal-deep)]">{m('trustBandKicker')}</p>
          <h2 className="mt-2 text-xl font-bold text-[var(--color-text-primary)] md:text-2xl">{m('trustBandTitle')}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-[var(--color-text-secondary)]">{m('trustBandBody')}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <Link
              href="/pricing"
              className="inline-flex rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] px-6 py-3 text-sm font-semibold text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-teal)]/40 hover:bg-[var(--color-surface-2)] btn-press chq-focus"
            >
              {m('trustBandPricing')}
            </Link>
            {WA_SUPPORT ? (
              <a
                href={WA_SUPPORT}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-xl bg-[var(--color-teal)] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-teal-deep)] btn-press chq-focus"
              >
                {m('trustBandContact')}
              </a>
            ) : (
              <a
                href={`mailto:${SITE.supportEmail}`}
                className="inline-flex rounded-xl bg-[var(--color-teal)] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-teal-deep)] btn-press chq-focus"
              >
                {m('trustBandContact')}
              </a>
            )}
          </div>
        </div>
      </section>

      <footer className="border-t border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-10 md:px-6">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-4 text-center text-sm text-[var(--color-text-secondary)]">
          <p>{m('footerTagline')}</p>
          <p className="text-xs">{footerT('ehgProduct')}</p>
          {WA_SUPPORT ? (
            <a
              href={WA_SUPPORT}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] btn-press chq-focus rounded-lg px-2 py-1"
            >
              {WA_SUPPORT_LABEL
                ? `${m('footerSupportLabel')}: ${WA_SUPPORT_LABEL}`
                : m('footerSupportLabel')}
            </a>
          ) : (
            <p className="text-[var(--color-text-muted)]">{m('footerSupportLabel')}</p>
          )}
          <p className="text-xs text-[var(--color-text-muted)]">{m('footerRights')}</p>
        </div>
      </footer>
    </main>
  );
}
