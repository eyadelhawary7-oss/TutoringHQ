'use client';

import { useRouter, usePathname } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { CalendarDays } from 'lucide-react';
import { CEO_RANGE_PILLS, DEFAULT_RANGE, isValidRangeKey } from '@/lib/ceo-time-range';
import type { RangeKey } from '@/lib/ceo-time-range';

export default function TimeRangeSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawRange = searchParams?.get('range') ?? '';
  const activeRange: RangeKey = isValidRangeKey(rawRange) ? rawRange : DEFAULT_RANGE;

  const handleSelect = (key: RangeKey) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('range', key);
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <div
      className="flex flex-row items-center gap-3 py-2 mb-6 flex-wrap sm:flex-nowrap"
      data-chq-ceo-range-pills
    >
      <CalendarDays className="text-teal-600 dark:text-teal-400 shrink-0 w-5 h-5" aria-hidden />
      <div className="flex flex-row flex-wrap sm:flex-nowrap gap-2 flex-1 min-w-0">
        {CEO_RANGE_PILLS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => handleSelect(key)}
            aria-pressed={activeRange === key}
            className={
              activeRange === key
                ? 'bg-teal-600 text-white font-semibold rounded-full px-3 py-1.5 text-xs sm:text-sm shrink-0'
                : 'rounded-full px-3 py-1.5 text-xs sm:text-sm shrink-0 border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:border-teal-500/50 hover:text-[var(--color-text-primary)]'
            }
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  );
}
