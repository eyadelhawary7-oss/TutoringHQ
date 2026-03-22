'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { chartColors } from '@/lib/tokens';

type Slice = { name: string; value: number; color: string };
type Props = { data: Slice[]; height?: number };

export function PaymentDonutChart({ data, height = 200 }: Props) {
  if (!data?.length) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={80}
          paddingAngle={3}
          dataKey="value"
          nameKey="name"
        >
          {data.map((entry, i) => (
            <Cell key={entry.name + i} fill={entry.color} />
          ))}
        </Pie>
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
      </PieChart>
    </ResponsiveContainer>
  );
}
