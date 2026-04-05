'use client';

import { useLocale } from 'next-intl';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function formatMonth(monthStr: string, locale: string): string {
  const [y, m] = monthStr.split('-').map(Number);
  const idx = (m ?? 1) - 1;
  if (locale === 'ar') return AR_MONTHS[idx] ?? monthStr;
  const d = new Date(y ?? 0, idx, 1);
  return d.toLocaleString('en-US', { month: 'short' });
}

function linearRegression(points: { x: number; y: number }[]): { slope: number; intercept: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) || 0;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export interface MRRTrendProps {
  data: { month: string; amount: number }[];
}

export default function MRRTrend({ data = [] }: MRRTrendProps) {
  const locale = useLocale();

  if (!data?.length) {
    return (
      <div className="flex items-center justify-center h-[260px] text-[var(--color-text-secondary)]">
        <p className="text-sm">-</p>
      </div>
    );
  }

  const chartData = data.map((d, i) => ({
    ...d,
    label: formatMonth(d.month, locale),
    index: i,
  }));

  const last3 = chartData.slice(-3);
  const points = last3.map((d) => ({ x: d.index, y: d.amount }));
  const { slope, intercept } = linearRegression(points);
  const projectionIndex = chartData.length;
  const projectionValue = Math.max(0, slope * projectionIndex + intercept);

  const lastAmount = chartData[chartData.length - 1]?.amount ?? 0;
  const withProjection = chartData.map((d, i) => ({
    ...d,
    projection: i === chartData.length - 1 ? lastAmount : (null as number | null),
  }));
  withProjection.push({
    month: 'proj',
    amount: 0,
    label: 'التوقع',
    index: projectionIndex,
    projection: projectionValue,
  });

  const hasProjection = chartData.some((d) => d.amount > 0);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={withProjection} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11 }}
          className="fill-muted-foreground"
        />
        <YAxis
          tickFormatter={(v) => v.toLocaleString('en-US')}
          tick={{ fontSize: 11 }}
          className="fill-muted-foreground"
        />
        <Tooltip
          formatter={(v, name) => [
            `${Number(v ?? 0).toLocaleString('en-US')} ج.م`,
            name === 'projection' ? 'التوقع' : '',
          ]}
          labelFormatter={(label) => label}
        />
        <Line
          type="monotone"
          dataKey="amount"
          stroke="#0D9488"
          strokeWidth={2}
          dot={{ r: 4 }}
          connectNulls
          name="actual"
        />
        {hasProjection && (
          <Line
            type="monotone"
            dataKey="projection"
            stroke="#F59E0B"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={{ r: 4 }}
            connectNulls
            name="projection"
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
