'use client';

import { Link, usePathname } from '@/i18n/routing';

/**
 * The design's `.globe` pill — "EN · ع" in English, "ع · EN" in Arabic.
 *
 * Links to the *same* path under the other locale rather than toggling a cookie,
 * so a reader deep in the Terms stays on the Terms. `usePathname` from
 * `@/i18n/routing` returns the locale-stripped path, which is what `Link`'s
 * `locale` prop expects.
 *
 * `margin-inline-start: auto` is the design's own rule and is what pushes the
 * pill to the trailing edge in both directions.
 */
export default function LocaleSwitchPill({ locale }: { locale: string }) {
  const pathname = usePathname();
  const isAr = locale === 'ar' || locale.startsWith('ar-');
  const other = isAr ? 'en' : 'ar';

  return (
    <Link
      href={pathname}
      locale={other}
      aria-label={isAr ? 'English' : 'العربية'}
      className="chq-focus ms-auto shrink-0 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 text-[11px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink-body)]"
    >
      {isAr ? 'ع · EN' : 'EN · ع'}
    </Link>
  );
}
