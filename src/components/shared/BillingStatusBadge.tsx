'use client';

interface BillingStatusBadgeProps {
  status: string;
  nextDue: string;
}

export default function BillingStatusBadge({ status, nextDue }: BillingStatusBadgeProps) {
  if (status === 'paid') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
        <span>✓</span> Paid
      </span>
    );
  }
  const now = new Date();
  const due = nextDue ? new Date(nextDue) : now;
  const daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (status === 'active' && daysUntilDue > 7) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
        <span>✓</span> Paid
      </span>
    );
  }
  if (status === 'active' && daysUntilDue <= 7 && daysUntilDue > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
        <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Due Soon
      </span>
    );
  }
  if (daysUntilDue <= 0 || status === 'overdue') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
        <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Overdue
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] text-xs font-semibold">
      Due
    </span>
  );
}
