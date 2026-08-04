'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { SUMMER_PROMO_CODE } from '@/lib/summer/copy';
import { useSummerPublicConfig, formatFloorLabel } from '@/components/summer/useSummerPublicConfig';

/**
 * The `.banner` at the top of the landing page (design L110-120): flat, not
 * sticky, on `--ground`, sitting above the nav as the first thing in the page.
 *
 * Replaces `summer/SummerRibbon.tsx` on the public marketing screens. Four
 * things about the ribbon are struck by the design and do not survive: the
 * Fraunces serif headline, the sticky positioning, the full-strength gradient,
 * and the copy-to-clipboard button on the code chip — the design draws the chip
 * as a static dashed span with no icon, and the code is display-only anyway
 * (summer free mode is automatic, nothing is gated on typing it).
 *
 * Dates come from `platform_config` via `/api/pricing/public-config`; the whole
 * banner renders nothing when summer mode is off, rather than a stale date.
 */
export default function SummerBanner() {
  const t = useTranslations('marketingSummer');
  const locale = useLocale();
  const state = useSummerPublicConfig();

  if (!state) return null;

  const loc = locale === 'ar' ? 'ar' : 'en';
  const freeUntil = formatFloorLabel(state.summer.freeUntil, loc);
  const firstCharge = formatFloorLabel(state.summer.firstChargeFloor, loc);
  // A code set in admin wins; the shared marketing code is the fallback so the
  // chip always renders. Display only — nothing is gated behind typing it.
  const code = state.promoCode || SUMMER_PROMO_CODE;

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

      <span
        className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[11px]"
        style={{
          border: '1px dashed rgba(236,232,223,.4)',
          color: 'rgba(236,232,223,.9)',
        }}
      >
        {t('codeLabel')}{' '}
        <b className="mkt-mono tracking-[.05em] text-white" dir="ltr">
          {code}
        </b>
      </span>

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
