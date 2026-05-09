import { describe, it, expect } from 'vitest';
import { cairoDateKey, isPaidAtWithinCairoDayOfInstant } from '@/lib/cairo/day';

describe('Cairo paid-today window (scanner hasPaidToday)', () => {
  it('treats payment at 1am Cairo and scan at 9am Cairo as the same Cairo day when UTC calendar dates differ', () => {
    // Africa/Cairo is UTC+2 year-round (no DST). 01:00 Cairo = 23:00 UTC on the previous UTC date;
    // 09:00 Cairo = 07:00 UTC on the next UTC calendar date vs that payment.
    const paymentAt = new Date('2026-05-09T23:00:00.000Z');
    const scanNow = new Date('2026-05-10T07:00:00.000Z');

    expect(cairoDateKey(paymentAt)).toBe(cairoDateKey(scanNow));
    expect(isPaidAtWithinCairoDayOfInstant(paymentAt, scanNow)).toBe(true);

    const utcDayOfScan = scanNow.toISOString().slice(0, 10);
    const legacyStart = `${utcDayOfScan}T00:00:00.000Z`;
    const legacyEnd = `${utcDayOfScan}T23:59:59.999Z`;
    const paidIso = paymentAt.toISOString();
    const wouldMissWithUtcMidnightWindow = paidIso < legacyStart || paidIso > legacyEnd;
    expect(wouldMissWithUtcMidnightWindow).toBe(true);
  });
});
