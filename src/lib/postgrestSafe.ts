const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * PostgREST `.or()` filter fragments embed literal values in strings.
 * Only pass values that match strict YYYY-MM-DD (no time, no extra characters).
 */
export function assertIsoDateForOrFilter(value: string, label: string): string {
  if (!ISO_DATE.test(value)) {
    throw new Error(`[postgrestSafe] Invalid ISO date for ${label}`);
  }
  return value;
}

const EGYPT_DAY_KEYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] as const;

/** Build `day_of_week.eq.<n>,day_of_week.eq.<key>` for schedule_slots (server-derived index only). */
export function orClauseDayOfWeekEgypt(egyptDay: number): string {
  if (!Number.isInteger(egyptDay) || egyptDay < 0 || egyptDay > 6) {
    throw new Error('[postgrestSafe] egyptDay must be integer 0–6');
  }
  const key = EGYPT_DAY_KEYS[egyptDay];
  return `day_of_week.eq.${egyptDay},day_of_week.eq.${key}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CENTER_LOOKUP_SLUG = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Safe fragment for `.or()` when resolving a center by public `center_code` or UUID `id`.
 * Rejects tokens that could break PostgREST filter syntax.
 */
export function orClauseCenterByCodeOrId(centerToken: string): string | null {
  if (UUID_RE.test(centerToken)) {
    return `center_code.eq.${centerToken},id.eq.${centerToken}`;
  }
  if (CENTER_LOOKUP_SLUG.test(centerToken)) {
    return `center_code.eq.${centerToken}`;
  }
  return null;
}
