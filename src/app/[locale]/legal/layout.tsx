import type { ReactNode } from 'react';
import { Link } from '@/i18n/routing';
import { getLocale } from 'next-intl/server';

/**
 * Minimal public chrome for /legal/* documents: CenterHQ wordmark (links home)
 * and a footer linking the four legal pages. No full app nav. Cream surface to
 * match the rest of the public marketing surfaces.
 */
export default async function LegalLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const isAr = locale === 'ar' || locale.startsWith('ar-');

  const t = {
    privacy: isAr ? 'سياسة الخصوصية' : 'Privacy Policy',
    terms: isAr ? 'الشروط والأحكام' : 'Terms and Conditions',
    cookie: isAr ? 'سياسة الكوكيز' : 'Cookie Policy',
    dpa: isAr ? 'اتفاقية معالجة البيانات' : 'Data Processing Agreement',
    rights: isAr
      ? '© CenterHQ. جميع الحقوق محفوظة.'
      : '© CenterHQ. All rights reserved.',
  };

  return (
    <div
      className="flex min-h-screen flex-col bg-[var(--color-surface-0)]"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface-1)]">
        <div className="mx-auto flex max-w-3xl items-center px-4 py-4">
          <Link
            href="/"
            className="text-lg font-bold tracking-wide"
            style={{ fontFamily: 'var(--font-bodoni)', letterSpacing: '1.5px' }}
          >
            <span className="text-[var(--color-text-primary)]">CENTER</span>
            <span className="text-[var(--color-teal-deep)]">HQ</span>
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-[var(--color-border)] bg-[var(--color-surface-1)]">
        <div className="mx-auto max-w-3xl px-4 py-8">
          <nav
            className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[var(--color-text-muted)]"
            aria-label={isAr ? 'روابط قانونية' : 'Legal links'}
          >
            <Link href="/legal/privacy" className="transition-colors hover:text-[var(--color-text-primary)]">
              {t.privacy}
            </Link>
            <Link href="/legal/terms" className="transition-colors hover:text-[var(--color-text-primary)]">
              {t.terms}
            </Link>
            <Link href="/legal/cookie" className="transition-colors hover:text-[var(--color-text-primary)]">
              {t.cookie}
            </Link>
            <Link href="/legal/dpa" className="transition-colors hover:text-[var(--color-text-primary)]">
              {t.dpa}
            </Link>
          </nav>
          <p className="mt-4 text-xs text-[var(--color-text-muted)]">{t.rights}</p>
        </div>
      </footer>
    </div>
  );
}
