'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';

type HeatmapCell = {
  date: string;
  present: number;
};

type Props = {
  groupId: string;
  groupSize: number;
  weeks?: number;
};

export function AttendanceHeatmap({ groupId, groupSize, weeks = 8 }: Props) {
  const t = useTranslations('heatmap');
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

  function formatLocalDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() - weeks * 7);

  const cellMap: Record<string, number> = {};
  for (const cell of cells) {
    cellMap[cell.date] = cell.present;
  }

  const allDays: string[] = [];
  const cursor = new Date(cutoff);
  while (cursor <= today) {
    allDays.push(formatLocalDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  const startDayOfWeek = cutoff.getDay();
  const paddingCells = Array(startDayOfWeek).fill(null) as null[];

  function getCellColor(dateStr: string): string {
    const present = cellMap[dateStr];
    if (present === undefined || present === 0) return 'bg-[var(--color-surface-2)]';
    if (groupSize <= 0) return 'bg-teal-300';
    const pct = present / groupSize;
    if (pct >= 0.8) return 'bg-teal-500';
    if (pct >= 0.5) return 'bg-teal-300';
    return 'bg-teal-100';
  }

  function getCellTooltip(dateStr: string): string {
    const present = cellMap[dateStr];
    const arabicDate = new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    if (present === undefined || present === 0) {
      return `${arabicDate} - ${t('legend.none')}`;
    }
    return `${arabicDate} - ${present} طالب حضر`;
  }

  const dayHeaders = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];

  if (loading) {
    return (
      <div className="space-y-1 p-2">
        {Array(weeks)
          .fill(null)
          .map((_, i) => (
            <div key={i} className="flex gap-1">
              {Array(7)
                .fill(null)
                .map((_, j) => (
                  <div key={j} className="w-4 h-4 rounded-sm bg-[var(--color-surface-2)] animate-pulse" />
                ))}
            </div>
          ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-xs text-[var(--color-text-muted)] p-2" dir="rtl">
        {t('error')}
      </div>
    );
  }

  if (cells.length === 0) {
    return (
      <div className="text-xs text-[var(--color-text-muted)] p-2" dir="rtl">
        {t('noData')}
      </div>
    );
  }

  const allCells: (string | null)[] = [...paddingCells, ...allDays];

  return (
    <div className="p-2 space-y-2" dir="ltr">
      <p className="text-xs font-medium text-[var(--color-text-secondary)] text-right" dir="rtl">
        الحضور - آخر {weeks} أسابيع
      </p>

      <div className="flex gap-1">
        {dayHeaders.map((d, i) => (
          <div key={i} className="w-4 text-center text-xs text-[var(--color-text-muted)]">
            {d}
          </div>
        ))}
      </div>

      <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(7, 1rem)' }}>
        {allCells.map((dateStr, i) =>
          dateStr === null ? (
            <div key={`pad-${i}`} className="w-4 h-4" />
          ) : (
            <div
              key={dateStr}
              title={getCellTooltip(dateStr)}
              className={`w-4 h-4 rounded-sm cursor-default ${getCellColor(dateStr)}`}
            />
          )
        )}
      </div>

      <div className="flex gap-3 flex-wrap" dir="rtl">
        {[
          { color: 'bg-[var(--color-surface-2)]', label: t('legend.none') },
          { color: 'bg-teal-100', label: t('legend.low') },
          { color: 'bg-teal-300', label: t('legend.medium') },
          { color: 'bg-teal-500', label: t('legend.high') },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded-sm ${color}`} />
            <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
