'use client';

interface BalanceBadgeProps {
  amount: number;
  currency?: string;
}

export default function BalanceBadge({ amount, currency = 'EGP' }: BalanceBadgeProps) {
  if (amount > 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
        {currency} {amount.toLocaleString()}
      </span>
    );
  }
  return <span className="text-slate-400">—</span>;
}
