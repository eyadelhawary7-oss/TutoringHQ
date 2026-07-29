import { describe, it, expect } from 'vitest';
import { computeSummerSchedule, resolveIssuePayWindow } from '@/lib/summer/dates';

/**
 * The pay window must be measured from the day the invoice was ACTUALLY raised.
 *
 * Live config at the time of writing: free_until 2026-08-16, first_charge_floor
 * 2026-08-30, trial_days 14, pay_window_days 1. A centre signing up in July is
 * planned for a 30 August invoice and a 31 August lock.
 *
 * If `summer.first_charge_release` is flipped late — say 2 September — the
 * invoice goes out on the 2nd against a lock day of 31 August that has already
 * passed. The centre is then locked on the next run, having had no chance to pay
 * a bill that did not exist until that morning.
 */
const CFG = {
  freeUntil: '2026-08-16',
  firstChargeFloor: '2026-08-30',
  trialDays: 14,
  payWindowDays: 1,
};

describe('summer pay window is anchored to the actual issue day', () => {
  it('gives a late-issued invoice a real window instead of a zero-length one', () => {
    const planned = computeSummerSchedule('2026-07-20', CFG);
    expect(planned.firstInvoiceAt).toBe('2026-08-30');
    expect(planned.lockDay).toBe('2026-08-31');

    // The release is flipped late; the cron raises the invoice on 2 September.
    const issueDay = '2026-09-02';

    // This is what the code did before the fix: carry the enrolment-time lock day
    // straight through. It is in the PAST relative to the issue day, so the
    // centre is locked on the next run with no window at all.
    expect(planned.lockDay < issueDay).toBe(true);

    const actual = resolveIssuePayWindow(issueDay, CFG);

    // The window must open on the issue day and close after pay_window_days.
    expect(actual.lastPayableDay).toBe('2026-09-02');
    expect(actual.lockDay).toBe('2026-09-03');
    // And it must be in the future relative to the issue day — the assertion the
    // planned value above fails.
    expect(actual.lockDay > issueDay).toBe(true);
  });

  it('changes nothing when the invoice goes out on its planned day', () => {
    const planned = computeSummerSchedule('2026-07-20', CFG);
    // The cron fires on the first run where todayCairo >= first_invoice_at, so
    // on time the issue day IS the planned day.
    const actual = resolveIssuePayWindow(planned.firstInvoiceAt, CFG);

    expect(actual.lastPayableDay).toBe(planned.lastPayableDay);
    expect(actual.lockDay).toBe(planned.lockDay);
    expect(actual.lockAtIso).toBe(planned.lockAtIso);
  });

  it('holds for a longer pay window too', () => {
    const cfg = { ...CFG, payWindowDays: 3 };
    const planned = computeSummerSchedule('2026-07-20', cfg);
    const actual = resolveIssuePayWindow(planned.firstInvoiceAt, cfg);
    // On time: identical.
    expect(actual.lockDay).toBe(planned.lockDay);
    // Late: three clear days from the issue day, not from the planned one.
    const late = resolveIssuePayWindow('2026-09-10', cfg);
    expect(late.lastPayableDay).toBe('2026-09-12');
    expect(late.lockDay).toBe('2026-09-13');
  });
});
