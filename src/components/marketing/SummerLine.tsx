'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatNumber } from '@/lib/formatNumber';
import { useSummerPublicConfig, formatFloorLabel } from '@/components/summer/useSummerPublicConfig';

export type SummerLineVariant = 'undercta' | 'freeAndFirst' | 'fcta' | 'fctaTeacher';

/**
 * The one place the summer sentence is composed, on every public marketing
 * screen that draws it.
 *
 * The design hardcodes "16 August", "30 August" and "14 day trial". All three
 * already have a live source — `summer.free_until`, `summer.first_charge_floor`
 * and `summer.trial_days` in `platform_config`, served by
 * `/api/pricing/public-config` — so they are interpolated, never typed into
 * ar.json / en.json. Two consequences, both deliberate:
 *
 *  1. Moving the dates in admin moves them on the marketing pages, with no
 *     deploy and no chance of the page and the invoice disagreeing.
 *  2. When summer mode is switched off, `useSummerPublicConfig()` returns null
 *     and this renders nothing rather than a stale August date. Callers must
 *     tolerate a missing line — none of them depend on it for layout.
 */
export default function SummerLine({
  variant = 'undercta',
  className = '',
}: {
  variant?: SummerLineVariant;
  className?: string;
}) {
  const t = useTranslations('marketingSummer');
  const locale = useLocale();
  const state = useSummerPublicConfig();
  if (!state) return null;

  const loc = locale === 'ar' ? 'ar' : 'en';
  const values = {
    freeUntil: formatFloorLabel(state.summer.freeUntil, loc),
    firstCharge: formatFloorLabel(state.summer.firstChargeFloor, loc),
    trialDays: formatNumber(state.summer.trialDays, locale),
  };

  const text =
    variant === 'fcta'
      ? t('fcta', values)
      : variant === 'fctaTeacher'
        ? t('fctaTeacher', values)
        : variant === 'freeAndFirst'
          ? t('freeAndFirst', values)
          : t('undercta', values);

  return <p className={className}>{text}</p>;
}

/**
 * The same live config, as strings, for callers that need the values inside a
 * larger composition (the promo banner, the "what happens after summer" answer)
 * rather than as a standalone line. Returns null when summer mode is off.
 */
export function useSummerValues(): { freeUntil: string; firstCharge: string; trialDays: string } | null {
  const locale = useLocale();
  const state = useSummerPublicConfig();
  if (!state) return null;
  const loc = locale === 'ar' ? 'ar' : 'en';
  return {
    freeUntil: formatFloorLabel(state.summer.freeUntil, loc),
    firstCharge: formatFloorLabel(state.summer.firstChargeFloor, loc),
    trialDays: formatNumber(state.summer.trialDays, locale),
  };
}
