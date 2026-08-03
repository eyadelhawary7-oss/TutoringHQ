'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { Link } from '@/i18n/routing';
import Wordmark from '@/components/marketing/Wordmark';

/**
 * The `.nav` row drawn identically on all four public marketing screens: mark,
 * wordmark, spacer, Pricing, a Log-in pill, and the locale switch.
 *
 * `tone="teacher"` is the design's `.t .navlogin` override (L325) — the pill
 * goes brass on /teachers so the page keeps one accent family throughout.
 *
 * Everything the old public headers carried and this does not — the Features
 * anchor, "I'm a teacher", Contact us, the hamburger and its mobile sheet, the
 * separate Get-started button — is struck by the design. The nav is flat and
 * short enough at 390px that there is nothing to collapse.
 */
export default function MarketingNav({ tone = 'center' }: { tone?: 'center' | 'teacher' }) {
  const t = useTranslations('marketingNav');
  const locale = useLocale();
  const isAr = locale === 'ar';
  const pathname = usePathname();

  // Stay on the same page when switching language: strip the locale segment and
  // hand next-intl the rest, so /en/centers ↔ /ar/centers rather than home.
  const bare = (pathname ?? '/').replace(/^\/(?:ar|en)(?=\/|$)/, '') || '/';

  const loginPill =
    tone === 'teacher'
      ? { color: 'var(--color-brass)', borderColor: 'var(--color-canvas)' }
      : { color: 'var(--color-accent-deep)', borderColor: 'var(--color-mint-deep)' };

  return (
    <nav className="flex items-center gap-2 px-6 pt-4" aria-label={t('label')}>
      <Wordmark />
      <span className="flex-1" />
      <Link
        href="/pricing"
        className="whitespace-nowrap text-xs font-semibold text-[var(--color-mid)] transition-colors hover:text-[var(--color-ink)]"
      >
        {t('pricing')}
      </Link>
      <Link
        href="/login"
        className="whitespace-nowrap rounded-full border bg-[var(--color-panel)] px-4 py-3 text-xs font-bold"
        style={loginPill}
      >
        {t('login')}
      </Link>
      <Link
        href={bare}
        locale={isAr ? 'en' : 'ar'}
        aria-label={t('switchLocale')}
        className="whitespace-nowrap rounded-full border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-2 text-xs font-semibold text-[var(--color-mid)]"
      >
        {isAr ? 'EN' : 'عربي'}
      </Link>
    </nav>
  );
}
