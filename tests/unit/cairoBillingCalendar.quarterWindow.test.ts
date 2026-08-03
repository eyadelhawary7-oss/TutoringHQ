import { describe, it, expect } from 'vitest';
import { nextProcessingQuarterStart } from '@/lib/cairoBillingCalendar';

/**
 * PAYOUT-SYSTEM-SPEC.md §2.4. The bug: a withdrawal requested inside an open
 * quarter window was told it would be processed a full quarter later.
 *
 * The only caller reaches this after isWithdrawalWindowOpen() is already true,
 * so the in-window cases below are the ones that actually render to a center.
 */
describe('nextProcessingQuarterStart', () => {
  describe('inside an open window (day 1-14 of a quarter month)', () => {
    it.each([
      ['2026-01-05', '2026-01-01'], // the exact case named in §2.4
      ['2026-01-01', '2026-01-01'], // first day of the window
      ['2026-01-14', '2026-01-01'], // last day of the window
      ['2026-04-09', '2026-04-01'],
      ['2026-07-14', '2026-07-01'],
      ['2026-10-02', '2026-10-01'],
    ])('%s is processed in the window it falls in: %s', (today, expected) => {
      expect(nextProcessingQuarterStart(today)).toBe(expected);
    });
  });

  describe('outside a window, the next quarter', () => {
    it.each([
      ['2026-01-15', '2026-04-01'], // window just closed
      ['2026-02-20', '2026-04-01'],
      ['2026-03-31', '2026-04-01'],
      ['2026-05-01', '2026-07-01'],
      ['2026-08-30', '2026-10-01'],
      ['2026-11-11', '2027-01-01'], // rolls the year
      ['2026-12-31', '2027-01-01'],
    ])('%s -> %s', (today, expected) => {
      expect(nextProcessingQuarterStart(today)).toBe(expected);
    });
  });

  it('never returns a date in a non-quarter month', () => {
    for (let m = 1; m <= 12; m++) {
      for (const d of [1, 14, 15, 28]) {
        const ymd = `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const month = parseInt(nextProcessingQuarterStart(ymd).slice(5, 7), 10);
        expect([1, 4, 7, 10]).toContain(month);
      }
    }
  });

  it('always returns the first of the month', () => {
    for (let m = 1; m <= 12; m++) {
      const ymd = `2026-${String(m).padStart(2, '0')}-07`;
      expect(nextProcessingQuarterStart(ymd).slice(8, 10)).toBe('01');
    }
  });
});
