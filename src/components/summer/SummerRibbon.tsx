'use client';

// Summer 2026 sticky announcement ribbon — sits above the nav on the public
// landing pages. Two phases, never empty (free-for-all → evergreen trial), switches
// automatically at SUMMER_FREE_UNTIL. Per-portal accent (forest green for centers/
// combined, bronze gold for teachers) and the site's serif display face. No code
// chip (summer mode is automatic). Hidden entirely when the master switch is off.

import { getSummerCopy, summerAccent, type SummerPortal } from '@/lib/summer/copy';
import { useSummerPublicConfig, formatFloorLabel } from '@/components/summer/useSummerPublicConfig';

interface Props {
  locale: string;
  portal: SummerPortal;
  /** Where "start free" points (defaults to the plan picker / signup). */
  ctaHref?: string;
}

export default function SummerRibbon({ locale, portal, ctaHref = '/pricing' }: Props) {
  const state = useSummerPublicConfig();
  if (!state) return null;

  const isAr = locale === 'ar';
  const loc = isAr ? 'ar' : 'en';
  const copy = getSummerCopy(portal, state.phase, loc, {
    floorLabel: formatFloorLabel(state.summer.firstChargeFloor, loc),
    trialDays: state.summer.trialDays,
  });
  const accent = summerAccent(portal);

  return (
    <div
      className="sticky top-0 z-50 w-full px-4 py-2 text-center text-sm text-white"
      style={{ backgroundColor: accent }}
      dir={isAr ? 'rtl' : 'ltr'}
      role="status"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <span className="font-semibold" style={{ fontFamily: 'var(--font-playfair), Georgia, serif' }}>
          {copy.ribbon}
        </span>
        <a
          href={ctaHref}
          className="ms-2 inline-flex items-center rounded-full bg-white/95 px-3 py-1 text-xs font-semibold hover:bg-white"
          style={{ color: accent }}
        >
          {copy.ribbonCta}
        </a>
      </div>
    </div>
  );
}
