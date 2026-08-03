'use client';

export interface Segment {
  id: string;
  label: React.ReactNode;
}

interface SegmentedControlProps {
  segments: Segment[];
  value: string;
  onChange: (id: string) => void;
  /**
   * Accessible name for the tablist. REQUIRED and with no English fallback —
   * a default here is an untranslated string that ships silently.
   */
  label: string;
}

/**
 * The segmented control, to `Merged-Design-Patterns` §05 `.seg`.
 *
 *   .seg      { row; #F2EEE5; radius 12; padding 4; gap 4 }
 *   .seg .s   { flex 1; centred; 13px/600; #5D635C; padding 8 0; radius 8 }
 *   .seg .s.on{ #FFFDF8; #0A514A; shadow 0 1px 2px rgba(28,33,30,.06) }
 *
 * The drawn use is `Members / Waitlist · N`. A count belongs in the segment's
 * own label — formatted through `formatNumber`, never interpolated raw — and
 * the segment still renders when that count is zero, because a Waitlist tab
 * that vanishes when empty is a tab whose absence the user has to interpret.
 *
 * Three screens each hand-rolled this control before it existed. It is a
 * primitive so the fourth does not, and so all four agree on what "selected"
 * looks like.
 */
export default function SegmentedControl({ segments, value, onChange, label }: SegmentedControlProps) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 rounded-md bg-[var(--color-tile)] p-1">
      {segments.map((s) => {
        const selected = s.id === value;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(s.id)}
            className={`flex-1 rounded-sm py-2 text-center text-base font-semibold btn-press chq-focus ${
              selected
                ? 'bg-[var(--color-panel)] text-[var(--color-accent-deep)] shadow-[0_1px_2px_rgba(28,33,30,0.06)]'
                : 'text-[var(--color-mid)]'
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
