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
import { useTranslations } from 'next-intl';
import { CHART_MARGIN, CHART_STYLE, LINE_BY_GRADIENT, type GradientKey } from './ChartTokens';
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
  xTickFormatter?: (v: string | number) => string;
  yTickFormatter?: (v: number) => string;
  tooltipLabelFormatter?: (v: string | number) => string;
  showGrid?: boolean;
  showYAxis?: boolean;
}

export function AreaChartComponent({
  data,
  dataKey,
  xKey = 'date',
  color = 'teal',
  height = 200,
  prefix = '',
  suffix = '',
  xTickFormatter,
  yTickFormatter,
  tooltipLabelFormatter,
  showGrid = false,
  showYAxis = true,
}: AreaChartComponentProps) {
  const t = useTranslations('charts');
  const baseId = useId().replace(/:/g, '');
  const gradId = `area-grad-${color}-${baseId}`;
  const lineColor = LINE_BY_GRADIENT[color];

  const safeData = useMemo(() => (Array.isArray(data) ? data : []), [data]);

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
            width={44}
            tick={{ fontSize: 11, fill: CHART_STYLE.tickColor, fontFamily: CHART_STYLE.fontFamily }}
            axisLine={false}
            tickLine={false}
            tickFormatter={
              yTickFormatter
                ? (v: number | string) => yTickFormatter(Number(v))
                : (v: number | string) => Number(v).toLocaleString('en-US')
            }
          />
        ) : null}
        <Tooltip
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
