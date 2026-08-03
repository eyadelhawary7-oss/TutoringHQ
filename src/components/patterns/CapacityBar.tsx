'use client';

/**
 * The capacity denominator sentinel.
 *
 * `student_groups.max_capacity` is nullable and is set on a minority of live
 * rows. The groups screen already treats 999 as "no cap set" in two places
 * (`max_capacity ?? 999`, then `max_capacity < 999` before showing "/ N"), so
 * the same value means the same thing here rather than rendering a bar that is
 * 2% full against a number nobody typed.
 */
const NO_CAP_SENTINEL = 999;

interface CapacityBarProps {
  value: number;
  /** The cap. Null, 0 or the 999 sentinel means "no cap set" and renders nothing. */
  max: number | null | undefined;
  /**
   * Accessible name for the progressbar. REQUIRED and with no English
   * fallback — a bare "capacity" would ship untranslated.
   */
  label: string;
}

/**
 * The capacity bar, to `Merged-Design-Patterns` §05 `.capbar`.
 *
 *   .capbar    { height 7; #F2EEE5; radius pill; overflow hidden }
 *   .capbar>i  { height 100%; radius pill; #0E6B61 }
 *
 * Brass from 90% up, teal below. §05 draws 80% teal, 90% brass and 100% teal;
 * the 100% frame is a design inconsistency (a full group is not less urgent
 * than a nearly-full one), so the readable rule — "brass when nearly full" —
 * is applied from 90 upward and the 100% frame is logged as a design query
 * rather than a third colour being invented to reproduce it.
 *
 * RETURNS NULL WHEN THERE IS NO CAP. A capacity bar needs a denominator that
 * someone actually set. With no cap this renders nothing at all — not a full
 * bar, not an empty bar, not 0%. Every one of those states is a number the
 * product would be making up, and a made-up "at capacity" is the kind of thing
 * a center makes an enrolment decision on.
 */
export default function CapacityBar({ value, max, label }: CapacityBarProps) {
  if (max == null || max <= 0 || max >= NO_CAP_SENTINEL) return null;

  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const nearlyFull = pct >= 90;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className="h-[7px] overflow-hidden rounded-pill bg-[var(--color-tile)]"
    >
      <div
        className={`h-full rounded-pill ${nearlyFull ? 'bg-[var(--color-brass)]' : 'bg-[var(--color-accent)]'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
