'use client';

import { useEffect, useState } from 'react';
import {
  ORDERED_SUBSCRIPTION_PLAN_KEYS,
  PLANS,
  type SubscriptionPlanKey,
} from '@/lib/pricing';

/**
 * Plan-level display prices fetched from `/api/pricing/plans`. Used by the
 * landing page, `/pricing`, and the signup plan picker so that admin edits
 * on `/admin/pricing` reflect immediately without redeploys.
 *
 * Values default to the hardcoded `PLANS[k]` constants (single source for
 * billing / MRR / server math) and are overwritten with DB-driven figures
 * once the fetch resolves. Callers therefore never see undefined prices,
 * even on first render or when the fetch fails.
 */
export interface DynamicPlanPrice {
  monthlyListPrice: number;
  quarterlyAllIn: number;
  annualEffectiveMonthly: number;
  weeklyStudentLimit: number | null;
}

export type DynamicPlanPriceMap = Record<SubscriptionPlanKey, DynamicPlanPrice>;

function buildFallback(): DynamicPlanPriceMap {
  return Object.fromEntries(
    ORDERED_SUBSCRIPTION_PLAN_KEYS.map((k) => [
      k,
      {
        monthlyListPrice: PLANS[k].monthlyListPrice,
        quarterlyAllIn: PLANS[k].quarterlyAllIn,
        annualEffectiveMonthly: PLANS[k].annualEffectiveMonthly,
        weeklyStudentLimit: PLANS[k].weeklyStudentLimit,
      } satisfies DynamicPlanPrice,
    ]),
  ) as DynamicPlanPriceMap;
}

interface ApiShape {
  plans?: Partial<Record<SubscriptionPlanKey, Partial<DynamicPlanPrice>>>;
}

export function usePublicPlanPrices(): DynamicPlanPriceMap {
  const [prices, setPrices] = useState<DynamicPlanPriceMap>(() => buildFallback());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/pricing/plans', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as ApiShape;
        if (cancelled || !json?.plans) return;
        setPrices((prev) => {
          const next: DynamicPlanPriceMap = { ...prev };
          for (const k of ORDERED_SUBSCRIPTION_PLAN_KEYS) {
            const incoming = json.plans?.[k];
            if (!incoming) continue;
            const base = next[k];
            const merged: DynamicPlanPrice = {
              monthlyListPrice:
                typeof incoming.monthlyListPrice === 'number' && incoming.monthlyListPrice > 0
                  ? incoming.monthlyListPrice
                  : base.monthlyListPrice,
              quarterlyAllIn:
                typeof incoming.quarterlyAllIn === 'number' && incoming.quarterlyAllIn > 0
                  ? incoming.quarterlyAllIn
                  : base.quarterlyAllIn,
              annualEffectiveMonthly:
                typeof incoming.annualEffectiveMonthly === 'number' &&
                incoming.annualEffectiveMonthly > 0
                  ? incoming.annualEffectiveMonthly
                  : base.annualEffectiveMonthly,
              weeklyStudentLimit:
                typeof incoming.weeklyStudentLimit === 'number' &&
                incoming.weeklyStudentLimit > 0
                  ? Math.round(incoming.weeklyStudentLimit)
                  : base.weeklyStudentLimit,
            };
            next[k] = merged;
          }
          return next;
        });
      } catch {
        /* swallow: fallback to PLANS values is already in state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return prices;
}
