'use client';

import { useLocale, useTranslations } from 'next-intl';
import { BarChartComponent } from '@/components/charts';

export interface RevenueByGroupProps {
  data: { group_id: string; group_name: string; amount: number }[];
}

export default function RevenueByGroup({ data = [] }: RevenueByGroupProps) {
  const locale = useLocale();
  const tCommon = useTranslations('common');

  const chartData = data.map((d) => ({
    group_name: d.group_name,
    amount: Number(d.amount) || 0,
  }));

  return (
    <BarChartComponent
      data={chartData}
      dataKey="amount"
      layout="vertical"
      categoryKey="group_name"
      color="teal"
      height={Math.max(200, chartData.length * 36)}
      suffix={` ${tCommon('egp')}`}
      rtl={locale === 'ar'}
    />
  );
}
