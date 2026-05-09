/**
 * Cairo operating week: Saturday → Friday (common for Egyptian tutoring centers).
 * JS Date.getDay(): 0 = Sunday … 6 = Saturday.
 */

export const CAIRO_WEEK_START = 6;

/** Start of the Cairo week containing `d` (local calendar date, 00:00). */
export function startOfCairoWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = (day - CAIRO_WEEK_START + 7) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

/** ISO date keys (YYYY-MM-DD) for the 7 days of the Cairo week containing `anchor`. */
export function getCairoWeekDayKeys(anchor: Date): string[] {
  const start = startOfCairoWeek(anchor);
  const keys: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(start);
    dt.setDate(start.getDate() + i);
    keys.push(dt.toISOString().slice(0, 10));
  }
  return keys;
}

export type CairoWeekDayInfo = { dayKey: string; label: string };

/** Labels for chart axis / schedule headers (short EN weekday; long AR). */
export function getCairoWeekDays(anchor: Date, locale: string): CairoWeekDayInfo[] {
  const keys = getCairoWeekDayKeys(anchor);
  const isAr = locale === 'ar' || locale.startsWith('ar-');
  return keys.map((dayKey) => {
    const d = new Date(`${dayKey}T12:00:00`);
    const label = Number.isNaN(d.getTime())
      ? dayKey
      : isAr
        ? d.toLocaleDateString('ar-EG', { weekday: 'long' })
        : d.toLocaleDateString('en-US', { weekday: 'short' });
    return { dayKey, label };
  });
}
