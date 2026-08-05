'use client';

import { useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { ScanLine } from 'lucide-react';
import { EmptyState } from '@/components/shared';
import { formatDate } from '@/lib/formatNumber';
import type { TodayHistoryRow, TodayHistoryScanStatus } from '@/lib/db';

export type HistoryFilter = 'all' | 'admitted' | 'failed' | 'duplicate';

interface TodayHistorySheetProps {
  open: boolean;
  onClose: () => void;
  rows: TodayHistoryRow[];
}

function matchesFilter(row: TodayHistoryRow, f: HistoryFilter): boolean {
  if (f === 'all') return true;
  if (f === 'admitted') return row.status === 'admitted';
  if (f === 'failed') return row.status === 'failed' || row.status === 'error';
  if (f === 'duplicate') return row.status === 'duplicate';
  return true;
}

export default function TodayHistorySheet({ open, onClose, rows }: TodayHistorySheetProps) {
  const t = useTranslations('scanner.historySheet');
  const locale = useLocale();
  const [filter, setFilter] = useState<HistoryFilter>('all');

  const filtered = useMemo(() => [...rows].reverse().filter((r) => matchesFilter(r, filter)), [rows, filter]);

  const labelForStatus = (s: TodayHistoryScanStatus) => {
    switch (s) {
      case 'admitted':
        return t('pill_admitted');
      case 'duplicate':
        return t('pill_duplicate');
      case 'failed':
      case 'error':
        return t('pill_failed');
      default:
        return s;
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[58] flex items-end justify-center bg-black/50 sm:items-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-[var(--color-surface-1)] shadow-xl border border-[var(--color-border-subtle)] max-h-[88vh] flex flex-col">
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-12 h-1 rounded-full bg-[var(--color-border-strong)]" aria-hidden />
        </div>
        <div className="px-4 pb-3 border-b border-[var(--color-border-subtle)]">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{t('title')}</h2>
          <div className="flex flex-wrap gap-2 mt-3">
            {(['all', 'admitted', 'failed', 'duplicate'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors ${
                  filter === key
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'bg-[var(--color-surface-0)] text-[var(--color-text-secondary)] border-[var(--color-border-subtle)]'
                }`}
              >
                {t(`filter_${key}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-[var(--color-border-subtle)]">
          {filtered.length === 0 ? (
            /* §01 quiet variant: today's scan log fills itself as the door is
               worked. Nothing is waiting on the person reading it, so no action
               and the muted tile rather than the mint one. */
            <EmptyState icon={ScanLine} title={t('empty')} quiet />
          ) : (
            filtered.map((r) => (
              <div key={r.id} className="px-4 py-3 flex gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{r.studentName ?? r.normalizedInput}</p>
                  <p className="text-[11px] font-mono text-[var(--color-text-tertiary)] truncate">{r.rawInput}</p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">{formatDate(new Date(r.timestamp), locale, 'time')}</p>
                  {r.errorReason ? (
                    <p className="text-[11px] text-red-500 mt-1">{r.errorReason}</p>
                  ) : null}
                </div>
                <span className="shrink-0 self-start rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)]">
                  {labelForStatus(r.status)}
                </span>
              </div>
            ))
          )}
        </div>
        <div className="p-4 border-t border-[var(--color-border-subtle)]">
          <button type="button" onClick={onClose} className="w-full py-2 text-sm font-medium text-teal-600">
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}
