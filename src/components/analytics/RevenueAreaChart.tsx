'use client';

import { useLocale } from 'next-intl';
import { formatCurrency, formatNumber } from '@/lib/formatNumber';
import { AreaChartComponent } from '@/components/charts';

type DataPoint = { month: string; revenue: number };
type Props = { data: DataPoint[]; height?: number };

function formatMonthAxisLabel(label: string | number, locale: string): string {
  const s = String(label).trim();
  const m = s.match(/^(.+?)\s+(\d{4})$/);
  if (m) {
    const yearNum = Number(m[2]);
    if (Number.isFinite(yearNum)) {
      return `${m[1]} ${formatNumber(yearNum, locale)}`;
    }
  }
  return s;
}

export function RevenueAreaChart({ data, height = 220 }: Props) {
  const locale = useLocale();

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
      prefix=""
      suffix=""
      xTickFormatter={(v) => formatMonthAxisLabel(v, locale)}
      yTickFormatter={(v) => formatCurrency(v, locale)}
      tooltipValueFormatter={(v) => formatCurrency(v, locale)}
    />
  );
}
