'use client';

import { useTranslations } from 'next-intl';
import { PauseCircle } from 'lucide-react';
import { Link } from '@/i18n/routing';

/**
 * Static placeholder. Online resubscription is Paymob-blocked for now; this
 * page intentionally has no payment UI and no fake flow.
 */
export default function TeacherResubscribePage() {
  const t = useTranslations('teacherPortal.resubscribe');

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center">
      <PauseCircle size={32} className="mx-auto mb-4 text-[var(--color-warning)]" aria-hidden />
      <h1 className="mb-2 text-xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
      <p className="mb-6 text-sm text-[var(--color-text-secondary)]">{t('body')}</p>
      <Link
        href="/teacher"
        className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-0)]"
      >
        {t('backHome')}
      </Link>
    </div>
  );
}
