'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { formatDate, formatNumber } from '@/lib/formatNumber';

type HeatmapCell = {
  date: string;
  present: number;
};

type Props = {
  groupId: string;
  groupSize: number;
  weeks?: number;
};

/**
 * The design's ramp (`Merged-Center-Groups` line 478), lightest to darkest.
 * Five steps, and the first one is "a session happened and nobody came" — not
 * "no session". Days with no session are not drawn at all in this layout.
 */
const RAMP = ['#E6EFE9', '#BFE0D5', '#6FBFAE', '#2A8F7D', '#0A514A'] as const;

/** 8 columns × 2 rows — one cell per SESSION, newest last (design lines 474-477). */
const COLUMNS = 8;
const ROWS = 2;
const MAX_CELLS = COLUMNS * ROWS;

export function AttendanceHeatmap({ groupId, groupSize, weeks = 8 }: Props) {
  const t = useTranslations('heatmap');
  const locale = useLocale();
  const [cells, setCells] = useState<HeatmapCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      try {
        const r = await fetch(`/api/groups/${groupId}/attendance-heatmap?weeks=${weeks}`, { headers });
        const data = await r.json();
        if (!cancelled) {
          setCells(data.cells || []);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [groupId, weeks]);

  /**
   * Ramp step for a session's headcount.
   *
   * With no known group size there is no ratio to compute, so the cell takes
   * the middle step rather than inventing a full or empty one — a session that
   * happened must never render as the "nobody came" colour just because the
   * roster count was unavailable.
   */
  function rampIndex(present: number): number {
    if (present <= 0) return 0;
    if (groupSize <= 0) return 2;
    const pct = present / groupSize;
    if (pct < 0.4) return 1;
    if (pct < 0.6) return 2;
    if (pct < 0.8) return 3;
    return 4;
  }

  function cellTooltip(cell: HeatmapCell): string {
    const formattedDate = formatDate(cell.date + 'T12:00:00Z', locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    if (cell.present <= 0) {
      return `${formattedDate} - ${t('legend.none')}`;
    }
    return `${formattedDate} - ${t('presentOfTotal', {
      present: formatNumber(cell.present, locale),
      total: formatNumber(groupSize, locale),
    })}`;
  }

  const isRTL = locale === 'ar';
  const dir = isRTL ? 'rtl' : 'ltr';

  if (loading) {
    return (
      <div className="space-y-1 p-2" aria-busy="true" aria-live="polite">
        {Array.from({ length: ROWS }).map((_, i) => (
          <div key={i} className="flex gap-1">
            {Array.from({ length: COLUMNS }).map((_, j) => (
              <div key={j} className="h-4 w-4 rounded-xs bg-[var(--color-surface-2)] animate-pulse" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-xs text-[var(--color-text-muted)] p-2" dir={dir}>
        {t('error')}
      </div>
    );
  }

  if (cells.length === 0) {
    return (
      <div className="text-xs text-[var(--color-text-muted)] p-2" dir={dir}>
        {t('noData')}
      </div>
    );
  }

  // The route returns cells oldest-first. The design's newest cell is the LAST
  // one in the second row, so an under-filled grid pads at the START.
  const recent = cells.slice(-MAX_CELLS);
  const padding = MAX_CELLS - recent.length;

  return (
    <div className="space-y-2 p-2" dir={dir}>
      <p className="text-xs font-medium text-[var(--color-text-secondary)] text-start">
        {t('attendanceLastWeeks', { weeks: formatNumber(weeks, locale) })}
      </p>

      <div
        className="grid w-fit gap-1"
        style={{ gridTemplateColumns: `repeat(${COLUMNS}, 1rem)` }}
        role="img"
        aria-label={t('attendanceLastWeeks', { weeks: formatNumber(weeks, locale) })}
      >
        {Array.from({ length: padding }).map((_, i) => (
          <div key={`pad-${i}`} className="h-4 w-4" aria-hidden />
        ))}
        {recent.map((cell) => (
          <div
            key={cell.date}
            title={cellTooltip(cell)}
            className="h-4 w-4 rounded-xs cursor-default"
            style={{ background: RAMP[rampIndex(cell.present)] }}
          />
        ))}
      </div>

      {/* Design line 478: an unlabelled Less -> More ramp. The per-cell tooltip
          above carries the readable figure, so dropping the four labelled
          swatches does not remove the only accessible reading of a cell. */}
      <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
        <span>{t('less')}</span>
        {RAMP.map((color) => (
          <i
            key={color}
            className="inline-block h-3 w-3 rounded-xs"
            style={{ background: color }}
            aria-hidden
          />
        ))}
        <span>{t('more')}</span>
      </div>
    </div>
  );
}
