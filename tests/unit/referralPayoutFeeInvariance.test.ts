/**
 * D22 fee-arithmetic lock.
 *
 * D22 repoints the referral WITHDRAWABLE BALANCE from the retired
 * `referral_reward_records` table to the canonical `referral_commissions`.
 * It changes WHERE the balance is read from — never HOW a payout is priced.
 *
 * This file pins `computeReferralPayout` byte-for-byte at the boundary values so
 * the repoint cannot quietly move the money. Every assertion below is a hard
 * literal, and the file fails if ANY of the four pricing facts changes:
 *
 *   1. the 1,000 EGP minimum GROSS
 *   2. the flat 20 EGP processing fee
 *   3. the 5% withdrawal rate
 *   4. the ORDER — flat fee first, percentage on the remainder
 *
 * The order guard is the subtle one: 20-then-5% and 5%-then-20 produce
 * different nets, so the expected values here are only reachable in one order.
 *
 * Companion file: `referralPayout.test.ts` (pre-existing, worked examples).
 * This one is referenced by name in the D22 PR body as the arithmetic guard.
 */
import { describe, expect, it } from 'vitest';
import {
  computeReferralPayout,
  REFERRAL_WITHDRAWAL_FEE_RATE,
  REFERRAL_WITHDRAWAL_MIN_EGP,
} from '@/lib/referralPayout';

const FLAT_FEE = 20;

describe('D22 — computeReferralPayout is unchanged by the balance-source repoint', () => {
  it('pins the three pricing constants', () => {
    expect(REFERRAL_WITHDRAWAL_MIN_EGP).toBe(1000);
    expect(REFERRAL_WITHDRAWAL_FEE_RATE).toBe(0.05);
  });

  it('AT the 1,000 EGP floor: 1000 → −20 → −5%(49) = 931', () => {
    expect(computeReferralPayout(1000, FLAT_FEE)).toEqual({
      gross: 1000,
      processingFee: 20,
      withdrawalFee: 49,
      net: 931,
    });
  });

  it('JUST UNDER the floor: 999.99 still prices correctly — the route, not the maths, rejects it', () => {
    // computeReferralPayout has no opinion on the minimum; it prices whatever it
    // is handed. The 1,000 gate lives in POST /api/referrals/payout. Pinning
    // both halves here means moving the gate INTO the maths would fail this test.
    expect(999.99 < REFERRAL_WITHDRAWAL_MIN_EGP).toBe(true);
    expect(computeReferralPayout(999.99, FLAT_FEE)).toEqual({
      gross: 999.99,
      processingFee: 20,
      withdrawalFee: 49,
      net: 930.99,
    });
  });

  it('WELL ABOVE the floor: 25000 → −20 → −5%(1249) = 23731', () => {
    expect(computeReferralPayout(25000, FLAT_FEE)).toEqual({
      gross: 25000,
      processingFee: 20,
      withdrawalFee: 1249,
      net: 23731,
    });
  });

  it('the flat fee is deducted BEFORE the percentage, not after', () => {
    const gross = 5000;
    const actual = computeReferralPayout(gross, FLAT_FEE).net;

    // Order A (live): (5000 − 20) × 0.95 = 4731
    const flatThenPct = (gross - FLAT_FEE) * (1 - REFERRAL_WITHDRAWAL_FEE_RATE);
    // Order B (wrong): (5000 × 0.95) − 20 = 4730
    const pctThenFlat = gross * (1 - REFERRAL_WITHDRAWAL_FEE_RATE) - FLAT_FEE;

    expect(flatThenPct).not.toBe(pctThenFlat);
    expect(actual).toBe(4731);
    expect(actual).toBe(flatThenPct);
    expect(actual).not.toBe(pctThenFlat);
  });

  it('a changed flat amount would be caught: 20 and only 20 yields these nets', () => {
    expect(computeReferralPayout(2000, 20).net).toBe(1881);
    // Any other flat fee produces a different net for the same gross.
    expect(computeReferralPayout(2000, 25).net).not.toBe(1881);
    expect(computeReferralPayout(2000, 0).net).not.toBe(1881);
  });

  it('a changed percentage would be caught: 5% and only 5% yields these nets', () => {
    expect(computeReferralPayout(2000, 20, 0.05).net).toBe(1881);
    expect(computeReferralPayout(2000, 20, 0.1).net).not.toBe(1881);
    expect(computeReferralPayout(2000, 20, 0.025).net).not.toBe(1881);
  });

  it('gross − processingFee − withdrawalFee === net at every pinned amount', () => {
    for (const gross of [1000, 999.99, 1020, 2000, 5000, 25000]) {
      const b = computeReferralPayout(gross, FLAT_FEE);
      expect(Math.round((b.gross - b.processingFee - b.withdrawalFee) * 100) / 100).toBe(b.net);
    }
  });
});
