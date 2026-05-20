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
  const parsed = parseCairoYmd(cairoYmd);
  let y = parsed.y;
  let m = parsed.m;
  let day = parsed.d - deltaDays;
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

/** Add calendar days on the Cairo/Gregorian calendar (inverse of cairoYmdMinusDays). */
export function cairoYmdPlusDays(cairoYmd: string, deltaDays: number): string {
  if (!deltaDays) return cairoYmd;
  if (deltaDays < 0) return cairoYmdMinusDays(cairoYmd, -deltaDays);
  const parsed = parseCairoYmd(cairoYmd);
  let y = parsed.y;
  let m = parsed.m;
  let day = parsed.d + deltaDays;
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

/** Wall-clock hour/minute in Africa/Cairo for `now`. */
export function getCurrentCairoClock(now: Date = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return { hour: hour === 24 ? 0 : hour, minute };
}

/**
 * First UTC instant that falls on Cairo calendar day `cairoYmd` (Africa/Cairo wall date).
 * Used to bound `paid_at` / daily payment windows so evening Cairo matches `cairoDateKey()`.
 */
export function startOfUtcInstantForCairoCalendarDay(cairoYmd: string): Date {
  const { y, m, d } = parseCairoYmd(cairoYmd);
  let lo = Date.UTC(y, m - 1, d - 1, 12, 0, 0);
  while (cairoDateKey(new Date(lo)) >= cairoYmd) {
    lo -= 24 * 60 * 60 * 1000;
  }
  let hi = Date.UTC(y, m - 1, d, 12, 0, 0);
  while (cairoDateKey(new Date(hi)) < cairoYmd) {
    hi += 24 * 60 * 60 * 1000;
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (cairoDateKey(new Date(mid)) < cairoYmd) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}

/** Inclusive-exclusive UTC range for the Cairo calendar day `cairoYmd`. */
export function cairoPaidAtDayUtcBounds(cairoYmd: string): { start: Date; endExclusive: Date } {
  const start = startOfUtcInstantForCairoCalendarDay(cairoYmd);
  const endExclusive = startOfUtcInstantForCairoCalendarDay(cairoYmdPlusDays(cairoYmd, 1));
  return { start, endExclusive };
}

/** Same Cairo day as `now` (per `cairoDateKey(now)`), for payment timestamp filters. */
export function cairoPaidAtBoundsForScanInstant(now: Date = new Date()): { startIso: string; endExclusiveIso: string } {
  const { start, endExclusive } = cairoPaidAtDayUtcBounds(cairoDateKey(now));
  return { startIso: start.toISOString(), endExclusiveIso: endExclusive.toISOString() };
}

/** Whether `paidAt` falls on the same Cairo calendar day as `now` (scanner "paid today"). */
export function isPaidAtWithinCairoDayOfInstant(paidAt: Date | string | number, now: Date): boolean {
  const { startIso, endExclusiveIso } = cairoPaidAtBoundsForScanInstant(now);
  const iso = typeof paidAt === 'string' ? paidAt : new Date(paidAt).toISOString();
  return iso >= startIso && iso < endExclusiveIso;
}
