'use client';

import { useMemo } from 'react';
import { useLocale } from 'next-intl';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatNumber } from '@/lib/formatNumber';
import { CHART_COLORS, CHART_STYLE, RECHARTS_TOOLTIP_WRAPPER_PROPS } from './ChartTokens';
import { ChartTooltip } from './ChartTooltip';

const DEFAULT_PALETTE = [
  CHART_COLORS.teal,
  CHART_COLORS.amber,
  CHART_COLORS.purple,
  CHART_COLORS.green,
  CHART_COLORS.red,
  CHART_COLORS.slate,
];

export interface DonutSlice {
  name: string;
  value: number;
  color?: string;
}

export interface DonutChartProps {
  data: DonutSlice[];
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
  prefix?: string;
  suffix?: string;
  /** Tooltip value line (overrides prefix + number + suffix). */
  tooltipValueFormatter?: (value: number) => string;
  centerLabel?: string;
  centerValue?: string | number;
  /** Recharts <text> fill for the center amount (theme-aware). */
  centerValueFill?: string;
  /** Recharts <text> fill for the center caption (e.g. “Collected”). */
  centerLabelFill?: string;
}

export function DonutChart({
  data,
  height = 220,
  innerRadius = 55,
  outerRadius = 80,
  prefix = '',
  suffix = '',
  tooltipValueFormatter,
  centerLabel,
  centerValue,
  centerValueFill = 'var(--color-text-primary)',
  centerLabelFill = 'var(--color-text-secondary)',
}: DonutChartProps) {
  const locale = useLocale();
  const chartData = useMemo(() => {
    const rows = (data ?? []).map((d, i) => ({
      name: d.name,
      value: Number(d.value) || 0,
      color: d.color ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
    }));
    return rows.filter((r) => r.value > 0);
  }, [data]);

  const sum = chartData.reduce((s, r) => s + r.value, 0);

  const emptyState = (
    <div
      className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm"
      style={{ height }}
    >
      {/* L10: a visible, intentional empty state — never a blank/empty SVG */}
      <span aria-hidden>—</span>
    </div>
  );

  if (!data || !Array.isArray(data) || data.length < 2) {
    return emptyState;
  }

  if (!chartData.length || sum <= 0) {
    return emptyState;
  }

  const centerValStr =
    centerValue !== undefined && centerValue !== null
      ? typeof centerValue === 'number'
        ? formatNumber(centerValue, locale)
        : centerValue
      : '';

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          paddingAngle={3}
          dataKey="value"
          nameKey="name"
          startAngle={90}
          endAngle={-270}
          stroke="none"
          isAnimationActive
          animationDuration={CHART_STYLE.animDuration}
          animationEasing={CHART_STYLE.animEasing}
        >
          {chartData.map((entry, i) => (
            <Cell key={entry.name + i} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          {...RECHARTS_TOOLTIP_WRAPPER_PROPS}
          content={(props) => {
            const pl = props.payload?.map((p) => {
              const row = p.payload as { name?: string; value?: number; color?: string };
              return {
                name: String(p.name ?? row?.name ?? ''),
                value: Number(p.value ?? row?.value ?? 0),
                color: String(row?.color ?? DEFAULT_PALETTE[0]),
                dataKey: 'value',
              };
            });
            return (
              <ChartTooltip
                active={props.active}
                payload={pl}
                label={props.label}
                prefix={prefix}
                suffix={suffix}
                valueFormatter={tooltipValueFormatter ? (v) => tooltipValueFormatter(v) : undefined}
              />
            );
          }}
        />
        {centerValStr || centerLabel ? (
          <>
            <text
              className="recharts-text"
              x="50%"
              y={centerLabel ? '46%' : '50%'}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={centerValueFill}
              fontSize={20}
              fontWeight={700}
              style={{ fontFamily: CHART_STYLE.fontFamily }}
            >
              {centerValStr ? `${prefix}${centerValStr}${suffix}` : ''}
            </text>
            {centerLabel ? (
              <text
                className="recharts-text"
                x="50%"
                y="58%"
                textAnchor="middle"
                dominantBaseline="middle"
                fill={centerLabelFill}
                fontSize={11}
                style={{ fontFamily: CHART_STYLE.fontFamily }}
              >
                {centerLabel}
              </text>
            ) : null}
          </>
        ) : null}
      </PieChart>
    </ResponsiveContainer>
  );
}
