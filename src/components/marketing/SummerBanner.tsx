'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { SUMMER_PROMO_CODE } from '@/lib/summer/copy';
import { useSummerPublicConfig, formatFloorLabel } from '@/components/summer/useSummerPublicConfig';

/**
 * The `.banner` at the top of the landing page (design L110-120): flat, not
 * sticky, on `--ground`, sitting above the nav as the first thing in the page.
 *
 * Replaces `summer/SummerRibbon.tsx` on the public marketing screens. Three
 * things about the ribbon are struck by the design and do not survive: the
 * Fraunces serif headline, the sticky positioning, and the full-strength
 * gradient. What DOES survive is the code chip's copy-to-clipboard behaviour —
 * the design draws a code chip, and making a code copyable is not a drawn
 * difference, while losing it is a real regression for anyone on a phone.
 *
 * Dates come from `platform_config` via `/api/pricing/public-config`; the whole
 * banner renders nothing when summer mode is off, rather than a stale date.
 */
export default function SummerBanner() {
  const t = useTranslations('marketingSummer');
  const locale = useLocale();
  const state = useSummerPublicConfig();
  const [copied, setCopied] = useState(false);

  if (!state) return null;

  const loc = locale === 'ar' ? 'ar' : 'en';
  const freeUntil = formatFloorLabel(state.summer.freeUntil, loc);
  const firstCharge = formatFloorLabel(state.summer.firstChargeFloor, loc);
  // A code set in admin wins; the shared marketing code is the fallback so the
  // chip always renders. Display only — nothing is gated behind typing it.
  const code = state.promoCode || SUMMER_PROMO_CODE;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the chip stays a static display */
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2 px-6 py-4"
      style={{ backgroundColor: 'var(--color-ground)', color: 'var(--color-paper)' }}
      role="status"
    >
      <span className="min-w-[150px] flex-1">
        <span className="block text-[13px] font-bold leading-tight text-white">
          {t('bannerTitle', { freeUntil })}
        </span>
        <span
          className="mt-1 block text-[11px] leading-snug"
          style={{ color: 'rgba(236,232,223,.78)' }}
        >
          {t('bannerSub', { firstCharge })}
        </span>
      </span>

      <button
        type="button"
        onClick={copyCode}
        aria-label={t('copyCode', { code })}
        className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[11px]"
        style={{
          border: '1px dashed rgba(236,232,223,.4)',
          color: 'rgba(236,232,223,.9)',
        }}
      >
        <span>{t('codeLabel')}</span>
        <b className="mkt-mono tracking-[.05em] text-white" dir="ltr">
          {code}
        </b>
        {copied ? (
          <Check className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Copy className="h-3.5 w-3.5 opacity-80" aria-hidden />
        )}
      </button>

      <Link
        href="/signup"
        className="whitespace-nowrap rounded-lg px-4 py-3 text-xs font-bold"
        style={{ backgroundColor: 'var(--color-paper)', color: 'var(--color-ground)' }}
      >
        {t('startFree')}
      </Link>
    </div>
  );
}
