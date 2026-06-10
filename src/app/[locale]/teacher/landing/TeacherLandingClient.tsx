'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Building2, Users, Zap, Wallet, Banknote, MessageCircle, Check, Menu, X } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { getSupportWhatsAppWaMeBase } from '@/lib/supportWhatsApp';

const WA_SUPPORT = getSupportWhatsAppWaMeBase();

/**
 * PUBLIC teacher marketing page (the teacher journey's first-class landing).
 * Lives at /teacher/landing because /teacher is the authenticated portal home.
 * Fresh teacher-specific copy - NOT ported from the center page. Cream
 * throughout; brass identity for the private engine, teal for center features.
 */
export default function TeacherLandingClient() {
  const t = useTranslations('teacherLanding');
  const tp = useTranslations('pricingPage.teacher'); // shared teacher pricing card copy
  const f = useTranslations('splash'); // shared footer/legal links
  const locale = useLocale();
  const isAr = locale === 'ar';
  const [mobileOpen, setMobileOpen] = useState(false);

  const features = [
    { title: t('features.f1.title'), body: t('features.f1.body'), accent: 'teal' as const, Icon: Building2 },
    { title: t('features.f2.title'), body: t('features.f2.body'), accent: 'brass' as const, Icon: Users },
    { title: t('features.f3.title'), body: t('features.f3.body'), accent: 'brass' as const, Icon: Zap },
    { title: t('features.f4.title'), body: t('features.f4.body'), accent: 'teal' as const, Icon: Wallet },
    { title: t('features.f5.title'), body: t('features.f5.body'), accent: 'brass' as const, Icon: Banknote },
    { title: t('features.f6.title'), body: t('features.f6.body'), accent: 'teal' as const, Icon: MessageCircle },
  ];

  const teacherFeatures = [tp('feature1'), tp('feature2'), tp('feature3'), tp('feature4')];

  return (
    <main
      dir={isAr ? 'rtl' : 'ltr'}
      className="relative flex min-h-screen w-full flex-col bg-[var(--color-surface-0)] text-[var(--color-text-primary)]"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 70% 40% at 50% 0%, rgba(154,107,31,0.06), transparent 70%)',
      }}
    >
      {/* Full nav */}
      <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-surface-1)]/90 backdrop-blur-md">
        <div className="relative mx-auto flex h-14 max-w-6xl items-center px-4 md:h-16 md:px-6">
          <button
            type="button"
            className="absolute start-4 top-1/2 z-10 inline-flex -translate-y-1/2 rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)] md:hidden btn-press chq-focus"
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? t('nav.closeMenu') : t('nav.openMenu')}
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <X className="h-6 w-6" aria-hidden /> : <Menu className="h-6 w-6" aria-hidden />}
          </button>
          <div className="mx-auto flex w-full max-w-full items-center justify-center gap-4 md:mx-0 md:justify-between">
            <Link
              href="/"
              className="text-lg tracking-tight btn-press chq-focus rounded-lg"
              aria-label="CenterHQ"
              style={{ fontFamily: 'var(--font-bodoni)', fontWeight: 700, letterSpacing: '2px' }}
            >
              <span style={{ color: 'var(--color-text-primary)' }}>CENTER</span>
              <span style={{ color: 'var(--color-teal)' }}>HQ</span>
            </Link>

            <nav className="hidden flex-1 items-center justify-center gap-8 md:flex" aria-label="Main">
              <a
                href="#features"
                className="text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] btn-press chq-focus rounded-lg px-1 py-0.5"
              >
                {t('nav.features')}
              </a>
              <Link
                href="/pricing?for=teacher"
                className="text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] btn-press chq-focus rounded-lg px-1 py-0.5"
              >
                {t('nav.pricing')}
              </Link>
              {WA_SUPPORT ? (
                <a
                  href={WA_SUPPORT}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] btn-press chq-focus rounded-lg px-1 py-0.5"
                >
                  {t('nav.contact')}
                </a>
              ) : (
                <span className="text-sm text-[var(--color-text-muted)]">{t('nav.contact')}</span>
              )}
            </nav>

            <div className="hidden items-center gap-2 md:flex">
              <Link
                href="/teacher/landing"
                locale={isAr ? 'en' : 'ar'}
                aria-label={f('switchLocaleAria')}
                className="inline-flex rounded-lg px-2 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] btn-press chq-focus"
              >
                <span dir="ltr">{isAr ? 'EN' : 'AR'}</span>
              </Link>
              <Link
                href="/login"
                className="rounded-lg px-2 py-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] btn-press chq-focus"
              >
                {t('login')}
              </Link>
              <Link
                href="/teacher/signup"
                className="inline-flex rounded-xl px-5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 btn-press chq-focus"
                style={{ background: 'var(--color-brass)' }}
              >
                {t('ctaPrimary')}
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
                {t('nav.features')}
              </a>
              <Link
                href="/pricing?for=teacher"
                className="rounded-xl px-3 py-3 text-[var(--color-text-secondary)] btn-press chq-focus"
                onClick={() => setMobileOpen(false)}
              >
                {t('nav.pricing')}
              </Link>
              {WA_SUPPORT ? (
                <a
                  href={WA_SUPPORT}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl px-3 py-3 text-[var(--color-text-secondary)] btn-press chq-focus"
                  onClick={() => setMobileOpen(false)}
                >
                  {t('nav.contact')}
                </a>
              ) : null}
              <Link
                href="/login"
                className="rounded-xl px-3 py-3 text-[var(--color-text-secondary)] btn-press chq-focus"
                onClick={() => setMobileOpen(false)}
              >
                {t('login')}
              </Link>
              <Link
                href="/teacher/signup"
                className="mt-2 rounded-xl py-3 text-center font-semibold text-white btn-press chq-focus"
                style={{ background: 'var(--color-brass)' }}
                onClick={() => setMobileOpen(false)}
              >
                {t('ctaPrimary')}
              </Link>
            </div>
          </div>
        ) : null}
      </header>

      {/* Hero */}
      <section className="mx-auto w-full max-w-5xl px-5 pt-8 md:px-6 md:pt-14">
        <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2 md:gap-14">
          <div className="text-center md:text-start">
            <span className="mb-5 inline-flex items-center rounded-full border border-[var(--color-brass)]/35 bg-[var(--color-brass-soft)] px-3 py-1 text-xs font-medium" style={{ color: 'var(--color-brass)' }}>
              {t('badge')}
            </span>
            <h1 className="text-3xl font-bold leading-tight text-[var(--color-text-primary)] md:text-5xl">
              {t('heroTitle')}
            </h1>
            <p className="mx-auto mt-5 max-w-md text-base text-[var(--color-text-secondary)] md:mx-0 md:text-lg">
              {t('heroSub')}
            </p>
            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center md:justify-start">
              <Link
                href="/teacher/signup"
                className="rounded-xl bg-[var(--color-brass)] px-7 py-3.5 text-center text-base font-semibold text-white transition-opacity hover:opacity-90"
              >
                {t('ctaPrimary')}
              </Link>
              <Link
                href="/login"
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] px-7 py-3.5 text-center text-base font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
              >
                {t('ctaSecondary')}
              </Link>
            </div>
          </div>

          {/* Illustrated income card (static .money-hero surface) */}
          <div className="flex justify-center md:justify-end">
            <div className="money-hero w-full max-w-sm rounded-[var(--radius-card)] p-6">
              <p className="text-sm text-white/80">{t('mock.label')}</p>
              <p className="mt-1 text-3xl font-bold text-white">{t('mock.total')}</p>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.15)' }}>
                  <p className="text-xs text-white/70">{t('mock.fromCenters')}</p>
                  <p className="mt-1 text-lg font-bold text-white">{t('mock.fromCentersAmount')}</p>
                </div>
                <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.15)' }}>
                  <p className="text-xs text-white/70">{t('mock.fromPrivate')}</p>
                  <p className="mt-1 text-lg font-bold text-white">{t('mock.fromPrivateAmount')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem / pain */}
      <section className="mt-16 border-y border-[var(--color-border)] bg-[var(--color-surface-1)] px-5 py-16 md:px-6 md:py-20">
        <div className="mx-auto max-w-[700px] text-center">
          <h2 className="text-2xl font-bold text-[var(--color-text-primary)] md:text-3xl">{t('pain.heading')}</h2>
          <p className="mx-auto mt-6 text-base leading-relaxed text-[var(--color-text-secondary)]">{t('pain.body')}</p>
          <p className="mx-auto mt-6 text-lg font-medium text-[var(--color-teal-deep)]">{t('pain.connector')}</p>
        </div>
      </section>

      {/* How it works (3 numbered steps) */}
      <section className="mx-auto w-full max-w-5xl px-5 py-16 md:px-6 md:py-20">
        <h2 className="mb-10 text-center text-2xl font-bold text-[var(--color-text-primary)] md:text-3xl">
          {t('how.title')}
        </h2>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {[
            { n: 1, title: t('how.step1.title'), body: t('how.step1.body') },
            { n: 2, title: t('how.step2.title'), body: t('how.step2.body') },
            { n: 3, title: t('how.step3.title'), body: t('how.step3.body') },
          ].map((step) => (
            <div key={step.n} className="flex flex-col items-center text-center md:items-start md:text-start">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-brass-soft)] text-lg font-bold"
                style={{ color: 'var(--color-brass)' }}
                aria-hidden
              >
                {step.n}
              </span>
              <h3 className="mt-4 text-base font-bold text-[var(--color-text-primary)]">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features (6 tiles, 2 columns desktop) */}
      <section id="features" className="scroll-mt-20 border-t border-[var(--color-border)] bg-[var(--color-surface-1)] px-5 py-16 md:px-6 md:py-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-10 text-center text-2xl font-bold text-[var(--color-text-primary)] md:mb-14 md:text-3xl">
            {t('featuresTitle')}
          </h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {features.map((feature, i) => {
              const isBrass = feature.accent === 'brass';
              const Icon = feature.Icon;
              return (
                <div
                  key={i}
                  className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-0)] p-6 shadow-[var(--shadow-card)]"
                  style={{ borderTopColor: isBrass ? 'var(--color-brass)' : 'var(--color-teal)', borderTopWidth: '3px' }}
                >
                  <span
                    className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl"
                    style={
                      isBrass
                        ? { background: 'var(--color-brass-soft)', color: 'var(--color-brass)' }
                        : { background: 'var(--color-teal-soft)', color: 'var(--color-teal-deep)' }
                    }
                    aria-hidden
                  >
                    <Icon size={22} />
                  </span>
                  <h3 className="text-base font-bold text-[var(--color-text-primary)]">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{feature.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing preview */}
      <section className="mx-auto w-full max-w-md px-5 py-16 md:px-6 md:py-20">
        <h2 className="text-center text-2xl font-bold text-[var(--color-text-primary)] md:text-3xl">
          {t('pricingPreview.heading')}
        </h2>
        <div
          className="mt-8 flex flex-col rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-start shadow-[var(--shadow-card)]"
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
          <ul className="mt-5 space-y-2.5">
            {teacherFeatures.map((feature, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)]">
                <Check size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--color-brass)' }} aria-hidden />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <p
            className="mt-4 rounded-lg bg-[var(--color-brass-soft)] p-3 text-xs leading-relaxed"
            style={{ color: 'var(--color-text-amber)' }}
          >
            {tp('freeNote')}
          </p>
          <Link
            href="/teacher/signup"
            className="mt-6 inline-flex w-full justify-center rounded-xl px-6 py-3 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90 btn-press chq-focus"
            style={{ background: 'var(--color-brass)' }}
          >
            {tp('cta')}
          </Link>
        </div>
        <div className="mt-5 text-center">
          <Link
            href="/pricing?for=teacher"
            className="text-sm font-semibold text-[var(--color-text-secondary)] underline-offset-4 transition-colors hover:text-[var(--color-text-primary)] hover:underline"
          >
            {t('pricingPreview.seeFullPricing')}
          </Link>
        </div>
      </section>

      {/* Social proof placeholder (honest, no fake reviews) */}
      <section className="mx-auto w-full max-w-3xl px-5 py-12 md:px-6">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-brass)]/30 bg-[var(--color-brass-soft)] p-8 text-center">
          <h2 className="text-lg font-bold md:text-xl" style={{ color: 'var(--color-brass)' }}>
            {t('social.title')}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed" style={{ color: 'var(--color-text-amber)' }}>
            {t('social.subtext')}
          </p>
        </div>
      </section>

      {/* Final CTA (repeat free-trial button + trial terms line) */}
      <section className="mx-auto w-full max-w-3xl px-5 pb-16 text-center md:px-6">
        <h2 className="text-xl font-bold text-[var(--color-text-primary)] md:text-2xl">{t('finalCta.title')}</h2>
        <div className="mt-6 flex justify-center">
          <Link
            href="/teacher/signup"
            className="rounded-xl bg-[var(--color-brass)] px-8 py-4 text-center text-base font-semibold text-white transition-opacity hover:opacity-90"
          >
            {t('ctaPrimary')}
          </Link>
        </div>
        <p className="mx-auto mt-4 max-w-lg text-xs leading-relaxed text-[var(--color-text-muted)]">
          {t('trialTerms')}
        </p>
      </section>

      {/* Footer (shared with splash) */}
      <footer className="mx-auto mt-auto w-full max-w-5xl px-5 py-8 md:px-6">
        <div className="flex flex-col items-center gap-3 border-t border-[var(--color-border)] pt-6 text-center text-xs text-[var(--color-text-muted)]">
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2" aria-label={f('footerNavAria')}>
            <Link href="/privacy" className="transition-colors hover:text-[var(--color-text-primary)]">{f('privacy')}</Link>
            <Link href="/terms" className="transition-colors hover:text-[var(--color-text-primary)]">{f('terms')}</Link>
            <a href="#" className="transition-colors hover:text-[var(--color-text-primary)]">{f('cookies')}</a>
          </nav>
          <p>{f('rights')}</p>
        </div>
      </footer>
    </main>
  );
}
