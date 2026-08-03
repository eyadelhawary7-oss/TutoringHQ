'use client';

import { SITE } from '@/config/site';

/**
 * The `.mark` + `.wm` pair from design/Merged-Public-Marketing.html — a gradient
 * tile beside the wordmark set in the product face at 17/700/-.02em, one ink
 * colour throughout.
 *
 * The teal "HQ" split and the Bodoni serif that every public screen used before
 * are both struck by the design (it draws a single `--ink` wordmark on all four
 * screens). The serif face itself is NOT removed from the app: `--font-bodoni`
 * still has ~20 callers on login, signup, admin, legal and 404, which this
 * design file does not govern.
 */
export default function Wordmark({ size = 'nav' }: { size?: 'nav' | 'brand' }) {
  const tile = size === 'nav' ? 24 : 22;
  return (
    <>
      <span
        aria-hidden
        className="shrink-0 rounded-lg"
        style={{
          width: tile,
          height: tile,
          backgroundImage: 'var(--gradient-brand-mark)',
        }}
      />
      <span
        className="text-[17px] font-bold tracking-[-0.02em] text-[var(--color-ink)]"
        style={size === 'brand' ? { fontSize: 12 } : undefined}
      >
        {SITE.brandName}
      </span>
    </>
  );
}
