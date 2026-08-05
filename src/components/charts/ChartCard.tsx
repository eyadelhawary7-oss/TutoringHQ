'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { StillWorking } from '@/components/patterns';
import { formatGrowth, formatNumber, formatPercent } from '@/lib/formatNumber';

/**
 * How long a chart may stay skeletal before it says so, per
 * `Merged-Design-Patterns` §02 ("After a few seconds, say so"). Six seconds:
 * long enough that a normal load never trips it, short enough that the line
 * arrives before the person decides the screen is broken. §02's own note gives
 * the reason this matters more here than elsewhere — the database is in London.
 */
const SLOW_AFTER_MS = 6000;

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
  const t = useTranslations('common');
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!loading) return;
    const id = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    // The reset lives in the cleanup rather than in the effect body: a
    // synchronous setState in the body of an effect is a cascading-render
    // warning under the React Compiler lint, and the cleanup already runs at
    // exactly the moment the flag needs clearing — when `loading` flips.
    return () => {
      clearTimeout(id);
      setSlow(false);
    };
  }, [loading]);

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
          <p className="text-xs font-medium text-[var(--color-text-muted)]">{title}</p>
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
        /* `Merged-Design-Patterns` §02: "Never a spinner in the middle of an
           empty screen — it tells the person nothing about what they are
           waiting for." This card previously did exactly that, and because it
           is shared it did it on six screens at once (ceo, dashboard,
           branches, admin, admin/analytics, dashboard/analytics). What replaces
           it is the SHAPE of the chart that is coming — a plot block with an
           axis strip under it — so nothing jumps when the series lands, plus
           §02's slow line once the wait stops being ordinary. */
        <div style={{ minHeight }} aria-busy="true" aria-live="polite">
          <div className="flex h-full flex-col gap-2" aria-hidden>
            <div className="chq-skeleton min-h-[120px] w-full flex-1 rounded-md" />
            <div className="flex shrink-0 items-end gap-2">
              {[3, 4, 3, 5, 4].map((w, i) => (
                <div key={i} className="chq-skeleton h-2 rounded-xs" style={{ width: `${w * 8}px` }} />
              ))}
            </div>
          </div>
          {slow && <StillWorking message={t('stillWorking')} />}
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
