'use client';

import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';
import { chartColors } from '@/lib/tokens';

type Props = {
  data: { month: string; revenue: number }[];
  currencySuffix?: string;
};

export function RevenueSparkline({ data, currencySuffix = 'EGP' }: Props) {
  if (!data || data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={56}>
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="sparkGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={chartColors.primary} stopOpacity={0.25} />
            <stop offset="95%" stopColor={chartColors.primary} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Tooltip
          contentStyle={{
            background: chartColors.tooltip.bg,
            border: `1px solid ${chartColors.grid}`,
            borderRadius: 8,
            color: chartColors.tooltip.text,
            fontSize: 12,
          }}
          formatter={(value: number | string | undefined) => [
            `${Number(value ?? 0).toLocaleString('en-US')} ${currencySuffix}`,
            '',
          ]}
          labelFormatter={() => ''}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke={chartColors.primary}
          strokeWidth={2}
          fill="url(#sparkGradient)"
          dot={false}
          activeDot={{ r: 4, fill: chartColors.primary }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
