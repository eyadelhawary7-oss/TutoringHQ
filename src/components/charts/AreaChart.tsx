'use client';

import { useId, useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useLocale, useTranslations } from 'next-intl';
import { formatCurrency, formatNumber } from '@/lib/formatNumber';
import {
  CHART_MARGIN,
  CHART_STYLE,
  LINE_BY_GRADIENT,
  RECHARTS_TOOLTIP_WRAPPER_PROPS,
  type GradientKey,
} from './ChartTokens';
import { ChartTooltip } from './ChartTooltip';

export type AreaChartDataPoint = Record<string, string | number | undefined | null>;

export interface AreaChartComponentProps {
  data: AreaChartDataPoint[];
  dataKey: string;
  xKey?: string;
  color?: GradientKey;
  height?: number;
  prefix?: string;
  suffix?: string;
  /** Full value line in tooltip (overrides prefix + formatNumber + suffix). */
  tooltipValueFormatter?: (value: number) => string;
  xTickFormatter?: (v: string | number) => string;
  yTickFormatter?: (v: number) => string;
  tooltipLabelFormatter?: (v: string | number) => string;
  showGrid?: boolean;
  showYAxis?: boolean;
  /** Whole-number ticks on Y axis (counts, attendance). */
  integerYAxis?: boolean;
  /** Currency suffix ticks on Y axis (e.g. MRR). */
  currencyYAxis?: { locale: string };
  /** Hide consecutive duplicate tick labels (dense domains). */
  dedupYAxisTicks?: boolean;
}

export function AreaChartComponent({
  data,
  dataKey,
  xKey = 'date',
  color = 'teal',
  height = 200,
  prefix = '',
  suffix = '',
  tooltipValueFormatter,
  xTickFormatter,
  yTickFormatter,
  tooltipLabelFormatter,
  showGrid = false,
  showYAxis = true,
  integerYAxis = false,
  currencyYAxis,
  dedupYAxisTicks = false,
}: AreaChartComponentProps) {
  const locale = useLocale();
  const t = useTranslations('charts');
  const baseId = useId().replace(/:/g, '');
  const gradId = `area-grad-${color}-${baseId}`;
  const lineColor = LINE_BY_GRADIENT[color];

  const safeData = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const yTickCombined = useMemo(() => {
    const base =
      currencyYAxis != null
        ? (v: number) => formatCurrency(Number(v), currencyYAxis.locale)
        : integerYAxis
          ? (v: number) =>
              formatNumber(Math.round(Number(v)), locale, { maximumFractionDigits: 0 })
          : yTickFormatter
            ? (v: number) => yTickFormatter(v)
            : (v: number) => formatNumber(Number(v), locale);
    const raw = (v: number | string) => base(Number(v));
    if (!dedupYAxisTicks) return raw;
    let prev = '';
    return (v: number | string) => {
      const s = raw(v);
      if (s === prev) return '';
      prev = s;
      return s;
    };
  }, [
    currencyYAxis,
    dedupYAxisTicks,
    integerYAxis,
    locale,
    safeData.length,
    yTickFormatter,
  ]);

  if (!safeData.length || safeData.length < 2) {
    return (
      <div
        className="flex flex-col items-center justify-center text-center px-4"
        style={{ height, color: '#334155', fontSize: 13, fontFamily: CHART_STYLE.fontFamily }}
      >
        <p>{t('noData')}</p>
        <p className="mt-1 text-xs opacity-80 max-w-xs">{t('noDataSub')}</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={safeData} margin={{ ...CHART_MARGIN, left: showYAxis ? 4 : CHART_MARGIN.left }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
            <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        {showGrid ? (
          <CartesianGrid stroke={CHART_STYLE.gridColor} strokeDasharray="4 4" vertical={false} />
        ) : null}
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 11, fill: CHART_STYLE.tickColor, fontFamily: CHART_STYLE.fontFamily }}
          axisLine={false}
          tickLine={false}
          tickFormatter={
            xTickFormatter
              ? (v: string | number) => String(xTickFormatter(v))
              : (v: string | number) => String(v)
          }
        />
        {showYAxis ? (
          <YAxis
            width={currencyYAxis ? 56 : 44}
            tick={{ fontSize: 11, fill: CHART_STYLE.tickColor, fontFamily: CHART_STYLE.fontFamily }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number | string) => yTickCombined(v)}
          />
        ) : null}
        <Tooltip
          {...RECHARTS_TOOLTIP_WRAPPER_PROPS}
          cursor={{ stroke: '#334155', strokeWidth: 1, strokeDasharray: '4 4' }}
          content={(props) => {
            const pl = props.payload?.map((p) => ({
              name: String(p.name ?? p.dataKey ?? ''),
              value: Number(p.value ?? 0),
              color: String(p.stroke ?? p.color ?? lineColor),
              dataKey: String(p.dataKey ?? ''),
            }));
            return (
              <ChartTooltip
                active={props.active}
                payload={pl}
                label={props.label}
                labelFormatter={tooltipLabelFormatter}
                prefix={prefix}
                suffix={suffix}
                valueFormatter={tooltipValueFormatter ? (v) => tooltipValueFormatter(v) : undefined}
              />
            );
          }}
        />
        <Area
          type={CHART_STYLE.curveType}
          dataKey={dataKey}
          stroke={lineColor}
          strokeWidth={CHART_STYLE.strokeWidth}
          fill={`url(#${gradId})`}
          dot={false}
          activeDot={{
            r: CHART_STYLE.dotActiveRadius,
            fill: lineColor,
            stroke: '#0F172A',
            strokeWidth: 2,
          }}
          isAnimationActive
          animationDuration={CHART_STYLE.animDuration}
          animationEasing={CHART_STYLE.animEasing}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
