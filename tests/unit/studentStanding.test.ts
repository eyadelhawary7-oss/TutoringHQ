import { describe, it, expect } from 'vitest';
import {
  cairoDaysSince,
  deriveStanding,
  foldOpenCharges,
  isBehind,
  NEW_STUDENT_DAYS,
  OVERDUE_AFTER_DAYS,
} from '@/lib/studentStanding';

// The suite runs TZ=UTC (see package.json) precisely so a Cairo-vs-local-time
// regression in the ageing arithmetic surfaces here rather than in production.

describe('cairoDaysSince', () => {
  it('counts whole Cairo calendar days', () => {
    const now = new Date('2026-07-13T09:00:00Z');
    expect(cairoDaysSince('2026-07-13T00:00:00Z', now)).toBe(0);
    expect(cairoDaysSince('2026-07-12T00:00:00Z', now)).toBe(1);
    expect(cairoDaysSince('2026-07-01T00:00:00Z', now)).toBe(12);
  });

  it('treats a bare date column (session_date) as that Cairo day', () => {
    const now = new Date('2026-07-13T09:00:00Z');
    expect(cairoDaysSince('2026-07-06', now)).toBe(7);
    // 21:00 UTC is already the NEXT Cairo day, so the same charge ages by one.
    expect(cairoDaysSince('2026-07-06', new Date('2026-07-13T21:00:00Z'))).toBe(8);
  });

  it('never returns a negative age for a future charge', () => {
    expect(cairoDaysSince('2026-08-01', new Date('2026-07-13T09:00:00Z'))).toBe(0);
  });

  it('does not shift a day at the Cairo/UTC boundary', () => {
    // 22:30 UTC on the 12th is already the 13th in Cairo (UTC+3 in July).
    const now = new Date('2026-07-12T22:30:00Z');
    expect(cairoDaysSince('2026-07-13', now)).toBe(0);
    expect(cairoDaysSince('2026-07-12', now)).toBe(1);
  });
});

describe('foldOpenCharges', () => {
  const charges = [
    { at: '2026-07-01', amount: 100 },
    { at: '2026-07-06', amount: 100 },
    { at: '2026-07-13', amount: 100 },
  ];

  it('reports nothing open when payments cover every charge', () => {
    expect(foldOpenCharges(charges, 300)).toEqual({ oldestUnpaidAt: null, openChargeCount: 0 });
  });

  it('reports nothing open on an overpayment (credit)', () => {
    expect(foldOpenCharges(charges, 450)).toEqual({ oldestUnpaidAt: null, openChargeCount: 0 });
  });

  it('settles oldest-first, so the open charge is the earliest uncovered one', () => {
    expect(foldOpenCharges(charges, 100)).toEqual({
      oldestUnpaidAt: '2026-07-06',
      openChargeCount: 2,
    });
  });

  it('counts a partially covered charge as open and anchors ageing to it', () => {
    expect(foldOpenCharges(charges, 150)).toEqual({
      oldestUnpaidAt: '2026-07-06',
      openChargeCount: 2,
    });
  });

  it('opens at the very first charge when nothing has been paid', () => {
    expect(foldOpenCharges(charges, 0)).toEqual({
      oldestUnpaidAt: '2026-07-01',
      openChargeCount: 3,
    });
  });

  it('sorts before folding — input order must not change the answer', () => {
    const shuffled = [charges[2], charges[0], charges[1]];
    expect(foldOpenCharges(shuffled, 100)).toEqual({
      oldestUnpaidAt: '2026-07-06',
      openChargeCount: 2,
    });
  });

  it('ignores zero-fee and undated scans (waived / exempt / re-scan rows)', () => {
    const mixed = [
      { at: '2026-06-01', amount: 0 },
      { at: '', amount: 100 },
      { at: '2026-07-01', amount: 100 },
    ];
    expect(foldOpenCharges(mixed, 0)).toEqual({
      oldestUnpaidAt: '2026-07-01',
      openChargeCount: 1,
    });
  });

  it('does not leave a rounding crumb open after an exact settlement', () => {
    const cents = [
      { at: '2026-07-01', amount: 33.33 },
      { at: '2026-07-02', amount: 33.33 },
      { at: '2026-07-03', amount: 33.34 },
    ];
    expect(foldOpenCharges(cents, 100)).toEqual({ oldestUnpaidAt: null, openChargeCount: 0 });
  });
});

describe('deriveStanding', () => {
  const now = new Date('2026-07-13T09:00:00Z');

  it('is new for a fresh signup with no charges and no payments', () => {
    expect(
      deriveStanding(
        { charge: 0, paid: 0, balance: 0, oldestUnpaidDays: null, createdAt: '2026-07-11' },
        now,
      ),
    ).toBe('new');
  });

  it('is NOT new once the student has been charged, however recently they joined', () => {
    expect(
      deriveStanding(
        { charge: 100, paid: 0, balance: 100, oldestUnpaidDays: 1, createdAt: '2026-07-12' },
        now,
      ),
    ).toBe('at_risk');
  });

  it('stops being new after the window closes', () => {
    const created = new Date(now.getTime() - (NEW_STUDENT_DAYS + 1) * 86_400_000).toISOString();
    expect(
      deriveStanding({ charge: 0, paid: 0, balance: 0, oldestUnpaidDays: null, createdAt: created }, now),
    ).toBe('paid');
  });

  it('is paid at zero balance and on a credit', () => {
    const base = { charge: 100, paid: 100, oldestUnpaidDays: null, createdAt: '2025-01-01' };
    expect(deriveStanding({ ...base, balance: 0 }, now)).toBe('paid');
    expect(deriveStanding({ ...base, balance: -50 }, now)).toBe('paid');
  });

  it('is at risk while the debt is younger than the overdue threshold', () => {
    expect(
      deriveStanding(
        {
          charge: 100,
          paid: 0,
          balance: 100,
          oldestUnpaidDays: OVERDUE_AFTER_DAYS - 1,
          createdAt: '2025-01-01',
        },
        now,
      ),
    ).toBe('at_risk');
  });

  it('is overdue once the debt reaches the threshold', () => {
    expect(
      deriveStanding(
        {
          charge: 100,
          paid: 0,
          balance: 100,
          oldestUnpaidDays: OVERDUE_AFTER_DAYS,
          createdAt: '2025-01-01',
        },
        now,
      ),
    ).toBe('overdue');
  });

  it('honours a config override of the overdue threshold', () => {
    const row = {
      charge: 100,
      paid: 0,
      balance: 100,
      oldestUnpaidDays: 10,
      createdAt: '2025-01-01',
    };
    expect(deriveStanding(row, now, { overdueAfterDays: 30 })).toBe('at_risk');
    expect(deriveStanding(row, now, { overdueAfterDays: 3 })).toBe('overdue');
  });

  it('classifies behind as exactly at_risk + overdue', () => {
    expect(isBehind('at_risk')).toBe(true);
    expect(isBehind('overdue')).toBe(true);
    expect(isBehind('paid')).toBe(false);
    expect(isBehind('new')).toBe(false);
  });
});
