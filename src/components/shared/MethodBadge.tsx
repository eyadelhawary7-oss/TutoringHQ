'use client';

const labels: Record<string, string> = {
  cash: 'Cash',
  instapay: 'InstaPay',
  vodafone_cash: 'Vodafone',
  vodacash: 'Vodafone',
  orange_cash: 'Orange',
  orange: 'Orange',
  fawry: 'Fawry',
  bank_transfer: 'Bank Transfer',
  bank: 'Bank Transfer',
};

const colors: Record<string, string> = {
  cash: 'bg-green-100 text-green-700',
  instapay: 'bg-blue-100 text-blue-700',
  vodafone_cash: 'bg-red-100 text-red-700',
  vodacash: 'bg-red-100 text-red-700',
  orange_cash: 'bg-orange-100 text-orange-700',
  orange: 'bg-orange-100 text-orange-700',
  fawry: 'bg-purple-100 text-purple-700',
  bank_transfer: 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)]',
  bank: 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)]',
};

export default function MethodBadge({ method }: { method: string }) {
  const key = method?.toLowerCase() ?? 'cash';
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${colors[key] ?? 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)]'}`}
    >
      {labels[key] ?? method ?? '—'}
    </span>
  );
}
