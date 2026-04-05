'use client';

import { SparklineChart } from '@/components/charts';

type Props = {
  data: { month: string; revenue: number }[];
  currencySuffix?: string;
};

export function RevenueSparkline({ data }: Props) {
  const points = (data ?? []).map((d) => ({ value: Number(d.revenue) || 0 }));
  return <SparklineChart data={points} color="teal" height={120} />;
}
