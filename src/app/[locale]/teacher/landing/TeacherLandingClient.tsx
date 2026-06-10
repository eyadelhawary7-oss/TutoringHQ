'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Building2, Users, Send } from 'lucide-react';
import { Link } from '@/i18n/routing';

/**
 * PUBLIC teacher marketing page (the teacher journey's first-class landing).
 * Lives at /teacher/landing because /teacher is the authenticated portal home.
 * Fresh teacher-specific copy - NOT ported from the center page. Cream
 * throughout; brass identity for the private engine, teal for center features.
 */
export default function TeacherLandingClient() {
  const t = useTranslations('teacherLanding');
  const f = useTranslations('splash'); // shared footer/legal links
  const locale = useLocale();
  const isAr = locale === 'ar';

  return (
    <main
      dir={isAr ? 'rtl' : 'ltr'}
      className="relative flex min-h-screen w-full flex-col bg-[var(--color-surface-0)] text-[var(--color-text-primary)]"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 70% 40% at 50% 0%, rgba(154,107,31,0.06), transparent 70%)',
      }}
    >
      {/* Minimal header: brand mark + Log in */}
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5 md:px-6">
        <Link href="/" className="text-lg tracking-tight" aria-label="CenterHQ" style={{ fontFamily: 'var(--font-bodoni)', fontWeight: 700, letterSpacing: '2px' }}>
          <span style={{ color: 'var(--color-text-primary)' }}>CENTER</span>
          <span style={{ color: 'var(--color-teal)' }}>HQ</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/teacher/landing"
            locale={isAr ? 'en' : 'ar'}
            aria-label={f('switchLocaleAria')}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
          >
            <span dir="ltr">{isAr ? 'EN' : 'AR'}</span>
          </Link>
          <Link
            href="/login"
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            {t('login')}
          </Link>
        </div>
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

      {/* Three feature tiles */}
      <section className="mx-auto w-full max-w-5xl px-5 py-16 md:px-6 md:py-20">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {/* Centers tile (teal) */}
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 shadow-[var(--shadow-card)]" style={{ borderTopColor: 'var(--color-teal)', borderTopWidth: '3px' }}>
            <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: 'var(--color-teal-soft)', color: 'var(--color-teal-deep)' }} aria-hidden>
              <Building2 size={22} />
            </span>
            <h3 className="text-base font-bold text-[var(--color-text-primary)]">{t('tiles.centers.title')}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{t('tiles.centers.body')}</p>
          </div>
          {/* Private tile (brass) */}
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 shadow-[var(--shadow-card)]" style={{ borderTopColor: 'var(--color-brass)', borderTopWidth: '3px' }}>
            <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: 'var(--color-brass-soft)', color: 'var(--color-brass)' }} aria-hidden>
              <Users size={22} />
            </span>
            <h3 className="text-base font-bold text-[var(--color-text-primary)]">{t('tiles.private.title')}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{t('tiles.private.body')}</p>
          </div>
          {/* Payments tile (brass) */}
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 shadow-[var(--shadow-card)]" style={{ borderTopColor: 'var(--color-brass)', borderTopWidth: '3px' }}>
            <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: 'var(--color-brass-soft)', color: 'var(--color-brass)' }} aria-hidden>
              <Send size={22} />
            </span>
            <h3 className="text-base font-bold text-[var(--color-text-primary)]">{t('tiles.payments.title')}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{t('tiles.payments.body')}</p>
          </div>
        </div>
      </section>

      {/* Trial terms */}
      <section className="mx-auto w-full max-w-3xl px-5 pb-16 md:px-6">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-brass)]/30 bg-[var(--color-brass-soft)] p-6 text-center">
          <p className="text-sm font-medium leading-relaxed" style={{ color: 'var(--color-text-amber)' }}>
            {t('trialTerms')}
          </p>
        </div>
      </section>

      {/* Section 4: How it works (3 numbered steps) */}
      <section className="mx-auto w-full max-w-5xl px-5 pb-4 md:px-6">
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

      {/* Section 5: Social proof placeholder (honest, no fake reviews) */}
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

      {/* Section 6: Final CTA (repeat free-trial button + trial terms line) */}
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
