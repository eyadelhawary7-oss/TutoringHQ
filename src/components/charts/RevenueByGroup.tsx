'use client';

import { useLocale } from 'next-intl';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const TEAL = '#0D9488';

export interface RevenueByGroupProps {
  data: { group_id: string; group_name: string; amount: number }[];
}

export default function RevenueByGroup({ data = [] }: RevenueByGroupProps) {
  const locale = useLocale();
  const isRTL = locale === 'ar';

  if (!data?.length) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground">
        <p className="text-sm">—</p>
      </div>
    );
  }

  const chartData = data.map((d) => ({
    ...d,
    amount: Number(d.amount),
    label: d.group_name,
  }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 36)}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v) => v.toLocaleString('en-US')}
          tick={{ fontSize: 11 }}
          className="fill-muted-foreground"
          reversed={isRTL}
        />
        <YAxis
          type="category"
          dataKey="group_name"
          width={120}
          tick={{ fontSize: 11 }}
          className="fill-muted-foreground"
          orientation={isRTL ? 'right' : 'left'}
        />
        <Tooltip
          formatter={(v) => [`${Number(v ?? 0).toLocaleString('en-US')} ج.م`, 'المبلغ']}
          labelFormatter={(label) => label}
        />
        <Bar dataKey="amount" fill={TEAL} radius={[0, 4, 4, 0]} barSize={24}>
          {chartData.map((_, i) => (
            <Cell key={i} fill={TEAL} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
