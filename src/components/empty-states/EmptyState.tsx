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
}

export default function EmptyState({
  icon,
  titleKey,
  descriptionKey,
  namespace = 'emptyStates',
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const t = useTranslations(namespace);

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-teal-100 flex items-center justify-center mb-4 [&>svg]:w-8 [&>svg]:h-8 [&>svg]:text-teal-600">
        {icon}
      </div>
      <h3 className="text-base font-bold text-foreground mb-2" style={{ fontFamily: "'Cairo-Arabic', Georgia, \"Times New Roman\", serif" }}>
        {t(titleKey)}
      </h3>
      <p className="text-sm text-slate-500 max-w-sm mb-6">{t(descriptionKey)}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="px-6 py-3 rounded-lg font-semibold text-white transition-colors hover:opacity-90"
          style={{ backgroundColor: '#0D9488' }}
        >
          {t(actionLabel)}
        </button>
      )}
    </div>
  );
}
