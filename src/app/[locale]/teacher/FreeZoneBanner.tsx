'use client';

import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import { Link } from '@/i18n/routing';

/**
 * Brass banner for free-zone teacher pages: reassures that center tracking is
 * always free and points to the teacher pricing page for the private engine.
 * Render only for teachers WITHOUT private access.
 */
export default function FreeZoneBanner() {
  const t = useTranslations('freeZone');
  return (
    <Link
      href="/pricing?for=teacher"
      className="flex items-center gap-2 rounded-[var(--radius-card)] border border-[var(--color-brass)]/40 bg-[var(--color-brass-soft)] px-4 py-3 text-sm font-medium text-[var(--color-brass)] transition-opacity hover:opacity-90"
    >
      <Sparkles size={16} aria-hidden />
      {t('centersBanner')}
    </Link>
  );
}
