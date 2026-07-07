import { describe, expect, it } from 'vitest';
import {
  computeReferralPayout,
  REFERRAL_WITHDRAWAL_FEE_RATE,
  REFERRAL_WITHDRAWAL_MIN_EGP,
} from '@/lib/referralPayout';

describe('computeReferralPayout — flat 20 first, then 5%', () => {
  it("matches Eyad's worked example: 1020 → −20 → −5% = 950", () => {
    const b = computeReferralPayout(1020, 20);
    expect(b).toEqual({ gross: 1020, processingFee: 20, withdrawalFee: 50, net: 950 });
  });

  it('applies the flat fee before the percentage', () => {
    const b = computeReferralPayout(219, 20);
    expect(b.processingFee).toBe(20);
    expect(b.withdrawalFee).toBe(9.95); // (219 − 20) × 5%
    expect(b.net).toBe(189.05);
  });

  it('rate constant is 5%', () => {
    expect(REFERRAL_WITHDRAWAL_FEE_RATE).toBe(0.05);
  });

  it('floors at net 0 (zeroed fees) when gross ≤ the flat fee — caller must reject', () => {
    expect(computeReferralPayout(20, 20)).toEqual({ gross: 20, processingFee: 0, withdrawalFee: 0, net: 0 });
    expect(computeReferralPayout(15, 20).net).toBe(0);
  });

  it('never returns a negative net', () => {
    for (const g of [0, 1, 19.99, 20, 20.01, 100, 5000]) {
      expect(computeReferralPayout(g, 20).net).toBeGreaterThanOrEqual(0);
    }
  });

  it('cash-withdrawal minimum is 1,000 EGP (route rejects below it on the gross)', () => {
    expect(REFERRAL_WITHDRAWAL_MIN_EGP).toBe(1000);
    // 900 is below the minimum → the route rejects before computing fees;
    // 1,020 is above it → normal breakdown to 950 net.
    expect(900 < REFERRAL_WITHDRAWAL_MIN_EGP).toBe(true);
    expect(1020 >= REFERRAL_WITHDRAWAL_MIN_EGP).toBe(true);
    expect(computeReferralPayout(1020, 20).net).toBe(950);
  });
});
