import { describe, it, expect } from 'vitest';
import {
  computeSummerSchedule,
  isFirstInvoiceDue,
  daysUntilFirstInvoice,
  type SummerScheduleConfig,
} from '@/lib/summer/dates';
import { cairoDateKey } from '@/lib/cairo/day';

// Tests run TZ=UTC; all summer math is on Africa/Cairo calendar dates.
const CFG: SummerScheduleConfig = {
  freeUntil: '2026-08-16',
  firstChargeFloor: '2026-08-30',
  trialDays: 14,
  payWindowDays: 2,
};

describe('computeSummerSchedule — worked examples from the brief', () => {
  it('joins Jul 10 → trial_start Aug 16 → invoice Aug 30 → pay Aug 30 & 31 → lock Sep 1 00:00', () => {
    const s = computeSummerSchedule('2026-07-10', CFG);
    expect(s.trialStart).toBe('2026-08-16');
    expect(s.rawTrialEnd).toBe('2026-08-30'); // Aug 16 + 14
    expect(s.firstInvoiceAt).toBe('2026-08-30');
    expect(s.lastPayableDay).toBe('2026-08-31');
    expect(s.lockDay).toBe('2026-09-01');
    // lock_at is the first UTC instant that falls on Cairo Sep 1.
    expect(cairoDateKey(new Date(s.lockAtIso))).toBe('2026-09-01');
  });

  it('joins Aug 14 → same as Jul (invoice Aug 30, lock Sep 1)', () => {
    const s = computeSummerSchedule('2026-08-14', CFG);
    expect(s.trialStart).toBe('2026-08-16');
    expect(s.firstInvoiceAt).toBe('2026-08-30');
    expect(s.lockDay).toBe('2026-09-01');
  });

  it('joins Aug 20 → trial_start Aug 20 → invoice Sep 3 → pay Sep 3 & 4 → lock Sep 5 00:00', () => {
    const s = computeSummerSchedule('2026-08-20', CFG);
    expect(s.trialStart).toBe('2026-08-20');
    expect(s.rawTrialEnd).toBe('2026-09-03'); // Aug 20 + 14
    expect(s.firstInvoiceAt).toBe('2026-09-03'); // above the floor
    expect(s.lastPayableDay).toBe('2026-09-04');
    expect(s.lockDay).toBe('2026-09-05');
    expect(cairoDateKey(new Date(s.lockAtIso))).toBe('2026-09-05');
  });

  it('the floor is a hard floor: an early joiner never invoices before Aug 30', () => {
    const s = computeSummerSchedule('2026-01-01', CFG);
    expect(s.firstInvoiceAt).toBe('2026-08-30');
  });

  it('honors edited knobs (trial 7, pay window 3)', () => {
    const s = computeSummerSchedule('2026-08-20', {
      ...CFG,
      trialDays: 7,
      payWindowDays: 3,
    });
    expect(s.trialStart).toBe('2026-08-20');
    expect(s.rawTrialEnd).toBe('2026-08-27');
    expect(s.firstInvoiceAt).toBe('2026-08-30'); // floor still wins
    expect(s.lockDay).toBe('2026-09-02'); // Aug 30 + 3
  });
});

describe('isFirstInvoiceDue / daysUntilFirstInvoice', () => {
  it('not due before the day, due on and after', () => {
    expect(isFirstInvoiceDue('2026-08-30', '2026-08-29')).toBe(false);
    expect(isFirstInvoiceDue('2026-08-30', '2026-08-30')).toBe(true);
    expect(isFirstInvoiceDue('2026-08-30', '2026-09-05')).toBe(true);
  });

  it('counts whole Cairo days remaining, 0 on/after the day', () => {
    expect(daysUntilFirstInvoice('2026-08-30', '2026-08-30')).toBe(0);
    expect(daysUntilFirstInvoice('2026-08-30', '2026-08-29')).toBe(1);
    expect(daysUntilFirstInvoice('2026-08-30', '2026-08-16')).toBe(14);
    expect(daysUntilFirstInvoice('2026-08-30', '2026-09-10')).toBe(0);
  });
});
