import { describe, it, expect } from 'vitest';
import { initialsOf } from '@/lib/initials';
import { centerAttendanceRate, countAddOns } from '@/lib/centerAccountMetrics';
import { COMMISSION_TIERS, cairoMonthBounds } from '@/lib/referralProgram';
import { cairoDateKey } from '@/lib/cairo/day';

describe('initialsOf — Merged-Admin-Accounts avatar mark', () => {
  it('takes two letters from a two-word latin name', () => {
    expect(initialsOf('Dina Fouad')).toBe('DF');
    expect(initialsOf('omar farid')).toBe('OF');
  });

  it('takes two letters from a single latin word', () => {
    expect(initialsOf('Nafham')).toBe('NA');
  });

  it('takes ONE glyph for Arabic, and skips the article', () => {
    // Two disconnected Arabic letterforms read as neither name, so the design's
    // own Arabic frames show a single glyph.
    expect(initialsOf('النهضة')).toBe('ن');
    expect(initialsOf('دينا فؤاد')).toBe('د');
  });

  it('falls back rather than throwing on empty input', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf(null)).toBe('?');
    expect(initialsOf(undefined)).toBe('?');
  });
});

describe('centerAttendanceRate — §01 KPI tile', () => {
  const sessions = [
    { id: 's1', group_id: 'g1' },
    { id: 's2', group_id: 'g1' },
  ];
  const enrollments = [
    { group_id: 'g1' },
    { group_id: 'g1' },
    { group_id: 'g1' },
    { group_id: 'g1' },
  ]; // 4 enrolled in g1

  it('is Σ attendees ÷ (enrolled × finished sessions)', () => {
    const scans = [
      { session_id: 's1', student_id: 'a' },
      { session_id: 's1', student_id: 'b' },
      { session_id: 's1', student_id: 'c' },
      { session_id: 's2', student_id: 'a' },
    ];
    // (3 + 1) / (4 × 2) = 50%
    expect(centerAttendanceRate(sessions, scans, enrollments)).toBe(50);
  });

  it('counts a re-scanned student once', () => {
    const scans = [
      { session_id: 's1', student_id: 'a' },
      { session_id: 's1', student_id: 'a' },
      { session_id: 's1', student_id: 'a' },
    ];
    // 1 / 8 = 12.5%, not 3/8
    expect(centerAttendanceRate(sessions, scans, enrollments)).toBe(12.5);
  });

  it('never exceeds 100% when a walk-in is scanned into a session', () => {
    const scans = ['a', 'b', 'c', 'd', 'e', 'f'].map((student_id) => ({ session_id: 's1', student_id }));
    // 6 scanned into a 4-enrolled group is capped at 4 → 4/8 = 50%
    expect(centerAttendanceRate(sessions, scans, enrollments)).toBe(50);
  });

  it('returns null — not 0 — when there is nothing to measure', () => {
    // A centre with no finished sessions has no attendance rate. 0% would be a
    // claim the data does not make, and the tile drops out instead.
    expect(centerAttendanceRate([], [], enrollments)).toBeNull();
    expect(centerAttendanceRate(sessions, [], [])).toBeNull();
  });

  it('ignores sessions whose group has nobody enrolled', () => {
    const orphan = [{ id: 's9', group_id: 'g-empty' }];
    expect(centerAttendanceRate(orphan, [{ session_id: 's9', student_id: 'a' }], enrollments)).toBeNull();
  });
});

describe('countAddOns', () => {
  it('counts the parent pack when it is on', () => {
    expect(countAddOns({ parent_pack_enabled: true })).toBe(1);
    expect(countAddOns({ parent_pack_enabled: false })).toBe(0);
    expect(countAddOns({})).toBe(0);
  });
});

describe('COMMISSION_TIERS — design correction D2, live wins', () => {
  /**
   * The single source of truth is /api/referrals/process-commission:
   *   months === 1        → 0.25
   *   months <= 12        → 0.10
   *   else                → 0.05
   * The design draws "months 2 to 6" and "month 7 onward"; that is wrong and is
   * correction D2. This test is what stops the screen drifting back to it.
   */
  const liveRate = (months: number) => (months === 1 ? 25 : months <= 12 ? 10 : 5);

  const tierFor = (month: number) => {
    const t = COMMISSION_TIERS.find(
      (x) => month >= x.fromMonth && (x.toMonth == null || month <= x.toMonth),
    );
    if (!t) throw new Error(`no tier covers month ${month}`);
    return t.ratePct;
  };

  it('matches the live ladder at every month from 1 to 36', () => {
    for (let m = 1; m <= 36; m++) {
      expect(tierFor(m), `month ${m}`).toBe(liveRate(m));
    }
  });

  it('drops to 10% at month 2 and holds it through month 12', () => {
    expect(tierFor(2)).toBe(10);
    expect(tierFor(6)).toBe(10);
    // The month the design gets wrong: month 7 is still 10%, not 5%.
    expect(tierFor(7)).toBe(10);
    expect(tierFor(12)).toBe(10);
    expect(tierFor(13)).toBe(5);
  });

  it('covers every month with exactly one tier', () => {
    for (let m = 1; m <= 36; m++) {
      const hits = COMMISSION_TIERS.filter(
        (x) => m >= x.fromMonth && (x.toMonth == null || m <= x.toMonth),
      );
      expect(hits.length, `month ${m}`).toBe(1);
    }
  });
});

describe('cairoMonthBounds', () => {
  // Tests run TZ=UTC on purpose, so a Cairo boundary that is really UTC shows up.
  it('puts the month start before the instant it contains', () => {
    const now = new Date('2026-07-29T12:00:00Z');
    const b = cairoMonthBounds(now);
    expect(b.thisMonthKey).toBe('2026-07');
    expect(b.thisMonthStart.getTime()).toBeLessThan(now.getTime());
    expect(b.nextMonthStart.getTime()).toBeGreaterThan(now.getTime());
    expect(b.lastMonthStart.getTime()).toBeLessThan(b.thisMonthStart.getTime());
  });

  it('rolls the year at the January and December edges', () => {
    // Asserted in CAIRO days, not UTC ones. The bounds are UTC instants that
    // land in the *previous* UTC day, because Cairo is UTC+2/+3 — reading
    // getUTCMonth() off them is the bug this project keeps re-learning.
    const jan = cairoMonthBounds(new Date('2026-01-15T12:00:00Z'));
    expect(jan.thisMonthKey).toBe('2026-01');
    expect(cairoDateKey(jan.lastMonthStart)).toBe('2025-12-01');
    expect(cairoDateKey(jan.thisMonthStart)).toBe('2026-01-01');

    const dec = cairoMonthBounds(new Date('2026-12-15T12:00:00Z'));
    expect(dec.thisMonthKey).toBe('2026-12');
    expect(cairoDateKey(dec.nextMonthStart)).toBe('2027-01-01');
    expect(cairoDateKey(dec.lastMonthStart)).toBe('2026-11-01');
  });

  it('starts a Cairo month before UTC midnight of the first', () => {
    // Cairo is UTC+2/+3, so 1 July 00:00 Cairo is 30 June 21:00/22:00 UTC.
    const b = cairoMonthBounds(new Date('2026-07-15T12:00:00Z'));
    expect(b.thisMonthStart.toISOString() < '2026-07-01T00:00:00.000Z').toBe(true);
    expect(b.thisMonthStart.toISOString() > '2026-06-30T00:00:00.000Z').toBe(true);
  });
});
