'use client';

import { useLocale } from 'next-intl';
import { formatNumber } from '@/lib/formatNumber';

export interface ChartLegendItem {
  color: string;
  label: string;
  value?: number | string;
  prefix?: string;
  suffix?: string;
}

export interface ChartLegendProps {
  items: ChartLegendItem[];
  direction?: 'horizontal' | 'vertical';
}

export function ChartLegend({ items, direction = 'horizontal' }: ChartLegendProps) {
  const locale = useLocale();
  return (
    <div
      className={`flex gap-3 mt-3 ${direction === 'horizontal' ? 'flex-row flex-wrap' : 'flex-col'}`}
    >
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: item.color }}
            aria-hidden
          />
          <span className="text-xs text-[var(--color-text-muted)] truncate">{item.label}</span>
          {item.value !== undefined && item.value !== null ? (
            <span className="text-xs font-semibold text-[var(--color-text-primary)] tabular-nums shrink-0">
              {item.prefix ?? ''}
              {typeof item.value === 'number'
                ? formatNumber(item.value, locale)
                : item.value}
              {item.suffix ?? ''}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
