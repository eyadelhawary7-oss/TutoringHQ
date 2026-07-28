import { describe, it, expect } from 'vitest';
import { cairoDateKey } from '@/lib/cairo/day';
import { cairoYmdToJsWeekday, scheduleSlotsDayOfWeek } from '@/lib/cairo/week';

/**
 * Regression guard for the `schedule_slots.day_of_week` convention.
 *
 * The column is `text` with no enum and no CHECK, so nothing in the database
 * rejects a wrong value — a reader using the wrong convention returns zero rows
 * or the wrong day's rows, silently, forever. That is invisible to review and
 * to CI unless something asserts the convention, which is what this file is for.
 *
 * THE WRITER DEFINES IT: ScheduleSlotsEditor (days 0..6, Sun..Sat) →
 * propose_group_slot (`v_dow := p_day_of_week::text`) → confirm_group_slot →
 * schedule_slots. So the stored value is a JS weekday rendered as text.
 *
 * Two readers disagreed and both shipped broken. Each has a named test below.
 *
 * Suite runs TZ=UTC (see package.json), which is also how the crons run — so a
 * helper that leaked the process timezone would fail here rather than in Cairo.
 */

// 2026-01-01 is a Thursday. Dates below are derived from that anchor.
const SUNDAY = '2026-07-26';
const MONDAY = '2026-07-27';
const SATURDAY = '2026-08-01';

describe('scheduleSlotsDayOfWeek — the writer’s convention', () => {
  it('renders a JS weekday as text, Sunday "0" through Saturday "6"', () => {
    expect(scheduleSlotsDayOfWeek(SUNDAY)).toBe('0');
    expect(scheduleSlotsDayOfWeek(MONDAY)).toBe('1');
    expect(scheduleSlotsDayOfWeek(SATURDAY)).toBe('6');
  });

  it('agrees with cairoYmdToJsWeekday for every day of a week', () => {
    for (let i = 0; i < 7; i++) {
      const ymd = `2026-07-${String(26 + i).padStart(2, '0')}`;
      expect(scheduleSlotsDayOfWeek(ymd)).toBe(String(cairoYmdToJsWeekday(ymd)));
    }
  });

  it('only ever produces a single digit 0-6', () => {
    for (let i = 0; i < 14; i++) {
      const ymd = `2026-07-${String(14 + i).padStart(2, '0')}`;
      expect(scheduleSlotsDayOfWeek(ymd)).toMatch(/^[0-6]$/);
    }
  });
});

describe('reader 2 regression — the daily summary must not use an Egypt-week index', () => {
  /**
   * Old behaviour: `getEgyptDayOfWeek` returned `(jsDay + 1) % 7`, and the query
   * matched `day_of_week` against that. Because the stored value is a JS
   * weekday, a row matched when its real day was one LATER than the target — so
   * the summary's absentee count came off the next day's timetable.
   *
   * This fails under the old code for all seven days.
   */
  it('never returns the day after the one asked for', () => {
    for (const ymd of [SUNDAY, MONDAY, SATURDAY, '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31']) {
      const correct = cairoYmdToJsWeekday(ymd);
      const egyptIndex = String((correct + 1) % 7);
      expect(scheduleSlotsDayOfWeek(ymd)).toBe(String(correct));
      expect(scheduleSlotsDayOfWeek(ymd)).not.toBe(egyptIndex);
    }
  });

  it('maps Saturday to "6", not the Egypt-week "0"', () => {
    // The clearest single case: the two conventions disagree most visibly at the
    // ends of the Egyptian week.
    expect(scheduleSlotsDayOfWeek(SATURDAY)).toBe('6');
    expect(scheduleSlotsDayOfWeek(SUNDAY)).toBe('0');
  });
});

describe('reader 3 regression — the parent absence alert must not use day names', () => {
  /**
   * Old behaviour: `getDayOfWeek()` returned "monday", compared with `.eq()`
   * against a column holding "1". Zero rows matched on every run since the
   * feature shipped, so no parent has ever received an absence alert.
   *
   * This fails under the old code because "monday" is not /^[0-6]$/.
   */
  it('produces a numeric string, never a day name', () => {
    const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (const ymd of [SUNDAY, MONDAY, SATURDAY]) {
      const value = scheduleSlotsDayOfWeek(ymd);
      expect(value).toMatch(/^[0-6]$/);
      expect(names).not.toContain(value);
    }
  });
});

describe('Cairo offset — crons run in UTC and must still resolve the Cairo day', () => {
  /**
   * Egypt observes DST from the last Friday of April to the last Thursday of
   * October: UTC+3 in summer, UTC+2 otherwise. The offset is resolved through
   * the IANA zone rather than hand-coded, so these assert the OUTCOME.
   *
   * Both instants fall on a different calendar day in UTC than in Cairo, so a
   * helper reading the UTC day would return the previous day's weekday.
   */
  it('summer, UTC+3: 21:30Z belongs to the next Cairo day', () => {
    const instant = new Date('2026-07-27T21:30:00Z'); // 00:30 on 2026-07-28 in Cairo
    expect(cairoDateKey(instant)).toBe('2026-07-28');
    expect(scheduleSlotsDayOfWeek(cairoDateKey(instant))).toBe('2'); // Tuesday
    // The UTC day would be Monday — the bug this guards against.
    expect(scheduleSlotsDayOfWeek(cairoDateKey(instant))).not.toBe('1');
  });

  it('winter, UTC+2: 22:30Z belongs to the next Cairo day', () => {
    const instant = new Date('2026-01-15T22:30:00Z'); // 00:30 on 2026-01-16 in Cairo
    expect(cairoDateKey(instant)).toBe('2026-01-16');
    expect(scheduleSlotsDayOfWeek(cairoDateKey(instant))).toBe('5'); // Friday
    expect(scheduleSlotsDayOfWeek(cairoDateKey(instant))).not.toBe('4');
  });

  it('winter, UTC+2: 21:30Z is still the SAME Cairo day', () => {
    // Distinguishes +2 from +3: at 21:30Z a summer date would already have
    // rolled over, a winter one has not.
    const instant = new Date('2026-01-15T21:30:00Z'); // 23:30 on 2026-01-15 in Cairo
    expect(cairoDateKey(instant)).toBe('2026-01-15');
    expect(scheduleSlotsDayOfWeek(cairoDateKey(instant))).toBe('4'); // Thursday
  });
});
