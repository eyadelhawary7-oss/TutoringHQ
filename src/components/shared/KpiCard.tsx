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
  /**
   * Which of the two drawn orders this tile is.
   *
   *   'label-first' (default) — 11px label over a 17px value. The `.kpi` tile
   *     in Merged-Center-Home / Merged-Center-Groups. Every existing call site
   *     is this and is byte-identical to before the prop existed.
   *   'value-first' — a 22px value over a 12px label. The `.tile` in
   *     Merged-Design-Patterns §05, which is a genuinely different tile: it
   *     leads with the number because it sits under a record, not in a KPI row.
   *
   * This is a deliberate two-role component, not a fork. Both roles are the
   * same card on the same tokens with the two lines swapped; two files would
   * drift on the border, the radius and the padding within one PR.
   */
  layout?: 'label-first' | 'value-first';
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
 *
 * `layout="value-first"` is Merged-Design-Patterns §05 `.tile`:
 *   .tile   { #FFFDF8; 1px #E2DDD1; radius 12; padding 12 16 }
 *   .tile .n { 22px / 700; line-height 1 }
 *   .tile .l { 12px; #80827A; margin-top 4 }
 * Same shell, the two lines swapped and re-stepped. This settles the open
 * question the note above flags: one component, two named roles.
 */
export default function KpiCard({
  label,
  title,
  value,
  subLabel,
  delta,
  tone = 'muted',
  layout = 'label-first',
}: KpiCardProps) {
  const labelText = label ?? title ?? '';
  const sub = subLabel ?? delta;
  const toneClass = TONE_CLASS[tone];
  const valueFirst = layout === 'value-first';
  return (
    <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3">
      {valueFirst ? (
        <>
          <p className={`num text-xl font-bold leading-none ${tone === 'muted' ? 'text-[var(--color-text-primary)]' : toneClass}`}>
            {value}
          </p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{labelText}</p>
        </>
      ) : (
        <>
          <p className="text-xs text-[var(--color-text-muted)]">{labelText}</p>
          <p className="num mt-1 text-lg font-bold leading-tight text-[var(--color-text-primary)]">{value}</p>
        </>
      )}
      {sub != null && (
        typeof sub === 'string' || typeof sub === 'number'
          ? <p className={`mt-1 text-xs ${toneClass}`}>{sub}</p>
          : <div className="mt-1">{sub}</div>
      )}
    </div>
  );
}
