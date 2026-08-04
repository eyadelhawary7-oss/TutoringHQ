'use client';

/**
 * The `.tot` closer under a stack of rows, in the design's two forms:
 *  - `variant="hairline"` (design L216-221) — the landing page's paired object,
 *    a rule with the label and total sitting on the page.
 *  - `variant="filled"` (design L359-364) — the audience pages, a solid
 *    `--ground` (or brass on /teachers) block that ends the proof stack.
 */
export default function TotalBar({
  label,
  value,
  variant = 'hairline',
  tone = 'center',
}: {
  label: string;
  value: string;
  variant?: 'hairline' | 'filled';
  tone?: 'center' | 'teacher';
}) {
  if (variant === 'filled') {
    return (
      <div
        className="mt-2 flex items-baseline justify-between gap-2 rounded-xl p-4"
        style={{
          backgroundColor: tone === 'teacher' ? 'var(--color-brass)' : 'var(--color-ground)',
          color: 'var(--color-paper)',
        }}
      >
        <span className="text-[11px]" style={{ color: 'rgba(236,232,223,.72)' }}>
          {label}
        </span>
        <span className="mkt-mono text-[22px] text-white">{value}</span>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-[var(--color-hairline)] pt-3">
      <span className="text-[11px] font-bold uppercase tracking-[.06em] text-[var(--color-muted)] rtl:normal-case rtl:tracking-[.02em]">
        {label}
      </span>
      <span className="mkt-mono text-[17px] text-[var(--color-ink)]">{value}</span>
    </div>
  );
}
