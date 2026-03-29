'use client';

import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { CalendarDays } from 'lucide-react';
import { DEFAULT_RANGE, isValidRangeKey } from '@/lib/ceo-time-range';
import type { RangeKey } from '@/lib/ceo-time-range';

export default function TimeRangeSelector() {
  const t = useTranslations('ceoRange');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawRange = searchParams?.get('range') ?? '';
  const activeRange: RangeKey = isValidRangeKey(rawRange) ? rawRange : DEFAULT_RANGE;

  const ranges: Array<{ key: RangeKey; label: string }> = [
    { key: 'this_month', label: t('thisMonth') },
    { key: 'last_month', label: t('lastMonth') },
    { key: 'this_quarter', label: t('thisQuarter') },
    { key: 'last_quarter', label: t('lastQuarter') },
    { key: 'last_6_months', label: t('last6Months') },
    { key: 'this_year', label: t('thisYear') },
    { key: 'last_year', label: t('lastYear') },
    { key: 'all_time', label: t('allTime') },
  ];

  const handleSelect = (key: RangeKey) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('range', key);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex flex-row items-center gap-3 py-2 mb-6">
      <CalendarDays className="text-teal-500 shrink-0 w-5 h-5" aria-hidden />
      <div className="flex flex-row overflow-x-auto gap-2 flex-nowrap flex-1 min-w-0">
        {ranges.map((range) => (
          <button
            key={range.key}
            type="button"
            onClick={() => handleSelect(range.key)}
            aria-pressed={activeRange === range.key}
            className={
              activeRange === range.key
                ? 'bg-teal-600 text-white font-semibold rounded-full px-4 py-1.5 shrink-0'
                : 'bg-slate-800 text-slate-400 rounded-full px-4 py-1.5 shrink-0 hover:outline hover:outline-1 hover:outline-teal-600'
            }
          >
            {range.label}
          </button>
        ))}
      </div>
    </div>
  );
}
