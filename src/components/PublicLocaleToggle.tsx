'use client';

import { useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Globe2 } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/routing';

/**
 * Globe2 language toggle for public/unauthenticated pages. Switches the locale
 * prefix via next-intl routing only - no session, no server persistence. Shows
 * the OTHER language's endonym ("English" when on Arabic, "عربي" when on
 * English), matching the teacher-sidebar toggle pattern.
 */
export default function PublicLocaleToggle({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations('localeToggle');
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const toggle = () => {
    const next = locale === 'ar' ? 'en' : 'ar';
    startTransition(() => router.replace(pathname, { locale: next }));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t('aria')}
      className={
        className ??
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]'
      }
    >
      <Globe2 size={16} aria-hidden />
      {locale === 'ar' ? t('toEnglish') : t('toArabic')}
    </button>
  );
}
