'use client';

export interface DiffRow {
  /** Stable key for React. */
  id: string;
  label: string;
  /** Already-formatted value — a figure through `formatNumber`, or a word. */
  value: string;
  /** `yes` → accent, `no` → faint. Omit for the ordinary ink reading. */
  tone?: 'yes' | 'no';
  /** Word values drop the mono face; figures keep it. */
  plain?: boolean;
}

/**
 * The `.diffs` block inside a `/pricing` readout (design L1938-1941, styled at
 * L518-530): a brass eyebrow over a hairline-divided list of key → value rows
 * that re-render as the capacity chips move.
 *
 * The design's own row set is five entries (students, WhatsApp notifications a
 * month, branches, team seats, advanced analytics) and its own script comment
 * says three of them — `wa`, `br`, `st` — "have NO source in the database …
 * PROPOSALS for Eyad to set or reject." Callers therefore pass only the rows
 * they can source live; this component renders nothing at all rather than an
 * empty eyebrow when a caller has none.
 */
export default function DiffRows({ heading, rows }: { heading: string; rows: DiffRow[] }) {
  if (rows.length === 0) return null;

  return (
    <div className="mt-3 border-t border-[var(--color-hairline)] pt-4">
      <div className="mb-1 text-[11px] font-bold uppercase tracking-[.09em] text-[var(--color-brass)] rtl:normal-case rtl:tracking-[.02em]">
        {heading}
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex items-center justify-between gap-3 border-b border-[var(--color-hairline)] py-3 last:border-b-0"
        >
          <span className="text-xs leading-[1.35] text-[var(--color-mid)]">{row.label}</span>
          <span
            className={`shrink-0 whitespace-nowrap text-end text-xs ${
              row.plain ? 'font-medium' : 'mkt-mono'
            }`}
            style={{
              color:
                row.tone === 'yes'
                  ? 'var(--color-accent)'
                  : row.tone === 'no'
                    ? 'var(--color-faint)'
                    : 'var(--color-ink)',
              fontWeight: row.tone === 'no' ? 400 : undefined,
            }}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}
