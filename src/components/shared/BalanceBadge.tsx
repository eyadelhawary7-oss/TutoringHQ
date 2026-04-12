'use client';

import { useLocale } from 'next-intl';
import { formatNumber } from '@/lib/formatNumber';

interface BalanceBadgeProps {
  amount: number;
  currency?: string;
}

export default function BalanceBadge({ amount, currency = 'EGP' }: BalanceBadgeProps) {
  const locale = useLocale();
  if (amount > 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
        {currency} {formatNumber(amount, locale)}
      </span>
    );
  }
  return <span className="text-slate-400">-</span>;
}
