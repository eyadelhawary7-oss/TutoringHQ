'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AnimatedPhoneMockup } from '@/components/landing/AnimatedPhoneMockup';
import { Link } from '@/i18n/routing';
import { formatCurrency, formatNumber } from '@/lib/formatNumber';
import { PLANS, ORDERED_SUBSCRIPTION_PLAN_KEYS } from '@/lib/pricing';
import {
  getSupportWhatsAppDisplayLabel,
  getSupportWhatsAppWaMeBase,
} from '@/lib/supportWhatsApp';
import { Menu, X } from 'lucide-react';

const WA_SUPPORT = getSupportWhatsAppWaMeBase();
const WA_SUPPORT_LABEL = getSupportWhatsAppDisplayLabel();


export default function LocaleHomePage() {
  const t = useTranslations('landing');
  const m = useTranslations('landing.marketing');
  const footerT = useTranslations('footer');
  const locale = useLocale();
  const [mobileOpen, setMobileOpen] = useState(false);

  const heroLines = t('heroTitle').split('\n').filter((line) => line.length > 0);
  const featureKeys = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'] as const;

  const renderHeroTitleLines = () =>
    heroLines.map((line, i) => {
      const isLast = i === heroLines.length - 1;
      if (!isLast) {
        return (
          <span key={i} className="block text-white">
            {line}
          </span>
        );
      }
      const trimmed = line.trim();
      const words = trimmed.split(/\s+/).filter(Boolean);
      if (words.length <= 1) {
        return (
          <span key={i} className="block text-teal-400">
            {line}
          </span>
        );
      }
      const lastWord = words[words.length - 1];
      const beforeLast = words.slice(0, -1).join(' ');
      return (
        <span key={i} className="block text-white">
          {beforeLast}{' '}
          <span className="text-teal-400">{lastWord}</span>
        </span>
      );
    });

  return (
    <main
      data-chq-landing
      className="min-h-screen bg-[#080f1a] text-white [&_h1]:text-white [&_h2]:text-white [&_h3]:text-white [&_p]:text-[var(--color-text-secondary)]"
    >
      <header className="fixed start-0 end-0 top-0 z-50 border-b border-slate-800/60 bg-[#080f1a]/90 backdrop-blur-md">
        <div className="relative mx-auto flex h-14 max-w-6xl items-center px-4 md:h-16 md:px-6">
          <button
            type="button"
            className="absolute start-4 top-1/2 z-10 inline-flex -translate-y-1/2 rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white md:hidden btn-press chq-focus [&_svg]:text-slate-300"
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? m('closeMenuAria') : m('openMenuAria')}
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
          <div className="mx-auto flex w-full max-w-full items-center justify-center gap-4 md:mx-0 md:justify-between">
            <Link
              href="/"
              locale={locale}
              className="flex items-center gap-2 btn-press chq-focus rounded-lg"
            >
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
              <a
                href="#features"
                className="text-sm text-slate-300 transition-colors hover:text-white btn-press chq-focus rounded-lg px-1 py-0.5"
              >
                {m('navFeatures')}
              </a>
              <Link
                href="/pricing"
                className="text-sm text-slate-300 transition-colors hover:text-white btn-press chq-focus rounded-lg px-1 py-0.5"
              >
                {m('navPricing')}
              </Link>
              {WA_SUPPORT ? (
                <a
                  href={WA_SUPPORT}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-slate-300 transition-colors hover:text-white btn-press chq-focus rounded-lg px-1 py-0.5"
                >
                  {m('navContact')}
                </a>
              ) : (
                <span className="text-sm text-slate-500">{m('navContact')}</span>
              )}
            </nav>

            <div className="hidden items-center gap-2 md:flex">
              <Link
                href="/"
                locale={locale === 'ar' ? 'en' : 'ar'}
                className="inline-flex rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-300 hover:text-white btn-press chq-focus"
                aria-label={m('switchLocaleAria')}
              >
                <span dir="ltr">{locale === 'ar' ? 'EN' : 'AR'}</span>
              </Link>
              <Link
                href="/login"
                className="text-sm text-slate-300 hover:text-white btn-press chq-focus rounded-lg px-2 py-1"
              >
                {m('login')}
              </Link>
              <Link
                href="/signup"
                className="rounded-xl bg-teal-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-500 inline-flex btn-press chq-focus"
              >
                {t('navSignup')}
              </Link>
            </div>
          </div>
        </div>

        {mobileOpen ? (
          <div className="border-t border-slate-800/60 bg-[#080f1a]/95 px-4 py-4 md:hidden">
            <div className="flex flex-col gap-1">
              <a
                href="#features"
                className="rounded-xl px-3 py-3 text-slate-300 btn-press chq-focus"
                onClick={() => setMobileOpen(false)}
              >
                {m('navFeatures')}
              </a>
              <Link
                href="/pricing"
                className="rounded-xl px-3 py-3 text-slate-300 btn-press chq-focus"
                onClick={() => setMobileOpen(false)}
              >
                {m('navPricing')}
              </Link>
              {WA_SUPPORT ? (
                <a
                  href={WA_SUPPORT}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl px-3 py-3 text-slate-300 btn-press chq-focus"
                  onClick={() => setMobileOpen(false)}
                >
                  {m('navContact')}
                </a>
              ) : (
                <span className="rounded-xl px-3 py-3 text-slate-500">{m('navContact')}</span>
              )}
              <Link
                href="/login"
                className="rounded-xl px-3 py-3 text-slate-300 btn-press chq-focus"
                onClick={() => setMobileOpen(false)}
              >
                {m('login')}
              </Link>
              <Link
                href="/signup"
                className="mt-2 rounded-xl bg-teal-600 py-3 text-center font-semibold text-white btn-press chq-focus"
                onClick={() => setMobileOpen(false)}
              >
                {t('navSignup')}
              </Link>
            </div>
          </div>
        ) : null}
      </header>

      <section
        className="bg-[#080f1a] px-4 pb-16 pt-24 md:px-6 md:pb-24 md:pt-28"
        style={{
          background:
            'radial-gradient(ellipse 80% 40% at 50% 0%, rgba(13, 148, 136, 0.08), transparent), #080f1a',
        }}
      >
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 md:grid-cols-2 md:gap-16">
          <div className="text-center md:text-start">
            <span className="mb-6 inline-flex items-center rounded-full border border-teal-600/50 bg-teal-950/30 px-3 py-1 text-xs text-teal-400">
              {m('heroBadge')}
            </span>
            <h1 className="text-4xl font-bold leading-tight text-white md:text-5xl">
              {renderHeroTitleLines()}
            </h1>
            <p className="mx-auto mt-6 max-w-md text-lg text-[var(--color-text-secondary)] md:mx-0">{t('heroSub')}</p>
            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center md:justify-start">
              <Link
                href="/signup"
                className="rounded-xl bg-teal-600 px-8 py-4 text-center text-lg font-semibold text-white transition-colors hover:bg-teal-500 btn-press chq-focus"
              >
                {t('heroCta')}
              </Link>
              <a
                href="#how-it-works"
                className="rounded-xl border border-slate-700 bg-slate-800 px-8 py-4 text-center text-lg font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-slate-700 hover:text-white btn-press chq-focus"
              >
                {t('watchDemo')}
              </a>
            </div>
          </div>

          <div className="flex justify-center md:justify-end">
            <div className="relative mx-auto h-[560px] w-[280px] shrink-0 drop-shadow-[0_0_80px_rgba(13,148,136,0.2)]">
              <AnimatedPhoneMockup locale={locale as 'ar' | 'en'} />
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-800/40 bg-[#080f1a] px-4 py-12 md:px-6">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
          {[
            { v: m('stat1Value'), l: m('stat1Label') },
            { v: m('stat2Value'), l: m('stat2Label') },
            { v: m('stat3Value'), l: m('stat3Label') },
          ].map((s, i) => (
            <div
              key={i}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-center"
            >
              <p className="text-3xl font-bold text-teal-400">{s.v}</p>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">{s.l}</p>
            </div>
          ))}
        </div>
      </section>

      <section
        id="how-it-works"
        className="scroll-mt-20 bg-[#080f1a] px-4 py-16 md:px-6 md:py-24"
      >
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-10 text-center text-2xl font-bold !text-white md:mb-14 md:text-3xl">
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
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-teal-700 bg-teal-900/40 text-lg font-bold text-teal-400">
                    {idx + 1}
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-white">{step.title}</h3>
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{step.desc}</p>
                </div>
              );
              if (idx < 2) {
                return [
                  block,
                  <div
                    key={`line-${idx}`}
                    className="hidden h-0 w-12 shrink-0 self-center border-t-2 border-dashed border-stone-300 md:mx-4 md:mt-6 md:block md:w-16 lg:w-24"
                    aria-hidden
                  />,
                ];
              }
              return [block];
            })}
          </div>
        </div>
      </section>

      <section
        id="features"
        className="scroll-mt-20 border-t border-slate-800/40 bg-[#080f1a] px-4 py-16 md:px-6 md:py-24"
      >
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-10 text-center text-2xl font-bold !text-white md:mb-14 md:text-3xl">
            {t('featuresTitle')}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
            {featureKeys.map((k) => (
              <div
                key={k}
                className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5"
              >
                <div
                  className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg border border-teal-700/50 bg-teal-900/40"
                  aria-hidden
                >
                  <div className="h-3 w-3 rounded-sm bg-teal-500" />
                </div>
                <h3 className="mb-1 text-sm font-semibold text-white">
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
        className="scroll-mt-20 bg-[#080f1a] px-4 py-16 md:px-6 md:py-24"
      >
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="text-2xl font-bold !text-white md:text-3xl">{t('pricingTitle')}</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-[var(--color-text-muted)] md:text-base">
            {m('pricingSubtitle')}
          </p>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ORDERED_SUBSCRIPTION_PLAN_KEYS.map((planKey) => {
              const p = PLANS[planKey];
              const priceLine = `${formatCurrency(p.quarterlyAllIn, locale)}${m('pricePerMonthSuffix')}`;
              const planTitle = locale === 'ar' ? p.arabicName : p.englishName;
              const cap = p.weeklyStudentLimit;
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
                  className={`rounded-2xl border p-6 text-start !text-white ${
                    isStarter
                      ? 'border-teal-600/60 bg-slate-800 ring-1 ring-teal-600/30'
                      : 'border-slate-700 bg-[var(--color-surface-2)]'
                  }`}
                  style={{ color: '#ffffff' }}
                >
                  <div className="flex min-h-[28px] flex-wrap items-center gap-2">
                    {isSolo ? (
                      <span className="inline-block rounded-full border border-slate-600 bg-[var(--color-surface-2)] px-2 py-0.5 text-xs !text-[var(--color-text-muted)]">
                        {m('soloBadge')}
                      </span>
                    ) : null}
                    {isStarter ? (
                      <span className="inline-block rounded-full border border-teal-700/50 bg-teal-900/30 px-2 py-0.5 text-xs font-medium !text-teal-400">
                        {m('popularBadge')}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-base font-bold !text-white">{planTitle}</p>
                  <p className="mt-2 text-2xl font-bold !text-white">{priceLine}</p>
                  <p className="mt-3 text-xs text-[var(--color-text-muted)]">{studentsLine}</p>
                </div>
              );
            })}
          </div>
          <Link
            href="/pricing"
            className="mt-10 inline-flex rounded-xl border border-slate-600 bg-[var(--color-surface-1)] px-6 py-3 text-sm font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-slate-500 hover:bg-[var(--color-surface-2)] hover:text-white btn-press chq-focus"
          >
            {m('pricingCta')}
          </Link>
        </div>
      </section>

      <section className="bg-[#080f1a] bg-gradient-to-b from-[#080f1a] via-[#0f172a] to-teal-950/50 px-4 py-16 md:px-6 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold !text-white md:text-3xl">{t('finalCtaTitle')}</h2>
          <p className="mt-3 text-sm text-[var(--color-text-secondary)] md:text-base">{t('finalCtaDesc')}</p>
          <Link
            href="/signup"
            className="mt-8 inline-flex rounded-xl bg-teal-600 px-8 py-4 text-lg font-semibold text-white transition-colors hover:bg-teal-500 btn-press chq-focus"
          >
            {m('finalCtaButton')}
          </Link>
        </div>
      </section>

      <section className="border-t border-slate-800/40 bg-[#0c1424] px-4 py-12 md:px-6 md:py-16">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-400">{m('trustBandKicker')}</p>
          <h2 className="mt-2 text-xl font-bold text-white md:text-2xl">{m('trustBandTitle')}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-400">{m('trustBandBody')}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <Link
              href="/pricing"
              className="inline-flex rounded-xl border border-slate-600 bg-slate-800/80 px-6 py-3 text-sm font-semibold text-white transition-colors hover:border-teal-600/50 hover:bg-slate-800 btn-press chq-focus"
            >
              {m('trustBandPricing')}
            </Link>
            {WA_SUPPORT ? (
              <a
                href={WA_SUPPORT}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-xl bg-teal-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-500 btn-press chq-focus"
              >
                {m('trustBandContact')}
              </a>
            ) : (
              <a
                href="mailto:eyad@ehgintelligence.com"
                className="inline-flex rounded-xl bg-teal-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-500 btn-press chq-focus"
              >
                {m('trustBandContact')}
              </a>
            )}
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800/60 bg-[#080f1a] px-4 py-10 md:px-6">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-4 text-center text-sm text-slate-400">
          <p>{m('footerTagline')}</p>
          <p className="text-xs">{footerT('ehgProduct')}</p>
          {WA_SUPPORT ? (
            <a
              href={WA_SUPPORT}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 transition-colors hover:text-white btn-press chq-focus rounded-lg px-2 py-1"
            >
              {WA_SUPPORT_LABEL
                ? `${m('footerSupportLabel')}: ${WA_SUPPORT_LABEL}`
                : m('footerSupportLabel')}
            </a>
          ) : (
            <p className="text-slate-500">{m('footerSupportLabel')}</p>
          )}
          <p className="text-xs text-slate-600">{m('footerRights')}</p>
        </div>
      </footer>
    </main>
  );
}
