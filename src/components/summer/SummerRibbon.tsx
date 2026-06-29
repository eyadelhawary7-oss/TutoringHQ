'use client';

// Summer 2026 sticky announcement ribbon — sits above the nav on the public
// landing pages. Matches the approved mock (summer_promo_v2_inbrand.html):
// a 160deg full-strength gradient (forest green for centers/combined, bronze
// gold for teachers), a white Fraunces serif headline + cream sub line, a cream
// CTA, and a dashed code chip that copies the shared marketing code to the
// clipboard. Two phases, never empty; switches automatically at SUMMER_FREE_UNTIL.
// Hidden entirely when the master switch is off. The code is display-only —
// summer mode stays automatic and nothing is gated behind typing it.

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import {
  getSummerCopy,
  summerRibbonGradient,
  summerCtaColors,
  summerChipLabel,
  SUMMER_PROMO_CODE,
  type SummerPortal,
} from '@/lib/summer/copy';
import { useSummerPublicConfig, formatFloorLabel } from '@/components/summer/useSummerPublicConfig';

const FRAUNCES = 'var(--font-fraunces), Georgia, serif';

interface Props {
  locale: string;
  portal: SummerPortal;
  /** Where "start free" points (defaults to the plan picker / signup). */
  ctaHref?: string;
}

export default function SummerRibbon({ locale, portal, ctaHref = '/pricing' }: Props) {
  const state = useSummerPublicConfig();
  const [copied, setCopied] = useState(false);
  if (!state) return null;

  const isAr = locale === 'ar';
  const loc = isAr ? 'ar' : 'en';
  const copy = getSummerCopy(portal, state.phase, loc, {
    floorLabel: formatFloorLabel(state.summer.firstChargeFloor, loc),
    trialDays: state.summer.trialDays,
  });
  const cta = summerCtaColors(portal);
  // Prefer a code set in config; fall back to the shared summer code so the chip
  // always renders (display/marketing only — it never gates the signup flow).
  const code = state.promoCode || SUMMER_PROMO_CODE;

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — chip stays a static display */
    }
  };

  return (
    <div
      className="sticky top-0 z-50 w-full px-4 py-2.5 text-white"
      style={{ backgroundImage: summerRibbonGradient(portal) }}
      dir={isAr ? 'rtl' : 'ltr'}
      role="status"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center sm:justify-between sm:text-start">
        <div className="min-w-0">
          <div className="leading-tight" style={{ fontFamily: FRAUNCES, fontWeight: 700, fontSize: '18px' }}>
            {copy.ribbon}
          </div>
          <div style={{ color: 'rgba(251,249,244,.82)', fontSize: '13.5px', fontWeight: 400 }}>
            {copy.ribbonSub}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {code ? (
            <button
              type="button"
              onClick={copyCode}
              aria-label={isAr ? `نسخ الكود ${code}` : `Copy code ${code}`}
              className="inline-flex items-center gap-2 text-white"
              style={{
                border: '1px dashed rgba(255,255,255,.5)',
                backgroundColor: 'rgba(255,255,255,.10)',
                borderRadius: '9px',
                padding: '6px 11px',
              }}
            >
              <span style={{ color: 'rgba(255,255,255,.6)', fontSize: '11px' }}>
                {summerChipLabel(loc)}
              </span>
              <span className="font-semibold" style={{ fontSize: '13px', letterSpacing: '0.04em' }}>
                {code}
              </span>
              {copied ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5 opacity-80" aria-hidden />
              )}
            </button>
          ) : null}

          <a
            href={ctaHref}
            className="inline-flex items-center px-4 py-1.5 text-sm hover:opacity-90"
            style={{ backgroundColor: cta.bg, color: cta.text, borderRadius: '9px', fontWeight: 700 }}
          >
            {copy.ribbonCta}
          </a>
        </div>
      </div>
    </div>
  );
}
