'use client';

import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/formatNumber';
import { PLANS, ORDERED_SUBSCRIPTION_PLAN_KEYS } from '@/lib/pricing';
import { Menu, X } from 'lucide-react';

const WA_SUPPORT = 'https://wa.me/201220601410';

type DemoScreen = 'scanning' | 'scanned' | 'dashboard' | 'whatsapp' | 'payment';

const SCREEN_SEQUENCE: DemoScreen[] = ['scanning', 'scanned', 'dashboard', 'whatsapp', 'payment'];

const ScannerScreen = ({ demoScreen }: { demoScreen: DemoScreen }) => (
  <div
    className="absolute inset-0 flex items-center justify-center bg-[#080c14]"
    style={{ background: 'radial-gradient(ellipse at center, #0d1520 0%, #050810 100%)' }}
  >
    {/* Student ID Card */}
    <div
      className="relative h-[108px] w-[180px]"
      style={{
        transform: demoScreen === 'scanned' ? 'rotate(0deg) scale(1.05)' : 'rotate(-3deg) scale(0.97)',
        transition: 'transform 0.7s ease-out',
      }}
    >
      <div className="h-full w-full overflow-hidden rounded-xl border border-slate-600 bg-gradient-to-br from-slate-700 to-slate-800 shadow-2xl">
        <div className="flex h-7 items-center gap-2 bg-teal-700 px-3">
          <span
            className="text-[8px] tracking-widest text-white"
            style={{ fontFamily: 'var(--font-bodoni)', fontWeight: 700, letterSpacing: '2px' }}
          >
            <span className="text-white">CENTER</span>
            <span className="text-teal-600">HQ</span>
          </span>
          <span className="ms-auto text-[7px] text-teal-200">طالب</span>
        </div>
        <div className="flex gap-2 p-2">
          <div className="flex h-14 w-12 shrink-0 items-center justify-center rounded-md border border-slate-500 bg-slate-600">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.5" aria-hidden>
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <div className="flex flex-col justify-center gap-1">
            <div className="text-[9px] font-bold text-white">Mohamed Ahmed</div>
            <div className="text-[8px] text-slate-400">#001-0042</div>
            <div className="mt-0.5 text-[7px] text-teal-400">IB Year 1</div>
            <div className="mt-1 flex gap-[2px]">
              {Array.from({ length: 18 }).map((_, i) => (
                <div key={i} className="h-3 rounded-full bg-slate-500" style={{ width: i % 3 === 0 ? '2px' : '1px' }} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {demoScreen === 'scanned' ? (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-500 shadow-[0_0_30px_rgba(13,148,136,0.8)]">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>
      ) : null}
    </div>

    <div className="pointer-events-none absolute inset-6">
      <div className="absolute left-0 top-0 h-8 w-8 rounded-tl-sm border-l-[3px] border-t-[3px] border-teal-400" />
      <div className="absolute right-0 top-0 h-8 w-8 rounded-tr-sm border-r-[3px] border-t-[3px] border-teal-400" />
      <div className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-sm border-b-[3px] border-l-[3px] border-teal-400" />
      <div className="absolute bottom-0 right-0 h-8 w-8 rounded-br-sm border-b-[3px] border-r-[3px] border-teal-400" />
    </div>

    {demoScreen === 'scanning' ? (
      <div className="pointer-events-none absolute inset-6 overflow-hidden [container-type:size]">
        <div
          className="chq-landing-scanline-bar absolute left-8 right-8 top-0 h-[2px] rounded-full"
          style={{
            background: 'linear-gradient(90deg,transparent,#0D9488,transparent)',
            boxShadow: '0 0 12px 2px rgba(13,148,136,0.6)',
          }}
        />
      </div>
    ) : null}
  </div>
);

const DashboardScreen = ({ locale }: { locale: string }) => (
  <div className="absolute inset-0 flex flex-col gap-2 overflow-hidden bg-[var(--color-surface-0)] p-3">
    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">لوحة التحكم</div>
    <div className="grid grid-cols-2 gap-1.5">
      <div className="rounded-lg bg-slate-800 p-2">
        <div className="text-[8px] text-slate-500">الطلاب</div>
        <div className="text-sm font-bold text-white">{formatNumber(247, locale)}</div>
        <div className="text-[8px] text-teal-400">
          ↑ {formatNumber(12, locale)} هذا الشهر
        </div>
      </div>
      <div className="rounded-lg bg-slate-800 p-2">
        <div className="text-[8px] text-slate-500">الإيرادات</div>
        <div className="text-sm font-bold text-white leading-tight">{formatCurrency(21000, locale)}</div>
        <div className="text-[8px] text-teal-400">{locale === 'ar' ? 'شهرياً' : '/mo'}</div>
      </div>
    </div>
    <div className="rounded-lg bg-slate-800 p-2">
      <div className="mb-1 flex justify-between">
        <span className="text-[8px] text-slate-500">حضور اليوم</span>
        <span className="text-[8px] text-teal-400">{formatPercent(87, locale)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-700">
        <div className="h-full w-[87%] rounded-full bg-teal-500" />
      </div>
    </div>
    <div className="flex flex-1 flex-col rounded-lg bg-slate-800 p-2">
      <div className="mb-1.5 text-[8px] text-slate-500">آخر المسحات</div>
      {['Ahmed K.', 'Sara M.', 'Omar H.'].map((name, i) => (
        <div key={name} className="mb-1 flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-teal-500" />
          <span className="text-[8px] text-slate-300">{name}</span>
          <span className="ml-auto text-[7px] text-slate-600">الآن</span>
        </div>
      ))}
    </div>
  </div>
);

const WhatsAppScreen = () => (
  <div className="absolute inset-0 flex flex-col gap-2 overflow-hidden bg-[#0a1628] p-3">
    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">واتساب</div>
    <div className="flex items-center gap-2 rounded-lg bg-[#128C7E] p-2">
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="white" aria-hidden>
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
        </svg>
      </div>
      <div>
        <div
          className="text-[9px] text-white"
          style={{ fontFamily: 'var(--font-bodoni)', fontWeight: 700, letterSpacing: '2px' }}
        >
          <span className="text-white">CENTER</span>
          <span className="text-teal-600">HQ</span>
        </div>
        <div className="text-[7px] text-green-200">متصل الآن</div>
      </div>
    </div>
    <div className="flex flex-1 flex-col gap-1.5">
      <div className="max-w-[85%] rounded-lg rounded-tl-sm bg-white/10 p-2">
        <div className="text-[8px] leading-relaxed text-white">تنبيه غياب: محمد أحمد لم يحضر جلسة اليوم</div>
        <div className="mt-0.5 text-[7px] text-white/50">10:30</div>
      </div>
      <div className="max-w-[85%] rounded-lg rounded-tl-sm bg-white/10 p-2">
        <div className="text-[8px] leading-relaxed text-white">تذكير: الاشتراك الشهري مستحق يوم الجمعة</div>
        <div className="mt-0.5 text-[7px] text-white/50">10:31</div>
      </div>
      <div className="max-w-[85%] self-end rounded-lg rounded-tr-sm bg-teal-600 p-2">
        <div className="text-[8px] text-white">شكراً، سيتم الدفع غداً</div>
        <div className="mt-0.5 text-right text-[7px] text-white/70">10:35 ✓✓</div>
      </div>
    </div>
  </div>
);

const PaymentScreen = ({ locale }: { locale: string }) => (
  <div className="absolute inset-0 flex flex-col gap-2 overflow-hidden bg-[var(--color-surface-0)] p-3">
    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">المدفوعات</div>
    <div className="flex items-center gap-3 rounded-xl border border-teal-700/50 bg-teal-900/40 p-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-teal-500 bg-teal-500/20">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0D9488" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div>
        <div className="text-[9px] font-bold text-teal-300">تم استلام الدفعة</div>
        <div className="text-xs font-bold text-white">{formatCurrency(1500, locale)}</div>
        <div className="text-[8px] text-slate-500">سنتر النخبة للغات</div>
      </div>
    </div>
    <div className="flex flex-1 flex-col rounded-xl bg-slate-800 p-2">
      <div className="mb-2 text-[8px] text-slate-500">آخر المدفوعات</div>
      {[
        { name: 'Ahmed K.', amount: 500, status: 'paid' as const },
        { name: 'Sara M.', amount: 500, status: 'paid' as const },
        { name: 'Omar H.', amount: 500, status: 'pending' as const },
      ].map((p, i) => (
        <div key={`${p.name}-${i}`} className="mb-1.5 flex items-center gap-2">
          <div className={`h-1.5 w-1.5 rounded-full ${p.status === 'paid' ? 'bg-teal-500' : 'bg-amber-500'}`} />
          <span className="flex-1 text-[8px] text-slate-300">{p.name}</span>
          <span className="text-[8px] font-semibold text-white">{formatCurrency(p.amount, locale)}</span>
        </div>
      ))}
    </div>
    <div className="flex items-center justify-between rounded-lg bg-slate-800 p-2">
      <span className="text-[8px] text-slate-500">إجمالي الشهر</span>
      <span className="text-xs font-bold text-teal-400">{formatCurrency(21000, locale)}</span>
    </div>
  </div>
);

export default function LocaleHomePage() {
  const t = useTranslations('landing');
  const m = useTranslations('landing.marketing');
  const footerT = useTranslations('footer');
  const locale = useLocale();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [demoScreen, setDemoScreen] = useState<DemoScreen>('scanning');
  const [isVisible, setIsVisible] = useState(false);
  const phoneDemoRef = useRef<HTMLDivElement | null>(null);

  // Observe after layout so ref is always attached; avoid setState churn while intersecting.
  useLayoutEffect(() => {
    const el = phoneDemoRef.current;
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }
    if (!el) return;

    const observer = new IntersectionObserver(([entry]) => {
      const next = entry?.isIntersecting ?? false;
      setIsVisible((prev) => (prev === next ? prev : next));
    }, { threshold: 0.1 });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Per-screen delays; single timeout with cleanup - no timers while off-screen.
  useEffect(() => {
    if (!isVisible) return;

    const timings: Record<DemoScreen, number> = {
      scanning: 2500,
      scanned: 1800,
      dashboard: 3000,
      whatsapp: 3000,
      payment: 3000,
    };

    const timerId = window.setTimeout(() => {
      setDemoScreen((current) => {
        const idx = SCREEN_SEQUENCE.indexOf(current);
        const next = (idx + 1) % SCREEN_SEQUENCE.length;
        return SCREEN_SEQUENCE[next];
      });
    }, timings[demoScreen]);

    return () => window.clearTimeout(timerId);
  }, [demoScreen, isVisible]);

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
      <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-800/60 bg-[#080f1a]/90 backdrop-blur-md">
        <div className="relative mx-auto flex h-14 max-w-6xl items-center px-4 md:h-16 md:px-6">
          <button
            type="button"
            className="absolute start-4 top-1/2 z-10 inline-flex -translate-y-1/2 rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white md:hidden btn-press chq-focus [&_svg]:text-slate-300"
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
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

            <div className="hidden items-center gap-2 md:flex">
              <Link
                href="/"
                locale={locale === 'ar' ? 'en' : 'ar'}
                className="inline-flex rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-300 hover:text-white btn-press chq-focus"
              >
                {locale === 'ar' ? 'EN' : 'عر'}
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
              <a
                href="#pricing-preview"
                className="rounded-xl px-3 py-3 text-slate-300 btn-press chq-focus"
                onClick={() => setMobileOpen(false)}
              >
                {m('navPricing')}
              </a>
              <a
                href={WA_SUPPORT}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl px-3 py-3 text-slate-300 btn-press chq-focus"
                onClick={() => setMobileOpen(false)}
              >
                {m('navContact')}
              </a>
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
            <div
              ref={phoneDemoRef}
              className="relative mx-auto h-[560px] w-[280px] shrink-0 [contain:layout_paint]"
              style={{ willChange: 'transform', transform: 'translateZ(0)' }}
              aria-hidden
              dir="ltr"
            >
              {/* Outer phone frame */}
              <div className="absolute inset-0 rounded-[48px] border border-slate-600 bg-slate-800 shadow-[0_0_80px_rgba(13,148,136,0.2)]" />

              {/* Inner screen */}
              <div className="absolute inset-[3px] flex flex-col overflow-hidden rounded-[46px] bg-[#0a0f1a]">
                {/* Status bar */}
                <div className="flex items-center justify-between px-6 pb-2 pt-4">
                  <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">9:41</span>
                  <div className="h-5 w-16 rounded-full bg-[var(--color-surface-3)]" />
                  <div className="flex items-center gap-1.5">
                    <div className="flex h-3 items-end gap-[2px]">
                      <div className="h-1 w-[3px] rounded-full bg-slate-500" />
                      <div className="h-1.5 w-[3px] rounded-full bg-slate-500" />
                      <div className="h-2 w-[3px] rounded-full bg-slate-400" />
                      <div className="h-3 w-[3px] rounded-full bg-teal-400" />
                    </div>
                    <div className="relative h-2.5 w-5 rounded-[3px] border border-slate-400">
                      <div className="absolute inset-[2px] left-[2px] right-[4px] rounded-[1px] bg-teal-400" />
                      <div className="absolute -right-[3px] top-1/2 h-[6px] w-[3px] -translate-y-1/2 rounded-r-full bg-slate-500" />
                    </div>
                  </div>
                </div>

                {/* App header */}
                <div className="flex items-center justify-center border-b border-slate-800 py-2">
                  <span
                    className="text-xs uppercase tracking-widest"
                    style={{ fontFamily: 'var(--font-bodoni)', fontWeight: 700, letterSpacing: '2px' }}
                  >
                    <span className="text-white">CENTER</span>
                    <span className="text-teal-600">HQ</span>
                  </span>
                </div>

                {/* Multi-screen demo - pause CSS animations when mockup is off-screen */}
                <div
                  className={
                    isVisible
                      ? 'relative min-h-0 flex-1 overflow-hidden bg-[#080c14]'
                      : 'relative min-h-0 flex-1 overflow-hidden bg-[#080c14] [&_.animate-pulse]:![animation-play-state:paused] [&_.chq-landing-scanline-bar]:![animation-play-state:paused]'
                  }
                  style={{ willChange: 'transform', transform: 'translateZ(0)' }}
                >
                  {(demoScreen === 'scanning' || demoScreen === 'scanned') && <ScannerScreen demoScreen={demoScreen} />}
                  {demoScreen === 'dashboard' ? <DashboardScreen locale={locale} /> : null}
                  {demoScreen === 'whatsapp' ? <WhatsAppScreen /> : null}
                  {demoScreen === 'payment' ? <PaymentScreen locale={locale} /> : null}
                </div>

                {demoScreen === 'scanned' ? (
                  <div className="mx-3 mb-2 rounded-2xl border border-teal-900 bg-slate-800/90 p-3 transition-[opacity,transform] duration-500">
                    <div className="flex items-center gap-3" dir="ltr">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-teal-700 bg-teal-900/60">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0D9488" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-white">Mohamed Ahmed</p>
                        <p className="text-[10px] text-teal-400">تم تسجيل الحضور</p>
                      </div>
                      <span className="text-[10px] text-[var(--color-text-muted)]">الآن</span>
                    </div>
                  </div>
                ) : null}
                {demoScreen === 'dashboard' ? (
                  <div className="mx-3 mb-2 rounded-2xl border border-slate-700 bg-slate-800/90 p-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 animate-pulse rounded-full bg-teal-500" />
                      <p className="text-[10px] text-[var(--color-text-secondary)]">
                        {formatNumber(247, locale)} طالب نشط اليوم
                      </p>
                    </div>
                  </div>
                ) : null}
                {demoScreen === 'whatsapp' ? (
                  <div className="mx-3 mb-2 rounded-2xl border border-[#128C7E]/40 bg-[#128C7E]/20 p-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
                      <p className="text-[10px] text-green-300">
                        تم إرسال {formatNumber(12, locale)} رسالة واتساب
                      </p>
                    </div>
                  </div>
                ) : null}
                {demoScreen === 'payment' ? (
                  <div className="mx-3 mb-2 rounded-2xl border border-teal-800/50 bg-teal-900/30 p-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-teal-400" />
                      <p className="text-[10px] text-teal-300">
                        تم تحصيل {formatCurrency(21000, locale)} هذا الشهر
                      </p>
                    </div>
                  </div>
                ) : null}

                {/* Bottom bar */}
                <div className="flex items-center justify-center gap-2 border-t border-slate-800 bg-[#0a0f1a] py-3">
                  <div className="h-2 w-2 rounded-full bg-teal-500" />
                  <div className="h-2 w-2 rounded-full bg-slate-700" />
                  <div className="h-2 w-2 rounded-full bg-slate-700" />
                </div>
              </div>
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
              const nameKey = `${planKey}Name` as 'marketing.soloName';
              const studentsKey = `${planKey}Students` as 'marketing.soloStudents';
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
                  <p className="mt-3 text-base font-bold !text-white">{m(nameKey)}</p>
                  <p className="mt-2 text-2xl font-bold !text-white">{priceLine}</p>
                  <p className="mt-3 text-xs text-[var(--color-text-muted)]">{m(studentsKey)}</p>
                </div>
              );
            })}
          </div>
          <Link
            href="/signup"
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

      <footer className="border-t border-slate-800/60 bg-[#080f1a] px-4 py-10 md:px-6">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-4 text-center text-sm text-slate-400">
          <p>{m('footerTagline')}</p>
          <p className="text-xs">{footerT('ehgProduct')}</p>
          <a
            href={WA_SUPPORT}
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 transition-colors hover:text-white btn-press chq-focus rounded-lg px-2 py-1"
          >
            {m('footerSupportLabel')}: +20 122 060 1410
          </a>
          <p className="text-xs text-slate-600">{m('footerRights')}</p>
        </div>
      </footer>
    </main>
  );
}
