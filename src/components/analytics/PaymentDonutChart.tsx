'use client';

import { useLocale } from 'next-intl';
import { formatCurrency } from '@/lib/formatNumber';
import { DonutChart } from '@/components/charts';

type Slice = { name: string; value: number; color: string };
type Props = { data: Slice[]; height?: number };

export function PaymentDonutChart({ data, height = 200 }: Props) {
  const locale = useLocale();
  return (
    <DonutChart
      data={data}
      height={height}
      innerRadius={55}
      outerRadius={80}
      prefix=""
      suffix=""
      tooltipValueFormatter={(v) => formatCurrency(v, locale)}
    />
  );
}
