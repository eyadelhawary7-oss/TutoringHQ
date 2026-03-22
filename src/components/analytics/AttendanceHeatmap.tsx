'use client';

import { useMemo } from 'react';

type Cell = { day: number; week: number; count: number };
type Props = { cells: Cell[]; weekLabels: string[] };

export function AttendanceHeatmap({ cells, weekLabels }: Props) {
  const maxCount = useMemo(() => Math.max(0, ...cells.map((c) => c.count)), [cells]);

  const getColor = (count: number, max: number) => {
    if (max === 0 || count === 0) return 'var(--color-surface-3)';
    const intensity = count / max;
    if (intensity > 0.75) return 'var(--color-brand-500)';
    if (intensity > 0.5) return 'rgba(13,148,136,0.6)';
    if (intensity > 0.25) return 'rgba(13,148,136,0.35)';
    return 'rgba(13,148,136,0.15)';
  };

  const weeks = cells.length > 0 ? Math.max(0, ...cells.map((c) => c.week)) + 1 : 0;

  if (weeks === 0) {
    return null;
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1 min-w-max">
        <div className="flex flex-col gap-1 me-1">
          {weekLabels.map((label, i) => (
            <div
              key={i}
              className="h-4 text-[10px] text-[var(--color-text-tertiary)] flex items-center w-6"
            >
              {label}
            </div>
          ))}
        </div>
        {Array.from({ length: weeks }).map((_, w) => (
          <div key={w} className="flex flex-col gap-1">
            {weekLabels.map((_, d) => {
              const cell = cells.find((c) => c.week === w && c.day === d);
              const count = cell?.count ?? 0;
              return (
                <div
                  key={d}
                  className="heatmap-cell w-4 h-4"
                  style={{ background: getColor(count, maxCount) }}
                  title={`${count} scans`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
