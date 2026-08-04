'use client';

import { useTranslations } from 'next-intl';
import { formatCurrency, formatPercent } from '@/lib/formatNumber';
import { chartColors } from '@/lib/tokens';

export interface CollectionRateGaugeProps {
  /** 0-100 */
  rate: number;
  /** This month's confirmed payments — same figure as the MRR tile. */
  collected: number;
  /** Current running outstanding balance across active students (not month-scoped). */
  outstanding: number;
  locale: string;
}

const SIZE = 92;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Merged-Center-Insight §01's "Collection rate" card: a ring gauge plus the
 * collected/outstanding breakdown underneath it. The live analytics API
 * already computes `collection_rate` and `outstanding_total` — this was
 * previously fetched and thrown away; the KPI tile only ever showed the
 * percentage.
 *
 * The two figures under the ring are on **different time bases**, so they
 * carry different labels: `collected` is this month's confirmed payments
 * (`analytics.collectedThisMonth`), while `outstanding` is the running
 * balance across active students accumulated to date, not this month's
 * uncollected slice (the API has no month-scoped complement of
 * `collection_rate`). It is therefore labelled `analytics.outstandingRunning`
 * — "Outstanding (running total)" / "المستحق (إجمالي متراكم)" — and not the
 * bare `analytics.outstandingTotal` the KPI tiles use, so the pair is not
 * read as two halves of one month's billing.
 */
export default function CollectionRateGauge({ rate, collected, outstanding, locale }: CollectionRateGaugeProps) {
  const t = useTranslations('analytics');
  const clamped = Math.min(100, Math.max(0, Number.isFinite(rate) ? rate : 0));
  const dashOffset = CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 card-shadow">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">{t('collection_rate')}</h3>
      <div className="flex items-center gap-4">
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="var(--color-surface-3)"
              strokeWidth={STROKE}
            />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={chartColors.primary}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold text-[var(--color-text-primary)] tabular-nums">
              {formatPercent(clamped, locale)}
            </span>
          </div>
        </div>
        <div className="text-sm space-y-2 min-w-0">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">{t('collectedThisMonth')}</div>
            <div className="font-semibold text-[var(--color-text-primary)] tabular-nums">
              {formatCurrency(collected, locale)}
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">{t('outstandingRunning')}</div>
            <div className="font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
              {formatCurrency(outstanding, locale)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
