'use client';

export type KpiTone = 'muted' | 'success' | 'warning' | 'danger';

interface KpiCardProps {
  /** Canonical label prop. `title` is accepted as a back-compat alias. */
  label?: string;
  title?: string;
  value: React.ReactNode;
  /** Sub-label / delta. Strings get tone color; nodes render as-is. `delta` is an alias. */
  subLabel?: React.ReactNode;
  delta?: React.ReactNode;
  /** Tone for string sub-label / delta. Defaults to muted. */
  tone?: KpiTone;
}

const TONE_CLASS: Record<KpiTone, string> = {
  muted: 'text-[var(--color-text-muted)]',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
  danger: 'text-red-500',
};

export default function KpiCard({ label, title, value, subLabel, delta, tone = 'muted' }: KpiCardProps) {
  const labelText = label ?? title ?? '';
  const sub = subLabel ?? delta;
  const toneClass = TONE_CLASS[tone];
  return (
    <div className="bg-[var(--color-surface-2)] rounded-lg p-4">
      <p className="text-xs text-[var(--color-text-muted)]">{labelText}</p>
      <p className="text-xl md:text-2xl font-medium mt-1 text-[var(--color-text-primary)] leading-tight">{value}</p>
      {sub != null && (
        typeof sub === 'string' || typeof sub === 'number'
          ? <p className={`text-[11px] mt-1 ${toneClass}`}>{sub}</p>
          : <div className="mt-1">{sub}</div>
      )}
    </div>
  );
}
