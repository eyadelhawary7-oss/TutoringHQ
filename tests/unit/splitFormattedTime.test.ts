import { describe, expect, it } from 'vitest';
import { formatTime, splitFormattedTime } from '@/lib/formatNumber';

/**
 * `splitFormattedTime` backs Merged-Center-Home §01's `.tm` leading column,
 * where the clock and the day period are two stacked type runs rather than one
 * string.
 *
 * The tests below assert the CONTRACT, not a hardcoded ICU rendering: the two
 * halves must recombine into exactly what `formatTime` produced (modulo the
 * separator), and the period must never be invented. Asserting a literal
 * "2:00" + "PM" would pin the suite to one ICU version's separator character,
 * which is the very thing this helper exists to absorb — modern ICU uses U+202F
 * before "PM" in en-US, older builds use U+0020.
 */
describe('splitFormattedTime', () => {
  it('splits an en-US afternoon time into clock and day period', () => {
    const { time, period } = splitFormattedTime('14:00', 'en');
    expect(time).toBe('2:00');
    expect(period).toBe('PM');
  });

  it('splits an en-US morning time', () => {
    const { time, period } = splitFormattedTime('09:30', 'en');
    expect(time).toBe('9:30');
    expect(period).toBe('AM');
  });

  it('midnight and noon keep their own day period', () => {
    expect(splitFormattedTime('00:00', 'en')).toEqual({ time: '12:00', period: 'AM' });
    expect(splitFormattedTime('12:00', 'en')).toEqual({ time: '12:00', period: 'PM' });
  });

  it('keeps Arabic-Indic digits and the Arabic day-period glyph for ar', () => {
    const { time, period } = splitFormattedTime('14:00', 'ar');
    // The clock run must carry Arabic-Indic numerals, not Western ones.
    expect(time).toMatch(/[٠-٩]/);
    expect(time).not.toMatch(/[0-9]/);
    // ص (AM) or م (PM) — never a Latin "PM" leaking into the Arabic frame.
    expect(['ص', 'م']).toContain(period);
  });

  it('never drops or duplicates content from formatTime', () => {
    for (const locale of ['en', 'ar']) {
      for (const hhmm of ['00:00', '09:30', '12:00', '14:00', '19:30', '23:45']) {
        const { time, period } = splitFormattedTime(hhmm, locale);
        const recombined = (period ? `${time} ${period}` : time).replace(/[\s‏]+/g, ' ').trim();
        const original = formatTime(hhmm, locale).replace(/[\s‏]+/g, ' ').trim();
        expect(recombined).toBe(original);
      }
    }
  });

  it('returns an empty period rather than inventing one when there is no second run', () => {
    // A value formatTime passes through unchanged: no clock match, no period.
    const { time, period } = splitFormattedTime('midday', 'en');
    expect(period).toBe('');
    expect(time).toBe('midday');
  });

  it('returns empty strings for an empty input instead of throwing', () => {
    expect(splitFormattedTime('', 'en')).toEqual({ time: '', period: '' });
  });

  /**
   * REGRESSION GUARD. A bare "HH:MM" — the shape `schedule_slots.start_time`
   * has — is a Cairo WALL-CLOCK time with no date and therefore no instant, so
   * no timezone conversion may touch it.
   *
   * `formatTime` used to anchor those digits in the DEVICE's timezone and then
   * render them in Cairo, applying an offset that does not exist. It cancelled
   * out on a Cairo device and was wrong everywhere else: this suite runs
   * TZ=UTC, where a 14:00 class rendered "4:00 PM". These assertions are
   * absolute values on purpose — the whole point is that the digits must not
   * depend on where the process is running.
   */
  it('does not shift a bare wall-clock time by the process timezone', () => {
    expect(process.env.TZ).toBe('UTC'); // the condition that exposed the bug
    expect(splitFormattedTime('14:00', 'en')).toEqual({ time: '2:00', period: 'PM' });
    expect(splitFormattedTime('19:30', 'en')).toEqual({ time: '7:30', period: 'PM' });
    expect(splitFormattedTime('06:15', 'en')).toEqual({ time: '6:15', period: 'AM' });
  });

  it('accepts seconds and an explicit day period without shifting either', () => {
    expect(splitFormattedTime('14:00:00', 'en')).toEqual({ time: '2:00', period: 'PM' });
    expect(splitFormattedTime('2:00 PM', 'en')).toEqual({ time: '2:00', period: 'PM' });
  });

  it('tolerates a narrow no-break space separator (U+202F) from modern ICU', () => {
    // Whichever separator this ICU build emits, the period must come back as a
    // clean run with no stray space characters clinging to it.
    const { period } = splitFormattedTime('14:00', 'en');
    expect(period).toBe(period.trim());
    expect(period).not.toMatch(/[\s  ]/);
  });
});
