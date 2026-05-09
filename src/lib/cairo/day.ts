/**
 * Cairo calendar day boundaries (Africa/Cairo) for scanner history and daily buckets.
 */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** YYYY-MM-DD in Africa/Cairo for the given instant. */
export function cairoDateKey(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

/** Parse YYYY-MM-DD to numeric parts (Cairo calendar, not timezone conversion). */
export function parseCairoYmd(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

function daysInGregorianMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Subtract calendar days in the Gregorian calendar (Cairo uses Gregorian dates). */
export function cairoYmdMinusDays(cairoYmd: string, deltaDays: number): string {
  let { y, m, d } = parseCairoYmd(cairoYmd);
  let day = d - deltaDays;
  while (day < 1) {
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    day += daysInGregorianMonth(y, m);
  }
  while (day > daysInGregorianMonth(y, m)) {
    day -= daysInGregorianMonth(y, m);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return `${y}-${pad2(m)}-${pad2(day)}`;
}

/**
 * Nominal instant at noon UTC on the Cairo calendar date `cairoYmd`.
 * Useful as a stable anchor for the Cairo "day" without loading a TZ database.
 */
export function startOfCairoDay(d: Date = new Date()): Date {
  const key = cairoDateKey(d);
  const { y, m, d: day } = parseCairoYmd(key);
  return new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
}
