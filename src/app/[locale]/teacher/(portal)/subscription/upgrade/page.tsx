'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, ArrowLeft, Sparkles } from 'lucide-react';
import { Link } from '@/i18n/routing';

/**
 * /teacher/subscription/upgrade - placeholder for the plan upgrade flow.
 * Linked from the home subscription tile and the settings subscription
 * section; the real checkout lands here once teacher plan upgrades go live.
 */
export default function TeacherUpgradePage() {
  const t = useTranslations('teacherUpgrade');
  const locale = useLocale();
  const BackIcon = locale === 'ar' ? ArrowRight : ArrowLeft;

  return (
    <div className="mx-auto max-w-lg">
      <Link
        href="/teacher"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
      >
        <BackIcon size={16} aria-hidden />
        {t('back')}
      </Link>
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center shadow-card">
        <Sparkles size={28} className="mx-auto mb-3 text-[var(--color-brass)]" aria-hidden />
        <h1 className="mb-2 text-xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">{t('body')}</p>
      </div>
    </div>
  );
}
