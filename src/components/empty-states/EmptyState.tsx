'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';

export interface EmptyStateProps {
  icon: ReactNode;
  titleKey: string;
  descriptionKey: string;
  namespace?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** A second, lower-emphasis action next to the primary one (e.g. "Import from file" beside "Add student"). */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

export default function EmptyState({
  icon,
  titleKey,
  descriptionKey,
  namespace = 'emptyStates',
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}: EmptyStateProps) {
  const t = useTranslations(namespace);

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-teal-100 flex items-center justify-center mb-4 [&>svg]:w-8 [&>svg]:h-8 [&>svg]:text-teal-600">
        {icon}
      </div>
      <h3 className="text-base font-bold text-[var(--color-text-primary)] mb-2" style={{ fontFamily: "'Cairo-Arabic', Georgia, \"Times New Roman\", serif" }}>
        {t(titleKey)}
      </h3>
      <p className="text-sm text-[var(--color-text-secondary)] max-w-sm mb-6">{t(descriptionKey)}</p>
      {(actionLabel && onAction) || (secondaryActionLabel && onSecondaryAction) ? (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {actionLabel && onAction && (
            <button
              onClick={onAction}
              className="px-6 py-3 rounded-lg font-semibold text-white transition-colors hover:opacity-90"
              style={{ backgroundColor: 'var(--color-brand-500)' }}
            >
              {t(actionLabel)}
            </button>
          )}
          {secondaryActionLabel && onSecondaryAction && (
            <button
              onClick={onSecondaryAction}
              className="px-6 py-3 rounded-lg font-semibold text-[var(--color-text-primary)] border border-[var(--color-border)] transition-colors hover:bg-[var(--color-surface-2)]"
            >
              {t(secondaryActionLabel)}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
