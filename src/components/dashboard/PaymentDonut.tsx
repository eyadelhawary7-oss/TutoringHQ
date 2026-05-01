'use client';

import { useTranslations, useLocale } from 'next-intl';
import { DonutChart } from '@/components/charts';
import { formatPercent } from '@/lib/formatNumber';

interface PaymentDonutProps {
  paid: number;
  unpaid: number;
  pending?: number;
}

export default function PaymentDonut({ paid, unpaid, pending = 0 }: PaymentDonutProps) {
  const t = useTranslations('dashboard');
  const locale = useLocale();

  const data = [
    { name: t('paid'), value: paid, color: '#0D9488' },
    { name: t('unpaid'), value: unpaid, color: '#EF4444' },
    { name: t('pending'), value: pending, color: '#F59E0B' },
  ];

  const total = paid + unpaid + pending;
  const paidPct = total > 0 ? Math.round((paid / total) * 100) : 0;

  return (
    <DonutChart
      data={data}
      height={250}
      innerRadius={55}
      outerRadius={90}
      centerValue={formatPercent(paidPct, locale)}
    />
  );
}
