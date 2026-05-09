'use client';

import type { ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { formatGrowth, formatNumber, formatPercent } from '@/lib/formatNumber';

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  value?: string | number;
  valuePrefix?: string;
  valueSuffix?: string;
  /** Legacy numeric trend; prefer `growthPair` for consistent formatGrowth display. */
  trend?: number;
  trendLabel?: string;
  /** Week-over-week; chip hidden when formatGrowth is null (no prior baseline). */
  growthPair?: { current: number; prior: number };
  children: ReactNode;
  actions?: ReactNode;
  loading?: boolean;
  minHeight?: number;
  footer?: ReactNode;
}

export function ChartCard({
  title,
  subtitle,
  value,
  valuePrefix = '',
  valueSuffix = '',
  trend,
  trendLabel,
  growthPair,
  children,
  actions,
  loading,
  minHeight = 240,
  footer,
}: ChartCardProps) {
  const locale = useLocale();
  const valueStr =
    value !== undefined && value !== null
      ? typeof value === 'number'
        ? formatNumber(value, locale)
        : value
      : '';

  const growthLabel =
    growthPair != null && Number.isFinite(growthPair.prior) && Number.isFinite(growthPair.current)
      ? formatGrowth(growthPair.current, growthPair.prior, locale)
      : null;
  const growthNegative =
    growthPair != null && growthPair.prior > 0 && growthPair.current < growthPair.prior;

  return (
    <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">{title}</p>
          {subtitle ? <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{subtitle}</p> : null}
          {valueStr ? (
            <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-1 tabular-nums">
              {valuePrefix}
              {valueStr}
              {valueSuffix}
            </p>
          ) : null}
          {growthLabel ? (
            <span
              className={`inline-flex items-center gap-0.5 text-xs font-semibold mt-2 px-2 py-0.5 rounded-full ${
                growthNegative ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/15 text-emerald-400'
              }`}
            >
              {growthNegative ? (
                <TrendingDown className="w-3.5 h-3.5" aria-hidden />
              ) : (
                <TrendingUp className="w-3.5 h-3.5" aria-hidden />
              )}
              <span>{growthLabel}</span>
              {trendLabel ? <span className="ms-1 font-normal opacity-90">{trendLabel}</span> : null}
            </span>
          ) : trend !== undefined && Number.isFinite(trend) ? (
            <span
              className={`inline-flex items-center gap-0.5 text-xs font-semibold mt-2 px-2 py-0.5 rounded-full ${
                trend >= 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
              }`}
            >
              {trend >= 0 ? <TrendingUp className="w-3.5 h-3.5" aria-hidden /> : <TrendingDown className="w-3.5 h-3.5" aria-hidden />}
              {formatPercent(Math.abs(trend), locale)}
              {trendLabel ? <span className="ms-1 font-normal opacity-90">{trendLabel}</span> : null}
            </span>
          ) : null}
        </div>
        {actions ? <div className="shrink-0 flex items-center gap-2">{actions}</div> : null}
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-16" style={{ minHeight }}>
          <div
            className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"
            aria-busy
            role="status"
          />
        </div>
      ) : (
        <div style={{ minHeight }} className="min-h-0">
          {children}
          {footer ? (
            <p className="mt-3 border-t border-[var(--color-border-subtle)] pt-2 text-xs text-[var(--color-text-muted)]">
              {footer}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
