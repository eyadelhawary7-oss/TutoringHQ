// src/lib/commission/rates.ts
//
// Money-track commission RATES (v2) — the pure, fully-testable amount core that
// replaces the old fixed-EGP `COMMISSION_TABLE`. No I/O here; the DB layer lives
// in `src/lib/commissions.ts` and the T2/loyalty crons.
//
// Rules (per the sign-off spec — every number here changes what a person is PAID,
// so this module is REQUIRES SIGN-OFF):
//   • Rep commission  = 20% of the customer's MONTHLY plan price (post-discount),
//     paid in two equal halves: T1 at conversion, T2 at the 6-month mark
//     (180 active days) RECOMPUTED at the plan price in force at unlock time.
//   • Loyalty bonus   = 1% of the customer's REAL first-12-months revenue,
//     unlocked at 365 active days.
//   • Manager override = 20% of the rep's commission AND 20% of the rep's loyalty.
//   • Applies to ALL plans, for BOTH centers and teachers, once per customer.
//
// INTERPRETATION FLAGGED FOR SIGN-OFF: "monthly plan price" is the monthly
// EQUIVALENT (e.g. a quarterly-billed center's quarterly all-in ÷ 3 via
// getImpliedMonthlyMrr), NOT the full amount charged that cycle. A quarterly
// customer pays 3 months up front; the rep still earns 20% of ONE month.

export const REP_RATE = 0.2; // 20% of monthly plan price
export const OVERRIDE_RATE = 0.2; // manager: 20% of rep commission + rep loyalty
export const LOYALTY_RATE = 0.01; // 1% of realized first-12-months revenue
export const T2_ACTIVE_DAYS = 180; // second half unlocks at 6 months of active time
export const LOYALTY_ACTIVE_DAYS = 365; // loyalty unlocks at 12 months of active time

/** Bankers-free 2dp round, matching the money helpers used elsewhere. */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function safeBase(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface RepCommission {
  /** Full rep commission = 20% of monthly price. */
  total: number;
  /** Half paid at conversion. */
  t1: number;
  /** Half paid at the 6-month mark (t1 + t2 === total exactly). */
  t2: number;
}

/**
 * Rep commission from a monthly plan price. Split into two equal halves; the
 * second half is the exact remainder so `t1 + t2 === total` with no rounding drift.
 */
export function computeRepCommission(monthlyPriceEgp: number): RepCommission {
  const total = round2(safeBase(monthlyPriceEgp) * REP_RATE);
  const t1 = round2(total / 2);
  const t2 = round2(total - t1);
  return { total, t1, t2 };
}

/**
 * The T2 (second-half) amount RECOMPUTED at the plan price in force at unlock.
 * If the customer up/downgraded since signing, the 6-month half tracks the CURRENT
 * price — never the price snapshotted at conversion.
 */
export function computeT2AtCurrentPrice(currentMonthlyPriceEgp: number): number {
  return computeRepCommission(currentMonthlyPriceEgp).t2;
}

/** Manager override on the rep's two commission halves (20% each). */
export function computeOverride(repT1: number, repT2: number): { t1: number; t2: number } {
  return { t1: round2(safeBase(repT1) * OVERRIDE_RATE), t2: round2(safeBase(repT2) * OVERRIDE_RATE) };
}

/** Manager override on the rep's loyalty bonus (20%). */
export function computeLoyaltyOverride(repLoyaltyEgp: number): number {
  return round2(safeBase(repLoyaltyEgp) * OVERRIDE_RATE);
}

/** Loyalty bonus = 1% of realized first-12-months revenue. */
export function computeLoyalty(firstTwelveMonthsRevenueEgp: number): number {
  return round2(safeBase(firstTwelveMonthsRevenueEgp) * LOYALTY_RATE);
}
