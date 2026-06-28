// src/lib/summer/phase.ts
//
// The public-messaging phase for the summer ribbon/popup. The banner is never
// empty: Phase 1 runs until SUMMER_FREE_UNTIL ("free all summer, first invoice
// Aug 30, nothing now"); Phase 2 is permanent and evergreen from Aug 16 onward
// ("14-day free trial, first invoice after"). The switch is automatic on the
// Cairo date, so the landing pages always carry a live offer.

export type SummerBannerPhase = 'phase1' | 'phase2';

/**
 * Which phase the public messaging is in on Cairo date `todayCairo`.
 *  - 'phase1' before SUMMER_FREE_UNTIL (free-for-all).
 *  - 'phase2' on/after SUMMER_FREE_UNTIL (evergreen 14-day trial).
 */
export function summerBannerPhase(freeUntil: string, todayCairo: string): SummerBannerPhase {
  return todayCairo < freeUntil ? 'phase1' : 'phase2';
}
