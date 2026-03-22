'use client';

interface PaymentStatusBadgeProps {
  status: string;
  confirmed: boolean;
}

export default function PaymentStatusBadge({ status, confirmed }: PaymentStatusBadgeProps) {
  if (confirmed) {
    return (
      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
        Confirmed
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
        Pending
      </span>
    );
  }
  if (status === 'late') {
    return (
      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
        Late Entry
      </span>
    );
  }
  return (
    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">
      {status}
    </span>
  );
}
