import { describe, it, expect } from 'vitest';
import {
  computeNextPaymentDue,
  computeNextQuarterlyPaymentDue,
  computeNextPaymentDueCatchUp,
  addMonthsToDateStr,
} from '@/lib/subscriptionAnchor';

// Job 1: the renewal clock must be period-aware. computeNextPaymentDue advances
// the due date by N months and snaps to the subscription anchor day-of-month.
describe('computeNextPaymentDue', () => {
  const anchored = {
    next_payment_due: '2026-03-15',
    subscription_start_date: '2025-03-15',
    billing_cycle_start: null,
    approved_at: null,
  };

  it('annual (12 months): 2026-03-15 → 2027-03-15', () => {
    expect(computeNextPaymentDue(anchored, 12)).toBe('2027-03-15');
  });

  it('quarterly (3 months): 2026-03-15 → 2026-06-15', () => {
    expect(computeNextPaymentDue(anchored, 3)).toBe('2026-06-15');
  });

  it('defaults to a 3-month step for a non-positive period', () => {
    expect(computeNextPaymentDue(anchored, 0)).toBe(computeNextPaymentDue(anchored, 3));
    expect(computeNextPaymentDue(anchored, -5)).toBe(computeNextPaymentDue(anchored, 3));
  });

  it('with no anchor fields, annual just advances +12 months of the due date', () => {
    const noAnchor = {
      next_payment_due: '2026-01-31',
      subscription_start_date: null,
      billing_cycle_start: null,
      approved_at: null,
    };
    // +12 months of 2026-01-31 → 2027-01-31 (addMonthsToDateStr clamps day per month).
    expect(computeNextPaymentDue(noAnchor, 12)).toBe(addMonthsToDateStr('2026-01-31', 12));
  });
});

describe('computeNextPaymentDueCatchUp', () => {
  // now is injected directly here — fully deterministic, no dependency on the
  // real wall clock (unlike centerAnnualRenewal.test.ts's end-to-end coverage
  // of the same wiring, which computes its dates relative to Date.now()).
  const NOW = new Date('2026-07-26T09:00:00Z');

  it('no catch-up needed: a barely-stale due date advances once, same as computeNextPaymentDue', () => {
    const center = {
      next_payment_due: '2026-07-23', // 3 days stale
      subscription_start_date: '2025-07-23',
      billing_cycle_start: null,
      approved_at: null,
    };
    const plain = computeNextPaymentDue(center, 1);
    const r = computeNextPaymentDueCatchUp(center, 1, NOW);
    expect(r.nextDue).toBe(plain);
    expect(r.periodsSkipped).toBe(0);
    expect(r.nextDue >= '2026-07-26').toBe(true);
  });

  it('72 days stale, monthly: the plain advance would still be in the past — catches up to on/after now', () => {
    const center = {
      next_payment_due: '2026-05-15', // 72 days before NOW
      subscription_start_date: '2025-05-15',
      billing_cycle_start: null,
      approved_at: null,
    };
    const plain = computeNextPaymentDue(center, 1); // 2026-06-15 -- still ~41 days before NOW
    expect(plain < '2026-07-26').toBe(true); // confirms the exposure this fixes

    const r = computeNextPaymentDueCatchUp(center, 1, NOW);
    expect(r.nextDue >= '2026-07-26').toBe(true);
    expect(r.periodsSkipped).toBeGreaterThan(0);
  });

  it('400 days stale, annual: catches up past now with the anchor day preserved', () => {
    const center = {
      next_payment_due: '2025-06-21', // ~400 days before NOW
      subscription_start_date: '2020-06-21', // anchor day = 21
      billing_cycle_start: null,
      approved_at: null,
    };
    const r = computeNextPaymentDueCatchUp(center, 12, NOW);
    expect(r.nextDue >= '2026-07-26').toBe(true);
    expect(r.periodsSkipped).toBeGreaterThan(0);
    expect(r.nextDue.slice(8, 10)).toBe('21'); // anchor day-of-month preserved through catch-up
  });

  it('never bills for skipped periods — periodsSkipped is informational only, callers must not multiply it into a charge', () => {
    // This test exists to make the invariant explicit in code, not just prose:
    // the function's public surface has no amount/price field at all.
    const center = {
      next_payment_due: '2026-01-01',
      subscription_start_date: '2020-01-01',
      billing_cycle_start: null,
      approved_at: null,
    };
    const r = computeNextPaymentDueCatchUp(center, 1, NOW);
    expect(Object.keys(r).sort()).toEqual(['nextDue', 'periodsSkipped']);
  });
});

describe('computeNextQuarterlyPaymentDue (unchanged wrapper)', () => {
  it('is identical to computeNextPaymentDue(center, 3)', () => {
    const c = {
      next_payment_due: '2026-05-10',
      subscription_start_date: '2025-05-10',
      billing_cycle_start: null,
      approved_at: null,
    };
    expect(computeNextQuarterlyPaymentDue(c)).toBe(computeNextPaymentDue(c, 3));
    expect(computeNextQuarterlyPaymentDue(c)).toBe('2026-08-10');
  });
});
