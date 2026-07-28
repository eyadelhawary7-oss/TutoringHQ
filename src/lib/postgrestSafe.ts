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

/*
 * `orClauseDayOfWeekEgypt` lived here and has been REMOVED. It built
 * `day_of_week.eq.<n>,day_of_week.eq.<sat|sun|…>` from an Egypt-week index,
 * `(jsDay + 1) % 7`.
 *
 * Both halves were wrong. The index matched the day AFTER the intended one,
 * because `schedule_slots.day_of_week` stores a JS weekday. The day-name half
 * matched nothing at all — no writer has ever put a day name in that column —
 * so it read as a safety net while contributing zero rows, and its presence is
 * part of why the off-by-one survived review.
 *
 * The single source of truth is now `scheduleSlotsDayOfWeek` in
 * `@/lib/cairo/week`, and the comparison is a plain `.eq()`, not an `.or()`.
 */

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
