'use client';

// Shared client hook: fetch the public summer offer config (60s edge cache) and
// resolve the current banner phase from today's Africa/Cairo date. Returns null
// while loading or when summer mode is OFF, so a component can early-return.

import { useEffect, useState } from 'react';
import { cairoDateKey } from '@/lib/cairo/day';
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
        const today = cairoDateKey(new Date());
        setState({ summer, phase: summerBannerPhase(summer.freeUntil, today) });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
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
