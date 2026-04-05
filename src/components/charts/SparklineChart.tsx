'use client';

import { useId, useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { CHART_STYLE, LINE_BY_GRADIENT, type GradientKey } from './ChartTokens';

export interface SparklinePoint {
  value: number;
}

export interface SparklineChartProps {
  data: SparklinePoint[];
  color?: GradientKey;
  height?: number;
}

const SPARK_MARGIN = { top: 2, right: 2, bottom: 2, left: 2 };

export function SparklineChart({ data, color = 'teal', height = 48 }: SparklineChartProps) {
  const baseId = useId().replace(/:/g, '');
  const gradId = `spark-${color}-${baseId}`;
  const lineColor = LINE_BY_GRADIENT[color];

  const safe = useMemo(
    () => (Array.isArray(data) ? data.map((d) => ({ value: Number(d.value) || 0 })) : []),
    [data],
  );

  if (safe.length < 2) {
    return <div style={{ height }} aria-hidden />;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={safe} margin={SPARK_MARGIN}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity={0.2} />
            <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type={CHART_STYLE.curveType}
          dataKey="value"
          stroke={lineColor}
          strokeWidth={1.5}
          fill={`url(#${gradId})`}
          dot={false}
          isAnimationActive
          animationDuration={800}
          animationEasing={CHART_STYLE.animEasing}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
