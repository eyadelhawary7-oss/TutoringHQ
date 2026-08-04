'use client';

import { useLocale } from 'next-intl';

/**
 * The `.kick` eyebrow (design L126-128). Arabic drops the uppercase transform
 * and the wide tracking — Arabic has no case, and .11em tracking breaks the
 * joins — so it renders at 12px with .02em instead.
 *
 * `tone` picks the colour the design gives the eyebrow on each screen: brass on
 * the landing page and pricing, accent on /centers, brass again on /teachers.
 */
export default function Kicker({
  children,
  tone = 'brass',
}: {
  children: React.ReactNode;
  tone?: 'brass' | 'accent';
}) {
  const isAr = useLocale() === 'ar';
  return (
    <div
      className="mb-3 font-bold"
      style={{
        fontSize: isAr ? 12 : 11,
        letterSpacing: isAr ? '.02em' : '.11em',
        textTransform: isAr ? 'none' : 'uppercase',
        color: tone === 'accent' ? 'var(--color-accent)' : 'var(--color-brass)',
      }}
    >
      {children}
    </div>
  );
}
