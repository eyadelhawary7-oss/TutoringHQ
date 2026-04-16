'use client';

import { AreaChartComponent } from '@/components/charts';

interface AttendanceTrendProps {
  data: { date: string; count: number }[];
}

export default function AttendanceTrend({ data }: AttendanceTrendProps) {
  if (!data || !Array.isArray(data) || data.length < 2) {
    return (
      <div className="flex items-center justify-center h-full min-h-[250px] text-[var(--color-text-muted)] text-sm">
        {/* empty state - not enough data */}
      </div>
    );
  }

  return (
    <AreaChartComponent
      data={data as Record<string, string | number>[]}
      dataKey="count"
      xKey="date"
      color="teal"
      height={250}
      showGrid={false}
    />
  );
}
