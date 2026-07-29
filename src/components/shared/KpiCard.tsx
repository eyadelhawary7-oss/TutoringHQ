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

/* success has no §4 slot — see BUILD-AFTER-REDESIGN.md F4 — so it keeps the
   existing --color-success until that is decided. warning and danger move onto
   brass and danger, which §4 does define; they were Tailwind's amber-500 and
   red-500, neither of which is in the palette. */
const TONE_CLASS: Record<KpiTone, string> = {
  muted: 'text-[var(--color-text-muted)]',
  success: 'text-[var(--color-success)]',
  warning: 'text-[var(--color-brass)]',
  danger: 'text-[var(--color-danger)]',
};

/**
 * The KPI tile, to the merged design's spec:
 *   .kpi { background:#FFFDF8; border:1px solid #E2DDD1; border-radius:12px; padding:12px 16px }
 *   .kl  { font-size:11px; color:#80827A }
 *   .kv  { font-size:17px; font-weight:700; margin-top:4px; font-variant-numeric:tabular-nums }
 *
 * It used to be a borderless tile on surface-2 with an 18px value. The border
 * and the panel background are what make it read as a card on paper.
 *
 * Radius is 12px — radius-md, §3's "cards, rows, the default".
 * Merged-Center-Home and Merged-Center-Groups both draw this tile at 12;
 * Merged-Center-Students draws the same tile at 16. Both sit on the §3 scale, so
 * the token layer could not flag the difference. Logged for the Students PR to
 * settle deliberately — this component does not get forked to carry both.
 */
export default function KpiCard({ label, title, value, subLabel, delta, tone = 'muted' }: KpiCardProps) {
  const labelText = label ?? title ?? '';
  const sub = subLabel ?? delta;
  const toneClass = TONE_CLASS[tone];
  return (
    <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3">
      <p className="text-xs text-[var(--color-text-muted)]">{labelText}</p>
      <p className="num mt-1 text-lg font-bold leading-tight text-[var(--color-text-primary)]">{value}</p>
      {sub != null && (
        typeof sub === 'string' || typeof sub === 'number'
          ? <p className={`mt-1 text-xs ${toneClass}`}>{sub}</p>
          : <div className="mt-1">{sub}</div>
      )}
    </div>
  );
}
