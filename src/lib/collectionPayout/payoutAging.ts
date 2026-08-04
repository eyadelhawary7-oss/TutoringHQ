// src/lib/collectionPayout/payoutAging.ts
//
// Visible ageing for pending payout requests. PURE apart from an injected `now`.
//
// ── THE DECISION THIS IMPLEMENTS (PAYOUT-SYSTEM-SPEC.md §7.5, 3 August 2026) ──
//
//   "CEO unavailability — DECIDED: payouts WAIT. No fallback approver, at any
//    amount, for any duration."
//
//   - An above-cap payout has exactly ONE path to release, ever. No break-glass,
//     no time-based escalation, no "auto-approve after N days". A queue that
//     grows during an absence is the INTENDED BEHAVIOUR, not a defect to
//     engineer around later.
//   - "The system must therefore never let an unpaid queue look like a paid one.
//     Requests must age visibly — `requested_at` surfaced on the centre's own
//     view with an honest 'awaiting approval' state, NO ETA the platform cannot
//     honour. The failure this prevents is a centre believing its money was sent
//     because the UI went quiet."
//   - "NO EXPIRY on a pending request. Auto-cancelling an aged request would
//     silently convert 'waiting' into 'denied' without anyone deciding it."
//
// So: this module computes AGE and a BAND. It computes no ETA, no expiry, no
// deadline and no escalation. There is no function here that could cancel
// anything, and `describeWaiting` never returns a promise about when.

import { cairoDateKey, cairoYmdMinusDays } from '@/lib/cairo/day';

/**
 * Ageing bands. Purely descriptive — nothing in the system behaves differently
 * per band. They exist so an admin queue can sort and colour, and so a centre's
 * own view can say "13 days" honestly instead of going quiet.
 */
export type AgeBand = 'fresh' | 'ageing' | 'stale' | 'long_wait';

export const AGE_BAND_THRESHOLD_DAYS: Record<Exclude<AgeBand, 'fresh'>, number> = {
  ageing: 3,
  stale: 7,
  long_wait: 21,
};

export interface AgedRequest {
  /** Whole Cairo calendar days between the request and `now`. Never negative. */
  ageDays: number;
  band: AgeBand;
  /** Cairo YYYY-MM-DD the request was made. What the centre is shown. */
  requestedCairoDate: string;
  /**
   * i18n key for the honest status line. Always an "awaiting approval" variant;
   * there is no key here that promises a date.
   */
  statusKey: string;
  /**
   * TRUE always, for every pending request. Stated as a field rather than
   * assumed so that a surface rendering this cannot forget it: there is no
   * fallback approver and the request will not expire.
   */
  neverExpires: true;
  /** i18n key explaining that no substitute approver exists. §7.5. */
  noFallbackApproverKey: string;
}

/** Whole Cairo calendar days from `requestedAt` to `now`. Clamped at 0. */
export function cairoAgeInDays(requestedAt: Date | string, now: Date = new Date()): number {
  const requested = typeof requestedAt === 'string' ? new Date(requestedAt) : requestedAt;
  if (Number.isNaN(requested.getTime())) return 0;
  const requestedKey = cairoDateKey(requested);
  const nowKey = cairoDateKey(now);
  if (requestedKey >= nowKey) return 0;
  // Walk back from today until the keys meet. Bounded and exact across DST and
  // month ends because it uses the same Cairo calendar arithmetic as billing.
  let days = 0;
  let cursor = nowKey;
  while (cursor > requestedKey && days < 3650) {
    cursor = cairoYmdMinusDays(cursor, 1);
    days += 1;
  }
  return days;
}

export function bandForAge(ageDays: number): AgeBand {
  if (ageDays >= AGE_BAND_THRESHOLD_DAYS.long_wait) return 'long_wait';
  if (ageDays >= AGE_BAND_THRESHOLD_DAYS.stale) return 'stale';
  if (ageDays >= AGE_BAND_THRESHOLD_DAYS.ageing) return 'ageing';
  return 'fresh';
}

/**
 * Describe a request that is waiting on a human.
 *
 * Returns no ETA. §7.5: "no ETA the platform cannot honour."
 */
export function describeWaiting(requestedAt: Date | string, now: Date = new Date()): AgedRequest {
  const requested = typeof requestedAt === 'string' ? new Date(requestedAt) : requestedAt;
  const ageDays = cairoAgeInDays(requested, now);
  return {
    ageDays,
    band: bandForAge(ageDays),
    requestedCairoDate: Number.isNaN(requested.getTime())
      ? cairoDateKey(now)
      : cairoDateKey(requested),
    statusKey: 'collectionPayout.payout.awaitingApproval',
    neverExpires: true,
    noFallbackApproverKey: 'collectionPayout.payout.noFallbackApprover',
  };
}

/**
 * There is deliberately no `expirePendingRequests`, no `autoApproveAfterDays`
 * and no `escalateToFallbackApprover` in this module or anywhere in Territory C.
 * If a future change adds one, it is reversing a decision that was made
 * explicitly on 3 August 2026 and recorded in §7.5 — reopen the decision, do not
 * add the function.
 */
export const NO_AUTO_EXPIRY_BY_DECISION = true as const;
