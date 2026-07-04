import { describe, it, expect } from 'vitest';
import {
  computeNextPaymentDue,
  computeNextQuarterlyPaymentDue,
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
