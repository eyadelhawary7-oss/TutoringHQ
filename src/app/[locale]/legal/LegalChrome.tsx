import { Link } from '@/i18n/routing';
import LocaleSwitchPill from './LocaleSwitchPill';

/**
 * `Merged-Public-Legal` §01 — the `.appbar` every legal screen opens with: a
 * 40x40 back tile, a title block, and (on the index and the four readers only)
 * the locale pill.
 *
 * No `'use client'` on purpose — the server doc pages and the client form page
 * both render this, so it must be usable from either.
 *
 * The back control is a `Link` to a fixed destination, not `router.back()`.
 * `router.back()` can walk a user who arrived from a signup consent checkbox
 * straight off the site, and the design's own footer button names a fixed
 * destination ("Back to all documents"), so the header matches it.
 *
 * The chevron direction is chosen from `locale`, not mirrored with a CSS
 * transform: a transform would also flip the stroke joins, and the design draws
 * two genuinely different paths for the two directions.
 */

const CHEVRON_LTR = 'M15 18l-6-6 6-6';
const CHEVRON_RTL = 'M9 18l6-6-6-6';
const CLOSE = 'M18 6L6 18M6 6l12 12';

export default function LegalChrome({
  locale,
  backHref,
  backIcon = 'chevron',
  backLabel,
  title,
  subtitle,
  showGlobe = false,
}: {
  locale: string;
  backHref: string;
  backIcon?: 'chevron' | 'x';
  backLabel: string;
  title: string;
  subtitle?: string;
  showGlobe?: boolean;
}) {
  const isAr = locale === 'ar' || locale.startsWith('ar-');
  const d = backIcon === 'x' ? CLOSE : isAr ? CHEVRON_RTL : CHEVRON_LTR;

  return (
    <div className="flex flex-shrink-0 items-center gap-2 px-4 pb-3 pt-1">
      <Link
        href={backHref}
        aria-label={backLabel}
        className="chq-focus flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] text-[var(--color-ink-body)] transition-colors hover:bg-[var(--color-tile)]"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d={d} />
        </svg>
      </Link>

      <div className="min-w-0">
        <h1 className="text-[17px] font-bold leading-[1.15] text-[var(--color-ink)]">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-[11px] text-[var(--color-muted)]">{subtitle}</p>
        ) : null}
      </div>

      {showGlobe ? <LocaleSwitchPill locale={locale} /> : null}
    </div>
  );
}
