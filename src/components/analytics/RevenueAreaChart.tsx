'use client';

import { AreaChartComponent } from '@/components/charts';

type DataPoint = { month: string; revenue: number };
type Props = { data: DataPoint[]; height?: number };

export function RevenueAreaChart({ data, height = 220 }: Props) {
  return (
    <AreaChartComponent
      data={data as Record<string, string | number | undefined>[]}
      dataKey="revenue"
      xKey="month"
      color="teal"
      height={height}
      prefix="EGP "
    />
  );
}
