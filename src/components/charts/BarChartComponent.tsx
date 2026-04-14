'use client';

import { useMemo } from 'react';
import { useLocale } from 'next-intl';
import { formatNumber } from '@/lib/formatNumber';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CHART_MARGIN,
  CHART_STYLE,
  LINE_BY_GRADIENT,
  RECHARTS_TOOLTIP_WRAPPER_PROPS,
  type GradientKey,
} from './ChartTokens';
import { ChartTooltip } from './ChartTooltip';

export type BarChartDataPoint = Record<string, string | number | undefined | null>;

export interface BarChartComponentProps {
  data: BarChartDataPoint[];
  dataKey: string;
  xKey?: string;
  /** When `layout` is `vertical`, category labels come from this key (e.g. group name). */
  categoryKey?: string;
  layout?: 'horizontal' | 'vertical';
  color?: GradientKey;
  /** Per-bar colors (overrides `color` when length matches data) */
  barColors?: string[];
  height?: number;
  prefix?: string;
  suffix?: string;
  tooltipValueFormatter?: (value: number) => string;
  xTickFormatter?: (v: string | number) => string;
  yTickFormatter?: (v: number) => string;
  tooltipLabelFormatter?: (v: string | number) => string;
  showYAxis?: boolean;
  radius?: number;
  showGrid?: boolean;
  /** Mirror category axis for Arabic RTL on vertical layout */
  rtl?: boolean;
}

export function BarChartComponent({
  data,
  dataKey,
  xKey = 'date',
  categoryKey,
  layout = 'horizontal',
  color = 'teal',
  barColors,
  height = 200,
  prefix = '',
  suffix = '',
  tooltipValueFormatter,
  xTickFormatter,
  yTickFormatter,
  tooltipLabelFormatter,
  showYAxis = true,
  radius = 6,
  showGrid = true,
  rtl = false,
}: BarChartComponentProps) {
  const locale = useLocale();
  const lineColor = LINE_BY_GRADIENT[color];
  const safeData = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  if (!data || !Array.isArray(data) || data.length < 2) {
    return (
      <div
        className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm"
        style={{ height }}
      >
        {/* empty state — not enough data */}
      </div>
    );
  }

  const barSize = Math.max(8, 32 - safeData.length);
  const cat = categoryKey ?? xKey;

  const margin = {
    ...CHART_MARGIN,
    left: layout === 'vertical' ? 4 : showYAxis ? 4 : CHART_MARGIN.left,
    right: layout === 'vertical' ? 16 : CHART_MARGIN.right,
  };

  const gridVert = layout === 'vertical';

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={safeData}
        layout={layout === 'vertical' ? 'vertical' : 'horizontal'}
        barSize={barSize}
        margin={margin}
      >
        {showGrid ? (
          <CartesianGrid
            stroke={CHART_STYLE.gridColor}
            strokeDasharray="4 4"
            horizontal={!gridVert}
            vertical={gridVert}
          />
        ) : null}
        {layout === 'vertical' ? (
          <>
            <XAxis
              type="number"
              reversed={rtl}
              tick={{ fontSize: 11, fill: CHART_STYLE.tickColor, fontFamily: CHART_STYLE.fontFamily }}
              axisLine={false}
              tickLine={false}
              tickFormatter={
                xTickFormatter
                  ? (v: number | string) => String(xTickFormatter(v))
                  : (v: number | string) => formatNumber(Number(v), locale)
              }
            />
            <YAxis
              type="category"
              dataKey={cat}
              width={layout === 'vertical' ? 120 : 44}
              orientation={rtl ? 'right' : 'left'}
              tick={{ fontSize: 11, fill: CHART_STYLE.tickColor, fontFamily: CHART_STYLE.fontFamily }}
              axisLine={false}
              tickLine={false}
            />
          </>
        ) : (
          <>
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
            ) : null}
          </>
        )}
        <Tooltip
          {...RECHARTS_TOOLTIP_WRAPPER_PROPS}
          cursor={layout === 'vertical' ? { fill: '#1E293B80' } : { fill: '#1E293B80' }}
          content={(props) => {
            const pl = props.payload?.map((p) => ({
              name: String(p.name ?? p.dataKey ?? ''),
              value: Number(p.value ?? 0),
              color: String(lineColor),
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
        <Bar
          dataKey={dataKey}
          radius={layout === 'vertical' ? [0, radius, radius, 0] : [radius, radius, 0, 0]}
          isAnimationActive
          animationDuration={CHART_STYLE.animDuration}
          animationEasing={CHART_STYLE.animEasing}
        >
          {safeData.map((_, index) => (
            <Cell key={index} fill={barColors?.[index] ?? lineColor} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
