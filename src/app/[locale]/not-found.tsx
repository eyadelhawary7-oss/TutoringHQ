'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

export default function NotFound() {
  const t = useTranslations('notFound');
  return (
    <div className="bg-[var(--color-surface-0)] min-h-screen flex flex-col items-center justify-center gap-6 px-6">
      <div className="text-[var(--color-brand-500)] text-7xl font-bold leading-none">404</div>
      <div className="text-center">
        <h1 className="text-xl font-bold text-[var(--color-text-primary)] mb-2">{t('heading')}</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">{t('subtitle')}</p>
      </div>
      <Link href="/dashboard" className="btn btn-primary">
        {t('backHome')}
      </Link>
    </div>
  );
}
