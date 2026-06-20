'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Building2, GraduationCap, ScanLine, Receipt, Wallet, ArrowLeft, ArrowRight } from 'lucide-react';
import { Link } from '@/i18n/routing';

/**
 * Neutral front-door splash. Persona-neutral promise, then two co-equal cards
 * (center = teal, teacher = brass) and one role-routed login. Cream throughout
 * (no dark surfaces) - the dark theme is the user-toggle option only. This is a
 * real rendered page, not a redirect: it is the new root at /{locale}.
 */
export default function SplashClient() {
  const t = useTranslations('splash');
  const locale = useLocale();
  const isAr = locale === 'ar';
  // Logical "forward" arrow: in RTL the journey points left, in LTR right.
  const Arrow = isAr ? ArrowLeft : ArrowRight;

  return (
    <main
      dir={isAr ? 'rtl' : 'ltr'}
      className="relative flex min-h-screen w-full flex-col bg-[var(--color-surface-0)] text-[var(--color-text-primary)]"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 70% 40% at 50% 0%, rgba(14,107,97,0.06), transparent 70%)',
      }}
    >
      {/* Top bar: wordmark + locale toggle */}
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5 md:px-6">
        <span className="text-lg tracking-tight" style={{ fontFamily: 'var(--font-bodoni)', fontWeight: 700, letterSpacing: '2px' }}>
          <span style={{ color: 'var(--color-text-primary)' }}>Tutoring</span>
          <span style={{ color: 'var(--color-teal)' }}>HQ</span>
        </span>
        <Link
          href="/"
          locale={isAr ? 'en' : 'ar'}
          aria-label={t('switchLocaleAria')}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
        >
          <span dir="ltr">{isAr ? 'EN' : 'AR'}</span>
        </Link>
      </header>

      {/* Hero */}
      <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center px-5 pb-10 pt-8 text-center md:px-6 md:pt-16">
        <span
          className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-bold text-white"
          style={{ background: 'var(--color-teal)', fontFamily: 'var(--font-bodoni)', letterSpacing: '1px' }}
          aria-hidden
        >
          CH
        </span>
        <h1 className="max-w-2xl text-3xl font-bold leading-tight text-[var(--color-text-primary)] md:text-5xl">
          {t('headline')}
        </h1>
        <p className="mt-5 max-w-xl text-base text-[var(--color-text-secondary)] md:text-lg">
          {t('context')}
        </p>

        {/* What CenterHQ does - three concise tiles, so both personas understand
            the platform before choosing a path. Teal for shared/center, brass for
            the billing/private accent. */}
        <div className="mt-10 grid w-full max-w-3xl grid-cols-1 gap-4 text-start sm:grid-cols-3">
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5 shadow-[var(--shadow-row)]">
            <span
              className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: 'var(--color-teal-soft)', color: 'var(--color-teal-deep)' }}
              aria-hidden
            >
              <ScanLine size={20} />
            </span>
            <h3 className="text-sm font-bold text-[var(--color-text-primary)]">{t('does.attendance.title')}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-text-secondary)]">{t('does.attendance.body')}</p>
          </div>
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5 shadow-[var(--shadow-row)]">
            <span
              className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: 'var(--color-brass-soft)', color: 'var(--color-brass)' }}
              aria-hidden
            >
              <Receipt size={20} />
            </span>
            <h3 className="text-sm font-bold text-[var(--color-text-primary)]">{t('does.billing.title')}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-text-secondary)]">{t('does.billing.body')}</p>
          </div>
          <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5 shadow-[var(--shadow-row)]">
            <span
              className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: 'var(--color-teal-soft)', color: 'var(--color-teal-deep)' }}
              aria-hidden
            >
              <Wallet size={20} />
            </span>
            <h3 className="text-sm font-bold text-[var(--color-text-primary)]">{t('does.income.title')}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-text-secondary)]">{t('does.income.body')}</p>
          </div>
        </div>

        {/* Two co-equal persona cards */}
        <div className="mt-10 grid w-full max-w-3xl grid-cols-1 gap-5 md:mt-12 md:grid-cols-2">
          <Link
            href="/center"
            className="group flex flex-col rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-start shadow-[var(--shadow-card)] transition-transform hover:-translate-y-0.5"
            style={{ borderTopColor: 'var(--color-teal)', borderTopWidth: '3px' }}
          >
            <span
              className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ background: 'var(--color-teal-soft)', color: 'var(--color-teal-deep)' }}
              aria-hidden
            >
              <Building2 size={22} />
            </span>
            <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('center.title')}</h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              {t('center.brief')}
            </p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--color-teal-deep)' }}>
              {t('center.cta')}
              <Arrow size={16} className="transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" aria-hidden />
            </span>
          </Link>

          <Link
            href="/teacher/landing"
            className="group flex flex-col rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-start shadow-[var(--shadow-card)] transition-transform hover:-translate-y-0.5"
            style={{ borderTopColor: 'var(--color-brass)', borderTopWidth: '3px' }}
          >
            <span
              className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ background: 'var(--color-brass-soft)', color: 'var(--color-brass)' }}
              aria-hidden
            >
              <GraduationCap size={22} />
            </span>
            <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('teacher.title')}</h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              {t('teacher.brief')}
            </p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--color-brass)' }}>
              {t('teacher.cta')}
              <Arrow size={16} className="transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" aria-hidden />
            </span>
          </Link>
        </div>

        {/* One role-routed login */}
        <div className="mt-10 flex flex-col items-center gap-2">
          <Link
            href="/login"
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] px-8 py-3 text-sm font-semibold text-[var(--color-text-primary)] shadow-[var(--shadow-row)] transition-colors hover:bg-[var(--color-surface-2)]"
          >
            {t('login')}
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="mx-auto w-full max-w-5xl px-5 py-8 md:px-6">
        <div className="flex flex-col items-center gap-3 border-t border-[var(--color-border)] pt-6 text-center text-xs text-[var(--color-text-muted)]">
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2" aria-label={t('footerNavAria')}>
            <Link href="/legal/privacy" className="transition-colors hover:text-[var(--color-text-primary)]">
              {t('privacy')}
            </Link>
            <Link href="/legal/terms" className="transition-colors hover:text-[var(--color-text-primary)]">
              {t('terms')}
            </Link>
            <Link href="/legal/cookie" className="transition-colors hover:text-[var(--color-text-primary)]">
              {t('cookies')}
            </Link>
          </nav>
          <p>{t('rights')}</p>
        </div>
      </footer>
    </main>
  );
}
