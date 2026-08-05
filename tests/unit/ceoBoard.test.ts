/**
 * `Merged-CEO` §01 board arithmetic.
 *
 * These run under TZ=UTC (see vitest config), which is the point: every month
 * boundary here is a **Cairo** calendar boundary, so a helper that quietly used
 * the process timezone would fail these rather than pass in CI and misbucket in
 * production. Cairo is UTC+2/+3, so an instant late on the last UTC day of a
 * month already belongs to the next Cairo month — that asymmetry is asserted
 * directly below.
 */
import { describe, it, expect } from 'vitest';
import {
  REVENUE_MONTHS,
  arpuFrom,
  bucketPaidRevenueByCairoMonth,
  cairoMonthKey,
  cairoMonthStartUtc,
  churnRatePct,
  countInCairoMonth,
  lastNCairoMonthKeys,
  priorMonthKey,
  sumCenterMrr,
} from '@/lib/ceoBoard';

describe('cairoMonthKey', () => {
  it('reports the Cairo month, not the UTC month, across a boundary', () => {
    // 2026-03-31 23:00Z is 2026-04-01 01:00 in Cairo (UTC+2).
    expect(cairoMonthKey(new Date('2026-03-31T23:00:00Z'))).toBe('2026-04');
    // ...while an hour earlier in UTC is still March in Cairo.
    expect(cairoMonthKey(new Date('2026-03-31T21:00:00Z'))).toBe('2026-03');
  });
});

describe('priorMonthKey', () => {
  it('steps back one month', () => {
    expect(priorMonthKey('2026-08')).toBe('2026-07');
  });

  it('rolls the year back across January', () => {
    expect(priorMonthKey('2026-01')).toBe('2025-12');
  });
});

describe('lastNCairoMonthKeys', () => {
  it('returns n keys oldest → newest ending at the current Cairo month', () => {
    const keys = lastNCairoMonthKeys(new Date('2026-08-04T09:00:00Z'), REVENUE_MONTHS);
    expect(keys).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']);
  });

  it('crosses a year boundary in order', () => {
    expect(lastNCairoMonthKeys(new Date('2026-02-10T09:00:00Z'), 4)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });
});

describe('cairoMonthStartUtc', () => {
  it('is the UTC instant of Cairo midnight on the 1st', () => {
    // Cairo is UTC+2 in February, so 00:00 Cairo is 22:00Z the previous day.
    expect(cairoMonthStartUtc('2026-02').toISOString()).toBe('2026-01-31T22:00:00.000Z');
  });
});

describe('bucketPaidRevenueByCairoMonth', () => {
  const months = ['2026-06', '2026-07', '2026-08'];

  it('sums into the Cairo month of paid_at and zero-fills the rest', () => {
    const rows = [
      { paid_at: '2026-07-05T10:00:00Z', total_amount: 100, owner_type: 'center' },
      { paid_at: '2026-07-20T10:00:00Z', total_amount: '250.50', owner_type: 'teacher' },
      { paid_at: '2026-08-01T09:00:00Z', total_amount: 40, owner_type: 'center' },
    ];
    expect(bucketPaidRevenueByCairoMonth(rows, months)).toEqual([
      { month: '2026-06', revenue: 0 },
      { month: '2026-07', revenue: 351 },
      { month: '2026-08', revenue: 40 },
    ]);
  });

  it('filters by owner_type so the segments can be summed separately', () => {
    const rows = [
      { paid_at: '2026-07-05T10:00:00Z', total_amount: 100, owner_type: 'center' },
      { paid_at: '2026-07-06T10:00:00Z', total_amount: 70, owner_type: 'teacher' },
    ];
    expect(bucketPaidRevenueByCairoMonth(rows, months, 'teacher')).toEqual([
      { month: '2026-06', revenue: 0 },
      { month: '2026-07', revenue: 70 },
      { month: '2026-08', revenue: 0 },
    ]);
  });

  it('buckets a late-UTC instant into the next Cairo month', () => {
    // 22:30Z on 31 July is 00:30 on 1 August in Cairo (UTC+3 in summer).
    const rows = [{ paid_at: '2026-07-31T22:30:00Z', total_amount: 500, owner_type: 'center' }];
    const out = bucketPaidRevenueByCairoMonth(rows, months);
    expect(out.find((p) => p.month === '2026-08')?.revenue).toBe(500);
    expect(out.find((p) => p.month === '2026-07')?.revenue).toBe(0);
  });

  it('drops unusable rows rather than folding them into a neighbouring month', () => {
    const rows = [
      { paid_at: null, total_amount: 999, owner_type: 'center' },
      { paid_at: 'not-a-date', total_amount: 999, owner_type: 'center' },
      { paid_at: '2026-07-05T10:00:00Z', total_amount: null, owner_type: 'center' },
      // Outside the window entirely.
      { paid_at: '2025-01-05T10:00:00Z', total_amount: 999, owner_type: 'center' },
    ];
    expect(bucketPaidRevenueByCairoMonth(rows, months)).toEqual([
      { month: '2026-06', revenue: 0 },
      { month: '2026-07', revenue: 0 },
      { month: '2026-08', revenue: 0 },
    ]);
  });
});

describe('churnRatePct', () => {
  it('is a percent of the accounts active when the month opened', () => {
    expect(churnRatePct(3, 150)).toBeCloseTo(2, 10);
  });

  it('is null — not zero — when the denominator is unknown or zero', () => {
    expect(churnRatePct(0, null)).toBeNull();
    expect(churnRatePct(2, 0)).toBeNull();
  });

  it('is 0 when there genuinely were no cancellations', () => {
    expect(churnRatePct(0, 150)).toBe(0);
  });
});

describe('arpuFrom', () => {
  it('divides MRR across active accounts', () => {
    expect(arpuFrom(24000, 20)).toBe(1200);
  });

  it('is null rather than a divide-by-zero when there are no accounts', () => {
    expect(arpuFrom(24000, 0)).toBeNull();
  });
});

describe('countInCairoMonth', () => {
  it('counts only rows whose timestamp lands in the given Cairo month', () => {
    const rows = [
      { created_at: '2026-08-02T10:00:00Z' },
      { created_at: '2026-07-31T22:30:00Z' }, // already August in Cairo
      { created_at: '2026-07-10T10:00:00Z' },
      { created_at: null },
      { created_at: 'nonsense' },
    ];
    expect(countInCairoMonth(rows, 'created_at', '2026-08')).toBe(2);
    expect(countInCairoMonth(rows, 'created_at', '2026-07')).toBe(1);
  });

  it('returns 0 for a field that is absent on every row', () => {
    expect(countInCairoMonth([{ created_at: '2026-08-02T10:00:00Z' }], 'cancelled_at', '2026-08'))
      .toBe(0);
  });
});

describe('sumCenterMrr', () => {
  it('excludes centers the pricing helper deems ineligible', () => {
    // A cancelled centre contributes nothing regardless of its price fields.
    const cancelled = sumCenterMrr([
      { status: 'cancelled', plan: 'starter', all_in_price: 5000, billing_period: 'quarterly' },
    ]);
    expect(cancelled).toBe(0);
  });

  it('sums to a whole number of EGP', () => {
    const total = sumCenterMrr([
      { status: 'active', plan: 'starter', all_in_price: 1200, billing_period: 'quarterly' },
      { status: 'active', plan: 'starter', all_in_price: 800, billing_period: 'quarterly' },
    ]);
    expect(Number.isInteger(total)).toBe(true);
    expect(total).toBe(2000);
  });

  it('is 0 for an empty portfolio', () => {
    expect(sumCenterMrr([])).toBe(0);
  });
});
