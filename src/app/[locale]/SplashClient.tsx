'use client';

import { useCallback, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Building2,
  GraduationCap,
  ScanLine,
  Receipt,
  Wallet,
  ShieldCheck,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import { Link } from '@/i18n/routing';
import { formatNumber, formatPercent } from '@/lib/formatNumber';
import { SITE } from '@/config/site';
import SummerRibbon from '@/components/summer/SummerRibbon';
import SummerPopup from '@/components/summer/SummerPopup';
import StartFreeChooser from '@/components/landing/StartFreeChooser';

const FRAUNCES = 'var(--font-fraunces), Georgia, serif';

/**
 * Neutral front-door splash — the combined landing page for everyone who teaches
 * in Egypt. Persona-neutral promise, a sample dashboard preview, three feature
 * tiles, two co-equal persona cards (center = teal, teacher = brass), a how-it-
 * works sequence, an accessible FAQ, a trust strip, and the footer. Every
 * "Start free" trigger (hero, footer, summer ribbon) opens the same center/
 * teacher chooser. Public brand is TutoringHQ only.
 */
export default function SplashClient() {
  const t = useTranslations('splash');
  const locale = useLocale();
  const isAr = locale === 'ar';
  // Logical "forward" arrow: in RTL the journey points left, in LTR right.
  const Arrow = isAr ? ArrowLeft : ArrowRight;

  const [chooserOpen, setChooserOpen] = useState(false);
  const openChooser = useCallback(() => setChooserOpen(true), []);
  const closeChooser = useCallback(() => setChooserOpen(false), []);

  const howItWorksRef = useRef<HTMLElement>(null);
  const scrollToHowItWorks = useCallback(() => {
    howItWorksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Sample dashboard figures — hardcoded display-only data. No DB, no real tenant.
  const attended = 249;
  const expected = 310;
  const ratio = attended / expected; // ~0.80
  const recentScans = t.raw('preview.rows') as Array<{ name: string; group: string; time: string }>;
  const faqItems = t.raw('faq.items') as Array<{ q: string; a: string }>;
  const steps = t.raw('how.steps') as Array<{ title: string; body: string }>;
  const supportTel = `+${SITE.supportWhatsAppIntl}`;

  return (
    <main
      dir={isAr ? 'rtl' : 'ltr'}
      className="relative flex min-h-screen w-full flex-col bg-[var(--color-surface-0)] text-[var(--color-text-primary)]"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 70% 40% at 50% 0%, rgba(14,107,97,0.06), transparent 70%)',
      }}
    >
      <SummerRibbon locale={locale} portal="combined" ctaHref="/signup" onCtaClick={openChooser} />
      <SummerPopup locale={locale} portal="combined" ctaHref="/signup" onCtaClick={openChooser} />

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
      <section className="mx-auto flex w-full max-w-5xl flex-col items-center px-5 pb-4 pt-8 text-center md:px-6 md:pt-16">
        <h1 className="max-w-2xl text-3xl font-bold leading-tight text-[var(--color-text-primary)] md:text-5xl">
          {t('headline')}
        </h1>
        <p className="mt-5 max-w-xl text-base text-[var(--color-text-secondary)] md:text-lg">
          {t('context')}
        </p>

        {/* Hero CTAs — Start free opens the chooser, See how scrolls to the steps */}
        <div className="mt-8 flex w-full max-w-xs flex-col gap-3">
          <button
            type="button"
            onClick={openChooser}
            className="inline-flex items-center justify-center rounded-xl px-7 py-3 text-sm font-bold text-white shadow-[var(--shadow-row)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-teal)] focus-visible:ring-offset-2"
            style={{ backgroundColor: 'var(--color-teal)' }}
          >
            {t('hero.startFree')}
          </button>
          <button
            type="button"
            onClick={scrollToHowItWorks}
            className="inline-flex items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] px-7 py-3 text-sm font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-teal)] focus-visible:ring-offset-2"
          >
            {t('hero.seeHow')}
          </button>
        </div>
      </section>

      {/* Dashboard preview — static, sample-only visual (no DB, no real data) */}
      <section className="mx-auto w-full max-w-3xl px-5 pb-6 pt-6 md:px-6">
        <div
          className="mx-auto w-full max-w-2xl rounded-[var(--radius-card)] p-5 shadow-[var(--shadow-card)] md:p-7"
          style={{ backgroundColor: '#0e1c18', color: '#e9f1ee' }}
          aria-label={t('preview.regionLabel')}
        >
          <div className="text-start">
            <p className="text-xs" style={{ color: 'rgba(233,241,238,0.6)' }}>{t('preview.greeting')}</p>
            <p className="text-lg font-bold" style={{ fontFamily: FRAUNCES }}>{t('preview.name')}</p>
          </div>

          <div className="mt-5 rounded-xl p-4 text-start" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
            <div className="flex items-end justify-between gap-3">
              <span className="text-xs" style={{ color: 'rgba(233,241,238,0.7)' }}>{t('preview.statLabel')}</span>
              <span className="text-sm font-semibold" dir="ltr">
                {formatNumber(attended, locale)} / {formatNumber(expected, locale)}
                <span className="ms-1 text-xs font-normal" style={{ color: 'rgba(233,241,238,0.6)' }}>
                  {t('preview.expected')}
                </span>
              </span>
            </div>
            <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}>
              <div
                className="h-full rounded-full"
                style={{ inlineSize: `${Math.round(ratio * 100)}%`, backgroundColor: 'var(--color-teal)' }}
              />
            </div>
            <p className="mt-1.5 text-xs" style={{ color: 'rgba(233,241,238,0.6)' }}>
              {formatPercent(Math.round(ratio * 100), locale, { maximumFractionDigits: 0 })}
            </p>
          </div>

          <ul className="mt-4 flex flex-col gap-2">
            {recentScans.map((row, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-start"
                style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{row.name}</span>
                  <span className="block truncate text-xs" style={{ color: 'rgba(233,241,238,0.55)' }}>{row.group}</span>
                </span>
                <span className="text-xs" style={{ color: 'rgba(233,241,238,0.55)' }}>{row.time}</span>
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={{ backgroundColor: 'rgba(13,148,136,0.22)', color: '#7fe0d2' }}
                >
                  {t('preview.in')}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-3 text-center text-sm text-[var(--color-text-secondary)]">{t('preview.caption')}</p>
      </section>

      {/* What TutoringHQ does — three feature tiles */}
      <section className="mx-auto w-full max-w-5xl px-5 pb-4 md:px-6">
        <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-4 text-start sm:grid-cols-3">
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
      </section>

      {/* Two co-equal persona cards */}
      <section className="mx-auto w-full max-w-5xl px-5 pb-4 pt-6 md:px-6">
        <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-5 md:grid-cols-2">
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
      </section>

      {/* How it works — three steps */}
      <section ref={howItWorksRef} className="mx-auto w-full max-w-5xl scroll-mt-6 px-5 py-12 md:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-brass)' }}>
            {t('how.eyebrow')}
          </p>
          <h2 className="mt-2 text-2xl font-bold text-[var(--color-text-primary)] md:text-3xl" style={{ fontFamily: FRAUNCES }}>
            {t('how.header')}
          </h2>
        </div>
        <ol className="mx-auto mt-8 grid max-w-3xl grid-cols-1 gap-5 md:grid-cols-3">
          {steps.map((step, i) => (
            <li
              key={i}
              className="flex flex-col rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5 text-start shadow-[var(--shadow-row)]"
            >
              <span
                className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: 'var(--color-teal)' }}
                aria-hidden
              >
                {formatNumber(i + 1, locale)}
              </span>
              <h3 className="text-sm font-bold text-[var(--color-text-primary)]">{step.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-text-secondary)]">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* FAQ — accessible native accordion */}
      <section className="mx-auto w-full max-w-5xl px-5 py-8 md:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-brass)' }}>
            {t('faq.eyebrow')}
          </p>
          <h2 className="mt-2 text-2xl font-bold text-[var(--color-text-primary)] md:text-3xl" style={{ fontFamily: FRAUNCES }}>
            {t('faq.header')}
          </h2>
        </div>
        <div className="mx-auto mt-7 flex max-w-2xl flex-col gap-3">
          {faqItems.map((item, i) => (
            <details
              key={i}
              className="group rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] shadow-[var(--shadow-row)] [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-start text-sm font-semibold text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-teal)]">
                <span>{item.q}</span>
                <span
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-[var(--color-text-secondary)] transition-transform group-open:rotate-45"
                  aria-hidden
                >
                  +
                </span>
              </summary>
              <p className="px-5 pb-4 text-start text-sm leading-relaxed text-[var(--color-text-secondary)]">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      {/* Trust strip */}
      <section className="mt-4 w-full px-5 py-10 md:px-6" style={{ backgroundColor: 'var(--color-teal-deep)' }}>
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-2 text-center text-white">
          <ShieldCheck size={28} aria-hidden style={{ color: 'rgba(255,255,255,0.85)' }} />
          <p className="text-lg font-bold" style={{ fontFamily: FRAUNCES }}>{t('trust.title')}</p>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.78)' }}>{t('trust.sub')}</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="mx-auto w-full max-w-5xl px-5 py-10 md:px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <button
            type="button"
            onClick={openChooser}
            className="inline-flex items-center justify-center rounded-xl px-7 py-3 text-sm font-bold text-white shadow-[var(--shadow-row)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-teal)] focus-visible:ring-offset-2"
            style={{ backgroundColor: 'var(--color-teal)' }}
          >
            {t('hero.startFree')}
          </button>
        </div>
        <div className="mt-8 flex flex-col items-center gap-3 border-t border-[var(--color-border)] pt-6 text-center text-xs text-[var(--color-text-muted)]">
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
          <p>
            {t('contact')}{' '}
            <a href={`tel:${supportTel}`} dir="ltr" className="font-semibold text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]">
              {SITE.supportWhatsAppDisplay}
            </a>
          </p>
          <p>{t('rights')}</p>
        </div>
      </footer>

      <StartFreeChooser open={chooserOpen} onClose={closeChooser} />
    </main>
  );
}
