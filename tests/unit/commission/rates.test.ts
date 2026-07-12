import { describe, it, expect } from 'vitest';
import {
  computeRepCommission,
  computeT2AtCurrentPrice,
  computeOverride,
  computeLoyaltyOverride,
  computeLoyalty,
  round2,
  REP_RATE,
  OVERRIDE_RATE,
  LOYALTY_RATE,
} from '@/lib/commission/rates';

describe('commission rates — rep commission (20%, split in halves)', () => {
  it('20% of monthly price, split into two equal halves', () => {
    expect(computeRepCommission(1500)).toEqual({ total: 300, t1: 150, t2: 150 });
    expect(computeRepCommission(1000)).toEqual({ total: 200, t1: 100, t2: 100 });
  });

  it('t1 + t2 always equals total exactly (odd amounts, no rounding drift)', () => {
    for (const monthly of [333, 666.67, 1499.67, 2499, 18499 / 3, 999 / 3]) {
      const { total, t1, t2 } = computeRepCommission(monthly);
      expect(round2(t1 + t2)).toBe(total);
    }
  });

  it('the rate is exactly 20%', () => {
    expect(REP_RATE).toBe(0.2);
    expect(computeRepCommission(2500).total).toBe(500);
  });

  it('zero / negative / non-finite monthly price → zero commission', () => {
    expect(computeRepCommission(0)).toEqual({ total: 0, t1: 0, t2: 0 });
    expect(computeRepCommission(-100)).toEqual({ total: 0, t1: 0, t2: 0 });
    expect(computeRepCommission(NaN)).toEqual({ total: 0, t1: 0, t2: 0 });
  });
});

describe('commission rates — T2 recompute at current price', () => {
  it('T2 half tracks the CURRENT monthly price (up/downgrade)', () => {
    // signed at 1000/mo (t2 would be 100) but now on 2000/mo → second half is 200.
    expect(computeT2AtCurrentPrice(2000)).toBe(200);
    expect(computeT2AtCurrentPrice(1000)).toBe(100);
  });
});

describe('commission rates — manager override (20% of rep)', () => {
  it('override is 20% of each rep half', () => {
    expect(OVERRIDE_RATE).toBe(0.2);
    expect(computeOverride(150, 150)).toEqual({ t1: 30, t2: 30 });
    expect(computeOverride(100, 100)).toEqual({ t1: 20, t2: 20 });
  });

  it('override on loyalty is 20% of the rep loyalty', () => {
    expect(computeLoyaltyOverride(500)).toBe(100);
    expect(computeLoyaltyOverride(0)).toBe(0);
  });
});

describe('commission rates — loyalty (1% of first-12-months revenue)', () => {
  it('1% of realized revenue', () => {
    expect(LOYALTY_RATE).toBe(0.01);
    expect(computeLoyalty(50000)).toBe(500);
    expect(computeLoyalty(123456)).toBe(1234.56);
  });

  it('zero / negative revenue → zero loyalty', () => {
    expect(computeLoyalty(0)).toBe(0);
    expect(computeLoyalty(-5)).toBe(0);
  });
});

describe('round2', () => {
  it('rounds to 2dp, guards non-finite', () => {
    expect(round2(66.666)).toBe(66.67);
    expect(round2(66.664)).toBe(66.66);
    expect(round2(NaN)).toBe(0);
    expect(round2(Infinity)).toBe(0);
  });
});
