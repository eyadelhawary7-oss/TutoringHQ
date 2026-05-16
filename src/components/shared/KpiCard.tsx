'use client';

import type { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: React.ReactNode;
  /** Optional secondary content beneath the value. Accepts strings or rich nodes (sparklines, deltas, progress bars). */
  subLabel?: React.ReactNode;
  /** Omit for a label-only card with no icon badge. */
  icon?: LucideIcon;
  iconBg?: string;
  iconColor?: string;
}

export default function KpiCard({
  title,
  value,
  subLabel,
  icon: Icon,
  iconBg = 'bg-teal-100',
  iconColor = 'text-teal-600',
}: KpiCardProps) {
  return (
    <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-[var(--color-text-secondary)] mb-1">{title}</p>
        <p className="text-2xl font-bold text-[var(--color-text-primary)] font-mono">{value}</p>
        {subLabel != null && (
          typeof subLabel === 'string' || typeof subLabel === 'number'
            ? <p className="text-xs text-[var(--color-text-muted)] mt-1">{subLabel}</p>
            : <div className="mt-2">{subLabel}</div>
        )}
      </div>
      {Icon ? (
        <div className={`shrink-0 p-3 rounded-full ${iconBg}`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
      ) : null}
    </div>
  );
}
