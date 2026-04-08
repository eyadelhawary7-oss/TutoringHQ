'use client';

import { AreaChartComponent } from '@/components/charts';

type DataPoint = { month: string; revenue: number };
type Props = { data: DataPoint[]; height?: number };

export function RevenueAreaChart({ data, height = 220 }: Props) {
  if (!data || !Array.isArray(data) || data.length < 2) {
    return (
      <div
        className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm"
        style={{ minHeight: height }}
      >
        {/* empty state — not enough data */}
      </div>
    );
  }

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
