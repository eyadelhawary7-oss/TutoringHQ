'use client';

import { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useLocale, useTranslations } from 'next-intl';
import { formatNumber } from '@/lib/formatNumber';
import { CHART_MARGIN, CHART_STYLE } from './ChartTokens';
import { ChartTooltip } from './ChartTooltip';
import { colors } from '@/lib/tokens';

export type MultiLineDataPoint = Record<string, string | number | undefined | null>;

export interface LineSeries {
  dataKey: string;
  label: string;
  color: string;
}

export interface MultiLineChartProps {
  data: MultiLineDataPoint[];
  series: LineSeries[];
  xKey?: string;
  height?: number;
  prefix?: string;
  suffix?: string;
  xTickFormatter?: (v: string | number) => string;
  yTickFormatter?: (v: number) => string;
  tooltipLabelFormatter?: (v: string | number) => string;
  showLegend?: boolean;
}

export function MultiLineChart({
  data,
  series,
  xKey = 'date',
  height = 200,
  prefix = '',
  suffix = '',
  xTickFormatter,
  yTickFormatter,
  tooltipLabelFormatter,
  showLegend = true,
}: MultiLineChartProps) {
  const locale = useLocale();
  const t = useTranslations('charts');
  const safeData = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  if (!safeData.length || safeData.length < 2 || !series.length) {
    return (
      <div
        className="flex flex-col items-center justify-center text-center px-4"
        style={{ height, color: 'var(--color-text-muted)', fontSize: 13, fontFamily: CHART_STYLE.fontFamily }}
      >
        <p>{t('noData')}</p>
        <p className="mt-1 text-xs opacity-80 max-w-xs">{t('noDataSub')}</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      {/* RTL-EXEMPT: Recharts margin prop uses physical keys only */}
      <LineChart data={safeData} margin={{ ...CHART_MARGIN, left: 4 }}>
        <CartesianGrid stroke={CHART_STYLE.gridColor} strokeDasharray="4 4" vertical={false} />
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
        <YAxis
          width={44}
          tick={{ fontSize: 11, fill: CHART_STYLE.tickColor, fontFamily: CHART_STYLE.fontFamily }}
          axisLine={false}
          tickLine={false}
          tickFormatter={
            yTickFormatter
              ? (v: number | string) => yTickFormatter(Number(v))
              : (v: number | string) => formatNumber(Number(v), locale)
          }
        />
        <Tooltip
          cursor={{ stroke: CHART_STYLE.axisColor, strokeWidth: 1, strokeDasharray: '4 4' }}
          content={(props) => {
            const pl = props.payload?.map((p) => ({
              name: String(p.name ?? p.dataKey ?? ''),
              value: Number(p.value ?? 0),
              color: String(p.stroke ?? colors.navy[400]),
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
              />
            );
          }}
        />
        {showLegend ? (
          <Legend
            wrapperStyle={{ fontFamily: CHART_STYLE.fontFamily, fontSize: 11, color: colors.navy[400] }}
          />
        ) : null}
        {series.map((s) => (
          <Line
            key={s.dataKey}
            type={CHART_STYLE.curveType}
            dataKey={s.dataKey}
            name={s.label}
            stroke={s.color}
            strokeWidth={CHART_STYLE.strokeWidth}
            dot={false}
            activeDot={{ r: CHART_STYLE.dotActiveRadius, stroke: colors.navy[900], strokeWidth: 2, fill: s.color }}
            isAnimationActive
            animationDuration={CHART_STYLE.animDuration}
            animationEasing={CHART_STYLE.animEasing}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
