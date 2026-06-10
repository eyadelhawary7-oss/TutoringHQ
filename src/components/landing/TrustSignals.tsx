'use client';

import { useTranslations } from 'next-intl';
import { Lock, Database, FileDown, DatabaseBackup } from 'lucide-react';

const tiles = [
  { key: 'tile1', Icon: Lock },
  { key: 'tile2', Icon: Database },
  { key: 'tile3', Icon: FileDown },
  { key: 'tile4', Icon: DatabaseBackup },
] as const;

export function TrustSignals() {
  const t = useTranslations('landing.trust');

  return (
    <section className="border-t border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-16 md:px-6 md:py-24">
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="text-2xl font-bold text-[var(--color-text-primary)] md:text-3xl">{t('heading')}</h2>
        <p className="mx-auto mt-3 max-w-[480px] text-sm text-[var(--color-text-secondary)] md:text-base">
          {t('subheading')}
        </p>
        <div
          className="mx-auto mt-10 grid max-w-[1000px] gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
        >
          {tiles.map(({ key, Icon }) => (
            <div
              key={key}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-0)] px-[18px] py-4 text-start"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-teal-soft)]">
                <Icon className="h-[18px] w-[18px] text-[var(--color-teal-deep)]" />
              </div>
              <p className="mt-3 text-sm font-medium text-[var(--color-text-primary)]">{t(`${key}.title` as 'tile1.title')}</p>
              <p className="mt-1.5 text-[13px] leading-[1.55] text-[var(--color-text-muted)]">
                {t(`${key}.body` as 'tile1.body')}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
