/**
 * Cairo operating week: Saturday → Friday (common for Egyptian tutoring centers).
 * JS Date.getDay(): 0 = Sunday … 6 = Saturday.
 */

import { cairoDateKey, cairoYmdMinusDays, cairoYmdPlusDays, parseCairoYmd } from '@/lib/cairo/day';

export const CAIRO_WEEK_START = 6;

/** JS weekday (0 Sun … 6 Sat) for a Cairo calendar YYYY-MM-DD. */
export function cairoYmdToJsWeekday(cairoYmd: string): number {
  const { y, m, d } = parseCairoYmd(cairoYmd);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
}

/** First day (Saturday) of the Cairo week containing `cairoYmd`, as YYYY-MM-DD. */
export function startOfCairoWeekKey(cairoYmd: string): string {
  const wd = cairoYmdToJsWeekday(cairoYmd);
  const diff = (wd - CAIRO_WEEK_START + 7) % 7;
  return cairoYmdMinusDays(cairoYmd, diff);
}

/** Seven YYYY-MM-DD keys for the Cairo week containing `now` (Africa/Cairo calendar). */
export function getCairoWeekDayKeys(now: Date = new Date()): string[] {
  const key = cairoDateKey(now);
  const start = startOfCairoWeekKey(key);
  return Array.from({ length: 7 }, (_, i) => cairoYmdPlusDays(start, i));
}

/** Start of Cairo week containing `d`, as a UTC noon anchor (for legacy range compares). */
export function startOfCairoWeek(d: Date): Date {
  const startKey = startOfCairoWeekKey(cairoDateKey(d));
  const { y, m, d: dayNum } = parseCairoYmd(startKey);
  return new Date(Date.UTC(y, m - 1, dayNum, 12, 0, 0));
}

export type CairoWeekDayInfo = { dayKey: string; label: string; jsWeekday: number };

/** Schedule columns: Saturday → Friday; each entry matches DB schedule_slots.day_of_week (JS weekday). */
export function getCairoWeekColumnOrder(): number[] {
  return [6, 0, 1, 2, 3, 4, 5];
}

/** Labels for chart axis / schedule headers (short EN weekday; long AR). Cairo week Sat→Fri. */
export function getCairoWeekDays(now: Date, locale: string): CairoWeekDayInfo[] {
  const keys = getCairoWeekDayKeys(now);
  const isAr = locale === 'ar' || locale.startsWith('ar-');
  return keys.map((dayKey) => {
    const d = new Date(`${dayKey}T12:00:00Z`);
    const label = Number.isNaN(d.getTime())
      ? dayKey
      : isAr
        ? d.toLocaleDateString('ar-EG', { weekday: 'long', timeZone: 'UTC' })
        : d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    return { dayKey, label, jsWeekday: cairoYmdToJsWeekday(dayKey) };
  });
}
