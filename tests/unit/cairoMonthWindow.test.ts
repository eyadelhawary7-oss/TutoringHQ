/**
 * Cairo calendar-month windows (`src/lib/cairo/day.ts`).
 *
 * These exist because `/api/analytics/revenue` built every month bucket from
 * `new Date(now.getFullYear(), now.getMonth(), 1)` — the SERVER's calendar
 * month, which is UTC on Vercel — while `analytics/page.tsx` labelled the same
 * window with `formatCalendarMonthYyyyMmInCairo()`. For the two or three hours
 * before UTC midnight on the last day of a Cairo month, those two disagree:
 * the header showed the new month and every figure under it was still the old
 * one.
 *
 * The suite runs `TZ=UTC` (see `package.json`), which is exactly the
 * environment where the bug was invisible to a naive test — a Cairo-anchored
 * assertion is the only kind that catches it. Every expectation below is an
 * ABSOLUTE value, not a re-derivation, so the test fails if the helpers ever
 * fall back to server-local arithmetic.
 */
import { describe, it, expect } from 'vitest';
import {
  cairoMonthKey,
  cairoMonthKeyPlusMonths,
  cairoMonthUtcBounds,
  startOfUtcInstantForCairoMonth,
} from '@/lib/cairo/day';

describe('cairoMonthKey', () => {
  it('uses the Cairo month, not the server month, at the UTC-evening boundary', () => {
    // 22:30 UTC on 31 July is 00:30 on 1 August in Cairo (UTC+2 in winter,
    // +3 in summer; July is +3). The server month is July, Cairo's is August.
    const instant = new Date('2026-07-31T22:30:00Z');
    expect(instant.getUTCMonth()).toBe(6); // July — what the old code used
    expect(cairoMonthKey(instant)).toBe('2026-08'); // Cairo — what the header shows
  });

  it('does not roll over early in the middle of a month', () => {
    expect(cairoMonthKey(new Date('2026-08-05T12:00:00Z'))).toBe('2026-08');
  });

  it('keeps the previous month for an instant still inside it in Cairo', () => {
    // 00:30 UTC on 1 August is 03:30 Cairo on 1 August — both agree here.
    expect(cairoMonthKey(new Date('2026-08-01T00:30:00Z'))).toBe('2026-08');
    // 20:00 UTC on 31 July is 23:00 Cairo on 31 July — still July in both.
    expect(cairoMonthKey(new Date('2026-07-31T20:00:00Z'))).toBe('2026-07');
  });
});

describe('cairoMonthKeyPlusMonths', () => {
  it('walks backwards across a year boundary', () => {
    expect(cairoMonthKeyPlusMonths('2026-03', -5)).toBe('2025-10');
    expect(cairoMonthKeyPlusMonths('2026-01', -1)).toBe('2025-12');
  });

  it('walks forwards across a year boundary', () => {
    expect(cairoMonthKeyPlusMonths('2026-12', 1)).toBe('2027-01');
  });

  it('is the identity at zero', () => {
    expect(cairoMonthKeyPlusMonths('2026-08', 0)).toBe('2026-08');
  });
});

describe('startOfUtcInstantForCairoMonth', () => {
  it('returns the UTC instant Cairo midnight actually falls on, not UTC midnight', () => {
    // Cairo is UTC+3 in August (DST), so 1 August 00:00 Cairo = 31 July 21:00 UTC.
    expect(startOfUtcInstantForCairoMonth('2026-08').toISOString()).toBe('2026-07-31T21:00:00.000Z');
    // Cairo is UTC+2 in January, so 1 January 00:00 Cairo = 31 December 22:00 UTC.
    expect(startOfUtcInstantForCairoMonth('2026-01').toISOString()).toBe('2025-12-31T22:00:00.000Z');
  });
});

describe('cairoMonthUtcBounds', () => {
  it('is half-open, so the two adjacent months meet exactly and never overlap', () => {
    const july = cairoMonthUtcBounds('2026-07');
    const august = cairoMonthUtcBounds('2026-08');
    expect(july.endExclusive.toISOString()).toBe(august.start.toISOString());
  });

  it('places a 23:30-Cairo payment on the last day inside that month, not the next', () => {
    // 31 July 23:30 Cairo (UTC+3) = 31 July 20:30 UTC.
    const lateJuly = new Date('2026-07-31T20:30:00Z');
    const july = cairoMonthUtcBounds('2026-07');
    expect(lateJuly >= july.start).toBe(true);
    expect(lateJuly < july.endExclusive).toBe(true);

    const august = cairoMonthUtcBounds('2026-08');
    expect(lateJuly < august.start).toBe(true);
  });

  it('places a 00:30-Cairo payment on the 1st inside the NEW month', () => {
    // 1 August 00:30 Cairo = 31 July 21:30 UTC — the window the old server-local
    // code got wrong, because 31 July 21:30 UTC is still "July" to the server.
    const earlyAugust = new Date('2026-07-31T21:30:00Z');
    expect(earlyAugust.getUTCMonth()).toBe(6); // the server still says July

    const august = cairoMonthUtcBounds('2026-08');
    expect(earlyAugust >= august.start).toBe(true);
    expect(earlyAugust < august.endExclusive).toBe(true);

    const july = cairoMonthUtcBounds('2026-07');
    expect(earlyAugust < july.endExclusive).toBe(false);
  });

  it('spans a whole 31-day Cairo month with no DST gap or overlap', () => {
    const { start, endExclusive } = cairoMonthUtcBounds('2026-08');
    const hours = (endExclusive.getTime() - start.getTime()) / 3_600_000;
    expect(hours).toBe(31 * 24);
  });

  it('absorbs the autumn DST shift in the month that contains it', () => {
    // Egypt ends DST at the end of October, so the Cairo October window is one
    // hour LONGER than 31 calendar days in UTC terms. Asserted absolutely: a
    // fixed-offset reimplementation would return exactly 744 and fail here.
    const { start, endExclusive } = cairoMonthUtcBounds('2026-10');
    const hours = (endExclusive.getTime() - start.getTime()) / 3_600_000;
    expect(hours).toBe(31 * 24 + 1);
  });
});
