'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatCurrency } from '@/lib/formatNumber';
import { BarChartComponent } from '@/components/charts';

export interface RevenueByGroupProps {
  data: { group_id: string; group_name: string; amount: number }[];
}

export default function RevenueByGroup({ data = [] }: RevenueByGroupProps) {
  const locale = useLocale();
  const tAnalytics = useTranslations('analytics');

  if (!data || !Array.isArray(data) || data.length < 2) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px] text-[var(--color-text-muted)] text-sm">
        {/* empty state - not enough data */}
      </div>
    );
  }

  const legacyEmptyGroup = (name: string) =>
    name === '-' || name === '' || name === String.fromCharCode(0x2014);

  const chartData = data.map((d) => ({
    group_name:
      d.group_id === 'ungrouped' ? (legacyEmptyGroup(d.group_name) ? '-' : tAnalytics('noGroup')) : d.group_name,
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
      prefix=""
      suffix=""
      xTickFormatter={(v) => formatCurrency(Number(v), locale)}
      tooltipValueFormatter={(v) => formatCurrency(v, locale)}
      rtl={locale === 'ar'}
    />
  );
}
