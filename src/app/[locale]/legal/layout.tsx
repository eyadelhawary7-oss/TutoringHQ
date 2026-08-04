import type { ReactNode } from 'react';
import { getLocale } from 'next-intl/server';

/**
 * `Merged-Public-Legal` §01 — the legal surface is a bare `--color-paper`
 * column. Every screen in the design draws its own `.appbar` and its own
 * `.foot`, so the shared chrome that used to live here (a Bodoni wordmark
 * header and a four-link footer with a copyright line) is gone: the design
 * draws neither, and both duplicated navigation the per-screen footer button
 * already provides.
 *
 * Per-screen chrome is `LegalChrome`; per-screen footers are drawn by each page.
 */
export default async function LegalLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const isAr = locale === 'ar' || locale.startsWith('ar-');

  return (
    <div
      className="flex min-h-screen flex-col bg-[var(--color-paper)]"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      {children}
    </div>
  );
}
