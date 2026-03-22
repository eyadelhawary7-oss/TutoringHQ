'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { chartColors } from '@/lib/tokens';

type DataPoint = { month: string; revenue: number };
type Props = { data: DataPoint[]; height?: number };

export function RevenueAreaChart({ data, height = 220 }: Props) {
  if (!data?.length) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={chartColors.primary} stopOpacity={0.25} />
            <stop offset="95%" stopColor={chartColors.primary} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
        <XAxis
          dataKey="month"
          stroke={chartColors.tick}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          stroke={chartColors.tick}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => v.toLocaleString('en-US')}
        />
        <Tooltip
          contentStyle={{
            background: chartColors.tooltip.bg,
            border: `1px solid ${chartColors.grid}`,
            borderRadius: 8,
            color: chartColors.tooltip.text,
            fontSize: 12,
          }}
          formatter={(v: number | string | undefined) => [
            `${Number(v ?? 0).toLocaleString('en-US')} EGP`,
            '',
          ]}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke={chartColors.primary}
          strokeWidth={2}
          fill="url(#revenueGrad)"
          dot={false}
          activeDot={{ r: 4, fill: chartColors.primary }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
