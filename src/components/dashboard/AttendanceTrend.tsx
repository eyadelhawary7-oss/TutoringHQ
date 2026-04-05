'use client';

import { AreaChartComponent } from '@/components/charts';

interface AttendanceTrendProps {
  data: { date: string; count: number }[];
}

export default function AttendanceTrend({ data }: AttendanceTrendProps) {
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
