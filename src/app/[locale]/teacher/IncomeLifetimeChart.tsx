'use client';

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from '@/components/charts/recharts';
import { CHART_MARGIN, CHART_STYLE } from '@/components/charts/ChartTokens';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';

export type IncomeMonth = {
  year: number;
  month: number;
  private_collected: number;
  center_collected: number;
  total_collected: number;
  outstanding: number;
};

export type YearMonth = { year: number; month: number };

// Design-system tokens, literal because SVG presentation attributes cannot
// resolve CSS variables (same constraint documented in ChartTokens).
const TEAL = '#0e6b61';
const BRASS = '#9a6b1f';

const BAR_MIN_WIDTH_PX = 48;
const CHART_HEIGHT = 240;

const DESKTOP_QUERY = '(min-width: 640px)';

function subscribeDesktopQuery(onChange: () => void): () => void {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function getDesktopMatch(): boolean {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function getDesktopServer(): boolean {
  return false;
}

type ChartDatum = IncomeMonth & { key: string };

function ymKey(ym: YearMonth): string {
  return `${ym.year}-${ym.month}`;
}

/** Noon UTC mid-month: safely inside the month on the Cairo calendar too. */
function monthAnchor(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 15, 12, 0, 0));
}

/** Recharts injects active/payload via cloneElement on the content element. */
function ChartTooltip({
  active,
  payload,
  locale,
  labels,
}: {
  active?: boolean;
  payload?: { payload?: ChartDatum }[];
  locale: string;
  labels: { private: string; centers: string; total: string };
}) {
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-xs shadow-card">
      <p className="mb-1 font-semibold text-[var(--color-text-primary)]">
        {formatDate(monthAnchor(d.year, d.month), locale, { month: 'long', year: 'numeric' })}
      </p>
      <p className="text-[var(--color-text-secondary)]">
        {labels.private}: {formatCurrency(d.private_collected, locale)}
      </p>
      <p className="text-[var(--color-text-secondary)]">
        {labels.centers}: {formatCurrency(d.center_collected, locale)}
      </p>
      <p className="mt-1 font-semibold text-[var(--color-text-primary)]">
        {labels.total}: {formatCurrency(d.total_collected, locale)}
      </p>
    </div>
  );
}

/**
 * Lifetime month navigator: one stacked bar per calendar month since the
 * teacher joined (teal private income on brass center cuts). Clicking a bar
 * selects that month for the split bar and the monthly tiles. Horizontally
 * scrollable when the series outgrows the viewport; bars never shrink below
 * BAR_MIN_WIDTH_PX. The SVG itself is LTR chart geometry, so the scroll
 * wrapper pins dir="ltr" and auto-scrolls to the newest (rightmost) month.
 */
export default function IncomeLifetimeChart({
  series,
  selected,
  current,
  onSelect,
}: {
  series: IncomeMonth[];
  selected: YearMonth;
  current: YearMonth;
  onSelect: (ym: YearMonth) => void;
}) {
  const t = useTranslations('teacherPortal.income');
  const locale = useLocale();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Y axis is desktop-only (EGP amounts are hidden on mobile).
  const desktop = useSyncExternalStore(subscribeDesktopQuery, getDesktopMatch, getDesktopServer);

  const data = useMemo<ChartDatum[]>(
    () => series.map((s) => ({ ...s, key: ymKey({ year: s.year, month: s.month }) })),
    [series],
  );

  const labelByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of series) {
      const anchor = monthAnchor(s.year, s.month);
      m.set(
        ymKey({ year: s.year, month: s.month }),
        locale === 'ar'
          ? formatDate(anchor, locale, { month: 'long' })
          : formatDate(anchor, locale, { month: 'short', year: '2-digit' }),
      );
    }
    return m;
  }, [series, locale]);

  // Land on the newest (rightmost) month on mount and when the series grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [data.length]);

  const selectedKey = ymKey(selected);
  const currentKey = ymKey(current);

  const handleClick = (state: unknown) => {
    const payload = (
      state as { activePayload?: { payload?: ChartDatum }[] } | null
    )?.activePayload?.[0]?.payload;
    if (payload) onSelect({ year: payload.year, month: payload.month });
  };

  const cellsFor = (withTopRadiusStroke: boolean) =>
    data.map((d) => (
      <Cell
        key={d.key}
        fillOpacity={d.key === selectedKey ? 1 : 0.55}
        // Subtle brass outline marks "today's" month even when not selected.
        stroke={withTopRadiusStroke && d.key === currentKey ? BRASS : undefined}
        strokeWidth={withTopRadiusStroke && d.key === currentKey ? 1.5 : 0}
      />
    ));

  return (
    /* dir="ltr": Recharts draws LTR geometry regardless of page direction;
       pinning the wrapper keeps scrollLeft math predictable in both locales. */
    <div
      ref={scrollRef}
      dir="ltr"
      className="cursor-pointer overflow-x-auto max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden"
    >
      <div
        style={{
          width: `max(100%, ${data.length * BAR_MIN_WIDTH_PX}px)`,
          height: CHART_HEIGHT,
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={CHART_MARGIN} onClick={handleClick}>
            <XAxis
              dataKey="key"
              interval={data.length <= 6 ? 0 : 2}
              tick={{ fontSize: 11, fill: CHART_STYLE.tickColor }}
              tickFormatter={(k: string) => labelByKey.get(k) ?? ''}
              stroke={CHART_STYLE.axisColor}
              tickLine={false}
            />
            <YAxis
              hide={!desktop}
              width={56}
              tick={{ fontSize: 11, fill: CHART_STYLE.tickColor }}
              tickFormatter={(v: number) => formatNumber(v, locale)}
              stroke={CHART_STYLE.axisColor}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              content={
                <ChartTooltip
                  locale={locale}
                  labels={{
                    private: t('chartPrivate'),
                    centers: t('chartCenters'),
                    total: t('chartTotal'),
                  }}
                />
              }
              cursor={{ fill: 'rgba(154, 107, 31, 0.08)' }}
            />
            <Bar dataKey="center_collected" stackId="a" fill={BRASS} name={t('chartCenters')}>
              {cellsFor(false)}
            </Bar>
            <Bar
              dataKey="private_collected"
              stackId="a"
              fill={TEAL}
              name={t('chartPrivate')}
              radius={[4, 4, 0, 0]}
            >
              {cellsFor(true)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
