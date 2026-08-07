'use client';

// Two tuition methods only — design/NEW-MODEL.md. An unrecognised value falls
// through to the raw string and the neutral swatch below, which is honest;
// mapping it onto a label would state a method that is not what was stored.
const labels: Record<string, string> = {
  cash: 'Cash',
  instapay: 'InstaPay',
};

const colors: Record<string, string> = {
  cash: 'bg-green-100 text-green-700',
  instapay: 'bg-blue-100 text-blue-700',
};

export default function MethodBadge({ method }: { method: string }) {
  const key = method?.toLowerCase() ?? 'cash';
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${colors[key] ?? 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)]'}`}
    >
      {labels[key] ?? method ?? '-'}
    </span>
  );
}
