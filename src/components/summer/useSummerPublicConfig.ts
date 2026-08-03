'use client';

// Shared client hook: fetch the public summer offer config (60s edge cache) and
// resolve the current banner phase from today's Africa/Cairo date. Returns null
// while loading or when summer mode is OFF, so a component can early-return.

import { useEffect, useState } from 'react';
import { cairoDateKey } from '@/lib/cairo/day';
import { ANNUAL_BILLED_MONTHS_DEFAULT } from '@/lib/pricing';
import { summerBannerPhase, type SummerBannerPhase } from '@/lib/summer/phase';

export interface PublicSummerConfig {
  enabled: boolean;
  freeUntil: string;
  firstChargeFloor: string;
  trialDays: number;
  payWindowDays: number;
}

export interface SummerPublicState {
  summer: PublicSummerConfig;
  phase: SummerBannerPhase;
  /** Shared marketing code seeded in `landing.popup.promo_code` (display only). */
  promoCode: string;
}

export function useSummerPublicConfig(): SummerPublicState | null {
  const [state, setState] = useState<SummerPublicState | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/pricing/public-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const summer = data?.summer as PublicSummerConfig | undefined;
        if (!summer || !summer.enabled) return;
        const promoCode =
          typeof data?.popup?.promoCode === 'string' ? data.popup.promoCode.trim() : '';
        const today = cairoDateKey(new Date());
        setState({ summer, phase: summerBannerPhase(summer.freeUntil, today), promoCode });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/**
 * The live annual multiplier — `pricing.interval.annual_multiplier`, the number
 * of months charged per year (10 today, i.e. "two months free"). Served by the
 * same 60s-cached public endpoint.
 *
 * Display paths must use this rather than the compile-time default, or the
 * price shown and the price charged can drift the moment the value is edited in
 * admin. Falls back to `ANNUAL_BILLED_MONTHS_DEFAULT` while the fetch is in
 * flight or if it fails — the same fallback the server helper applies.
 */
export function usePublicAnnualMultiplier(): number {
  const [multiplier, setMultiplier] = useState(ANNUAL_BILLED_MONTHS_DEFAULT);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/pricing/public-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const m = data?.interval?.annualMultiplier;
        if (typeof m === 'number' && Number.isFinite(m) && m > 0) setMultiplier(m);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return multiplier;
}

/** Format a YYYY-MM-DD as a short month/day label in the locale (noon-UTC anchor). */
export function formatFloorLabel(ymd: string, locale: 'ar' | 'en'): string {
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
}
