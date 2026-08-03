'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Globe2 } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { useLocaleToggle } from './useLocaleToggle';

/**
 * Merged-Teacher-Students `.appbar` — back chevron, screen title, language
 * globe. Mobile only: the desktop sidebar owns navigation and the language
 * switch there, so this would be a second copy of both.
 *
 * No horizontal padding of its own — TeacherShell's content container already
 * insets 16px, which is exactly the design's appbar inset. Adding the design's
 * literal `padding-inline: 16px` here would double it.
 */
export default function TeacherAppBar({
  title,
  backHref,
  preferHistory = false,
}: {
  title: string;
  /** Destination for the chevron; also the fallback when there is no in-app history. */
  backHref: string;
  /** Prefer router.back() — for screens reachable from several places. */
  preferHistory?: boolean;
}) {
  const t = useTranslations('teacherPortal.nav');
  const locale = useLocale();
  const router = useRouter();
  const toggleLocale = useLocaleToggle();

  const BackIcon = locale === 'ar' ? ChevronRight : ChevronLeft;

  const goBack = () => {
    if (preferHistory && typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(backHref);
  };

  const iconButton =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-1)] text-[var(--color-ink-body)] transition-colors hover:bg-[var(--color-surface-2)]';

  return (
    <div className="flex items-center gap-2 pb-3 md:hidden">
      <button type="button" onClick={goBack} aria-label={t('back')} className={iconButton}>
        <BackIcon size={20} aria-hidden />
      </button>
      <h1 className="min-w-0 truncate text-[17px] font-bold text-[var(--color-text-primary)]">
        {title}
      </h1>
      <button
        type="button"
        onClick={toggleLocale}
        aria-label={locale === 'ar' ? t('switchToEnglish') : t('switchToArabic')}
        className={`${iconButton} ms-auto`}
      >
        <Globe2 size={20} aria-hidden />
      </button>
    </div>
  );
}
