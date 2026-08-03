'use client';

import { useLocale } from 'next-intl';
import { formatNumber } from '@/lib/formatNumber';

export interface DoesItem {
  title: string;
  body: string;
}

/**
 * The `.does` card (design L365-374): numbered rows inside one panel, divided
 * by hairlines rather than sitting as separate tiles. Replaces the centred
 * circles-and-dashed-connectors treatment on both audience pages.
 */
export default function DoesCard({
  items,
  tone = 'center',
}: {
  items: DoesItem[];
  tone?: 'center' | 'teacher';
}) {
  const locale = useLocale();
  const discColor = tone === 'teacher' ? 'var(--color-brass)' : 'var(--color-accent)';

  return (
    <div className="mt-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-1">
      {items.map((item, i) => (
        <div
          key={item.title}
          className="flex items-start gap-3 border-b border-[var(--color-hairline)] py-4 last:border-b-0"
        >
          <span
            className="mkt-mono mt-1 grid shrink-0 place-items-center rounded-full text-[11px] text-white"
            style={{ width: 23, height: 23, backgroundColor: discColor }}
            aria-hidden
          >
            {formatNumber(i + 1, locale)}
          </span>
          <span>
            <span className="block text-[13px] font-semibold leading-tight text-[var(--color-ink)]">
              {item.title}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-[var(--color-muted)]">
              {item.body}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
