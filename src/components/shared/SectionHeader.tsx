'use client';

interface SectionHeaderProps {
  title: string;
  /** Optional one-line qualifier under the title — the design's `.sub`. */
  sub?: string;
}

/**
 * Section header, to the merged design's spec:
 *   .sec { font-size:15px; font-weight:700; margin:12px 4px 4px }
 *   .sub { font-size:12px; color:#80827A; margin:0 4px 8px }
 *
 * It used to be an 11px muted medium label, which read as a caption rather than
 * a heading and left the dense screens with no hierarchy. 15px is `text-md`, the
 * step §2 added for exactly this role.
 *
 * The 4px inline margin in the design is the phone frame's optical alignment
 * against a 16px gutter. Screens here set their own gutter, so that part is not
 * reproduced — the block rhythm is.
 */
export default function SectionHeader({ title, sub }: SectionHeaderProps) {
  return (
    <div className="mt-3 mb-1">
      <p className="text-md font-bold text-[var(--color-text-primary)]">{title}</p>
      {sub ? <p className="mt-1 text-sm text-[var(--color-text-muted)]">{sub}</p> : null}
    </div>
  );
}
