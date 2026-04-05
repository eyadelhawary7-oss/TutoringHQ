'use client';

import { useState, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Menu, X } from 'lucide-react';

const WA_SUPPORT = 'https://wa.me/201220601410';

export default function LocaleHomePage() {
  const t = useTranslations('landing');
  const m = useTranslations('landing.marketing');
  const locale = useLocale();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scanState, setScanState] = useState<'scanning' | 'success'>('scanning');

  useEffect(() => {
    const interval = setInterval(() => {
      setScanState('success');
      setTimeout(() => setScanState('scanning'), 1500);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const heroLines = t('heroTitle').split('\n');
  const featureKeys = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'] as const;

  return (
    <main className="min-h-screen bg-[#080D14] text-white">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-800/60 bg-[#080D14]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 md:h-16 md:px-6">
          <Link
            href="/"
            locale={locale}
            className="flex items-center gap-2 btn-press chq-focus rounded-lg"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-600 text-xs font-bold text-white">
              CH
            </span>
            <span className="text-lg font-bold tracking-tight">
              Center<span className="text-teal-400">HQ</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-8 md:flex" aria-label="Main">
            <a
              href="#features"
              className="text-sm text-slate-300 transition-colors hover:text-white btn-press chq-focus rounded-lg px-1 py-0.5"
            >
              {m('navFeatures')}
            </a>
            <a
              href="#pricing-preview"
              className="text-sm text-slate-300 transition-colors hover:text-white btn-press chq-focus rounded-lg px-1 py-0.5"
            >
              {m('navPricing')}
            </a>
            <a
              href={WA_SUPPORT}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-slate-300 transition-colors hover:text-white btn-press chq-focus rounded-lg px-1 py-0.5"
            >
              {m('navContact')}
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              locale={locale === 'ar' ? 'en' : 'ar'}
              className="hidden rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-400 hover:text-white md:inline-flex btn-press chq-focus"
            >
              {locale === 'ar' ? 'EN' : 'عر'}
            </Link>
            <Link
              href="/login"
              className="hidden text-sm text-slate-300 hover:text-white md:inline btn-press chq-focus rounded-lg px-2 py-1"
            >
              {m('login')}
            </Link>
            <Link
              href="/signup"
              className="hidden rounded-xl bg-teal-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-500 md:inline-flex btn-press chq-focus"
            >
              {t('navSignup')}
            </Link>
            <button
              type="button"
              className="inline-flex rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white md:hidden btn-press chq-focus"
              aria-expanded={mobileOpen}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMobileOpen((o) => !o)}
            >
              {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {mobileOpen ? (
          <div className="border-t border-slate-800/60 bg-[#080D14]/95 px-4 py-4 md:hidden">
            <div className="flex flex-col gap-1">
              <a
                href="#features"
                className="rounded-xl px-3 py-3 text-slate-200 btn-press chq-focus"
                onClick={() => setMobileOpen(false)}
              >
                {m('navFeatures')}
              </a>
              <a
                href="#pricing-preview"
                className="rounded-xl px-3 py-3 text-slate-200 btn-press chq-focus"
                onClick={() => setMobileOpen(false)}
              >
                {m('navPricing')}
              </a>
              <a
                href={WA_SUPPORT}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl px-3 py-3 text-slate-200 btn-press chq-focus"
                onClick={() => setMobileOpen(false)}
              >
                {m('navContact')}
              </a>
              <Link
                href="/login"
                className="rounded-xl px-3 py-3 text-slate-200 btn-press chq-focus"
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
        className="chq-fade-in px-4 pb-16 pt-24 md:px-6 md:pb-24 md:pt-28"
        style={{
          background:
            'radial-gradient(ellipse 80% 40% at 50% 0%, rgba(13, 148, 136, 0.08), transparent), #080D14',
        }}
      >
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 md:grid-cols-2 md:gap-16">
          <div className="text-center md:text-start">
            <span className="mb-6 inline-flex items-center rounded-full border border-teal-600/50 bg-teal-950/30 px-3 py-1 text-xs text-teal-400">
              {m('heroBadge')}
            </span>
            <h1 className="text-4xl font-bold leading-tight text-white md:text-5xl">
              {heroLines.map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
            </h1>
            <p className="mx-auto mt-6 max-w-md text-lg text-slate-400 md:mx-0">{t('heroSub')}</p>
            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center md:justify-start">
              <Link
                href="/signup"
                className="rounded-xl bg-teal-600 px-8 py-4 text-center text-lg font-semibold text-white transition-colors hover:bg-teal-500 btn-press chq-focus"
              >
                {t('heroCta')}
              </Link>
              <a
                href="#how-it-works"
                className="rounded-xl border border-slate-700 bg-slate-800 px-8 py-4 text-center text-lg font-semibold text-white transition-colors hover:bg-slate-700 btn-press chq-focus"
              >
                {t('watchDemo')}
              </a>
            </div>
          </div>

          <div className="flex justify-center md:justify-end">
            <div className="relative mx-auto h-[560px] w-[280px] shrink-0" aria-hidden dir="ltr">
              {/* Outer phone frame */}
              <div className="absolute inset-0 rounded-[48px] border border-slate-600 bg-slate-800 shadow-[0_0_60px_rgba(13,148,136,0.15)]" />

              {/* Inner screen */}
              <div className="absolute inset-[3px] flex flex-col overflow-hidden rounded-[46px] bg-slate-950">
                {/* Status bar */}
                <div className="flex items-center justify-between bg-slate-950 px-6 pb-2 pt-4">
                  <span className="text-[10px] font-semibold text-slate-400">9:41</span>
                  <div className="h-5 w-16 rounded-full bg-slate-900" />
                  <div className="flex items-center gap-1">
                    <div className="flex items-end gap-0.5">
                      <div className="h-1 w-0.5 rounded-full bg-slate-400" />
                      <div className="h-1.5 w-0.5 rounded-full bg-slate-400" />
                      <div className="h-2 w-0.5 rounded-full bg-slate-400" />
                      <div className="h-2.5 w-0.5 rounded-full bg-teal-400" />
                    </div>
                    <div className="ml-1 h-1.5 w-3 rounded-sm border border-slate-400">
                      <div className="h-full w-2/3 rounded-sm bg-teal-400" />
                    </div>
                  </div>
                </div>

                {/* App header */}
                <div className="flex items-center justify-center border-b border-slate-800 bg-slate-950 py-2">
                  <span className="text-xs font-bold tracking-wide text-white">CenterHQ</span>
                </div>

                {/* Scanner area */}
                <div className="relative flex flex-1 items-center justify-center bg-slate-950">
                  {/* QR code grid 7x7 */}
                  <div className="grid grid-cols-7 gap-[3px]">
                    {Array.from({ length: 49 }).map((_, i) => {
                      const teal = [
                        0, 1, 2, 3, 4, 5, 6, 7, 13, 14, 20, 21, 27, 28, 34, 35, 41, 42, 43, 44, 45, 46, 48, 8,
                        15, 22, 29, 36, 10, 17, 24, 31, 38,
                      ].includes(i);
                      return (
                        <div
                          key={i}
                          className="h-4 w-4 rounded-[3px]"
                          style={{ backgroundColor: teal ? '#0D9488' : '#1e293b' }}
                        />
                      );
                    })}
                  </div>

                  {/* Scanner corners — larger */}
                  <div className="pointer-events-none absolute inset-8">
                    <div className="absolute left-0 top-0 h-8 w-8 rounded-tl border-l-[3px] border-t-[3px] border-teal-400" />
                    <div className="absolute right-0 top-0 h-8 w-8 rounded-tr border-r-[3px] border-t-[3px] border-teal-400" />
                    <div className="absolute bottom-0 left-0 h-8 w-8 rounded-bl border-b-[3px] border-l-[3px] border-teal-400" />
                    <div className="absolute bottom-0 right-0 h-8 w-8 rounded-br border-b-[3px] border-r-[3px] border-teal-400" />
                  </div>

                  {/* Scan line */}
                  <div
                    className="absolute left-10 right-10 h-[2px] rounded-full bg-gradient-to-r from-transparent via-teal-400 to-transparent"
                    style={{
                      top: scanState === 'scanning' ? '25%' : '75%',
                      transition: 'top 2s ease-in-out',
                      boxShadow: '0 0 8px rgba(13,148,136,0.8)',
                    }}
                  />
                </div>

                {/* Success notification */}
                <div
                  className={`absolute bottom-16 left-3 right-3 rounded-2xl border border-teal-900 bg-slate-800 p-3 transition-all duration-500 ease-out ${
                    scanState === 'success'
                      ? 'translate-y-0 opacity-100'
                      : 'pointer-events-none translate-y-4 opacity-0'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-900">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#0D9488"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold leading-none text-white">Mohamed Ahmed</p>
                      <p className="mt-0.5 text-xs text-teal-400">تم تسجيل الحضور</p>
                    </div>
                    <div className="ml-auto text-xs text-slate-500">الآن</div>
                  </div>
                </div>

                {/* Bottom bar */}
                <div className="flex items-center justify-center gap-2 border-t border-slate-800 bg-slate-950 py-3">
                  <div className="h-2 w-2 rounded-full bg-teal-500" />
                  <div className="h-2 w-2 rounded-full bg-slate-700" />
                  <div className="h-2 w-2 rounded-full bg-slate-700" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="chq-fade-in border-y border-slate-800/40 bg-[#080D14] px-4 py-12 md:px-6">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
          {[
            { v: m('stat1Value'), l: m('stat1Label') },
            { v: m('stat2Value'), l: m('stat2Label') },
            { v: m('stat3Value'), l: m('stat3Label') },
          ].map((s, i) => (
            <div
              key={i}
              className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-6 text-center"
            >
              <p className="text-3xl font-bold text-teal-400">{s.v}</p>
              <p className="mt-1 text-sm text-slate-400">{s.l}</p>
            </div>
          ))}
        </div>
      </section>

      <section
        id="how-it-works"
        className="chq-fade-in scroll-mt-20 px-4 py-16 md:px-6 md:py-24"
      >
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-10 text-center text-2xl font-bold text-white md:mb-14 md:text-3xl">
            {m('howTitle')}
          </h2>
          <div className="flex flex-col items-center gap-10 md:flex-row md:items-start md:justify-center md:gap-0">
            {[
              { n: '١', title: m('step1Title'), desc: m('step1Desc') },
              { n: '٢', title: m('step2Title'), desc: m('step2Desc') },
              { n: '٣', title: m('step3Title'), desc: m('step3Desc') },
            ].flatMap((step, idx) => {
              const block = (
                <div
                  key={`step-${idx}`}
                  className="flex max-w-xs flex-col items-center text-center md:max-w-[220px] md:shrink-0"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-teal-600 text-lg font-bold text-white">
                    {step.n}
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-white">{step.title}</h3>
                  <p className="mt-1 text-sm text-slate-400">{step.desc}</p>
                </div>
              );
              if (idx < 2) {
                return [
                  block,
                  <div
                    key={`line-${idx}`}
                    className="hidden h-0 w-12 shrink-0 self-center border-t border-dashed border-teal-600/50 md:mx-4 md:mt-6 md:block md:w-16 lg:w-24"
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
        className="chq-fade-in scroll-mt-20 border-t border-slate-800/40 px-4 py-16 md:px-6 md:py-24"
      >
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-10 text-center text-2xl font-bold text-white md:mb-14 md:text-3xl">
            {t('featuresTitle')}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
            {featureKeys.map((k) => (
              <div
                key={k}
                className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-5"
              >
                <div className="h-10 w-10 rounded-lg bg-teal-600/25 ring-1 ring-teal-600/30" aria-hidden />
                <h3 className="mt-3 text-base font-semibold text-white">
                  {m(`${k}Title` as 'f1Title')}
                </h3>
                <p className="mt-1 text-sm text-slate-400">{m(`${k}Desc` as 'f1Desc')}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="pricing-preview"
        className="chq-fade-in scroll-mt-20 px-4 py-16 md:px-6 md:py-24"
      >
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="text-2xl font-bold text-white md:text-3xl">{t('pricingTitle')}</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-slate-400 md:text-base">
            {m('pricingSubtitle')}
          </p>
          <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
            <div className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-6 text-start">
              <span className="inline-block rounded-full border border-slate-600 bg-slate-900/50 px-2 py-0.5 text-xs text-slate-400">
                {m('nanoBadge')}
              </span>
              <p className="mt-3 text-lg font-semibold text-white">{m('nanoName')}</p>
              <p className="mt-2 text-2xl font-bold text-teal-400">{m('nanoPrice')}</p>
              <p className="text-xs text-slate-500">{m('nanoPeriod')}</p>
              <p className="mt-3 text-sm text-slate-400">{m('nanoStudents')}</p>
            </div>
            <div className="rounded-2xl border border-teal-600/60 bg-slate-800/40 p-6 text-start ring-1 ring-teal-600/30">
              <span className="inline-block rounded-full border border-teal-600/50 bg-teal-950/40 px-2 py-0.5 text-xs text-teal-400">
                {m('popularBadge')}
              </span>
              <p className="mt-3 text-lg font-semibold text-white">{m('starterName')}</p>
              <p className="mt-2 text-2xl font-bold text-teal-400">{m('starterPrice')}</p>
              <p className="mt-3 text-sm text-slate-400">{m('starterStudents')}</p>
            </div>
            <div className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-6 text-start">
              <p className="mt-3 text-lg font-semibold text-white">{m('proName')}</p>
              <p className="mt-2 text-2xl font-bold text-teal-400">{m('proPrice')}</p>
              <p className="mt-3 text-sm text-slate-400">{m('proStudents')}</p>
            </div>
          </div>
          <Link
            href="/signup"
            className="mt-10 inline-flex rounded-xl bg-slate-700 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-600 btn-press chq-focus"
          >
            {m('pricingCta')}
          </Link>
        </div>
      </section>

      <section className="chq-fade-in bg-gradient-to-b from-transparent to-teal-900/20 px-4 py-16 md:px-6 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold text-white md:text-3xl">{t('finalCtaTitle')}</h2>
          <p className="mt-3 text-sm text-slate-400 md:text-base">{t('finalCtaDesc')}</p>
          <Link
            href="/signup"
            className="mt-8 inline-flex rounded-xl bg-teal-600 px-8 py-4 text-lg font-semibold text-white transition-colors hover:bg-teal-500 btn-press chq-focus"
          >
            {m('finalCtaButton')}
          </Link>
        </div>
      </section>

      <footer className="chq-fade-in border-t border-slate-800/60 px-4 py-10 md:px-6">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-4 text-center text-sm text-slate-400">
          <p className="text-slate-300">{m('footerTagline')}</p>
          <p className="text-xs text-slate-500">{m('footerEhgi')}</p>
          <a
            href={WA_SUPPORT}
            target="_blank"
            rel="noopener noreferrer"
            className="text-teal-400 transition-colors hover:text-teal-300 btn-press chq-focus rounded-lg px-2 py-1"
          >
            {m('footerSupportLabel')}: +20 122 060 1410
          </a>
          <p className="text-xs text-slate-600">{m('footerRights')}</p>
        </div>
      </footer>
    </main>
  );
}
