/**
 * `Merged-Admin-Platform` §01–§02 — the pure display maths behind the design's
 * bars, month axis and centre sub-line.
 *
 * These live here rather than beside the components that use them so they can
 * be tested without dragging `next-intl`'s client navigation into a node test
 * environment. Every one of them exists to stop the same failure: a
 * divide-by-zero or an absent value rendering as a confident number.
 */

import { formatDate } from '@/lib/formatNumber';

/**
 * Bar length as a percentage of the largest value in the set.
 *
 * A zero maximum means every value is zero — every bar renders empty rather
 * than dividing by zero and every bar rendering full, which would read as
 * "all months identical and maxed out" on a platform that has taken nothing.
 */
export function barHeightPct(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || value <= 0) return 0;
  return Math.min(100, Math.round((value / max) * 100));
}

/**
 * A source's share of the month's total, as a percentage.
 *
 * A zero or negative total means nothing was collected — every bar renders
 * empty. Dividing anyway would either throw Infinity into a style attribute or,
 * with a 0/0 guard that returns 100, draw three full bars over three zeroes.
 */
export function revenueMixSharePct(amount: number, total: number): number {
  if (!Number.isFinite(amount) || !Number.isFinite(total) || total <= 0 || amount <= 0) return 0;
  return Math.min(100, Math.round((amount / total) * 100));
}

/**
 * `YYYY-MM` → a short localised month name. Anything that is not a real
 * `YYYY-MM` is passed straight back rather than rendered as "Invalid Date".
 *
 * Formatted in UTC because the bucket key carries no day: letting the runtime
 * zone resolve `2026-01` would land on 31 December in any negative offset and
 * label a January bar "Dec".
 */
export function monthLabel(month: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  if (Number.isNaN(d.getTime())) return month;
  return formatDate(d, locale, { month: 'short', timeZone: 'UTC' });
}

/**
 * `Merged-Admin-Platform` §01 — the location half of the centre row's sub-line
 * ("Nasr City · 180 students").
 *
 * `centers.district` and `centers.city` both physically exist (verified in
 * `information_schema.columns`, 4 August 2026) and `/api/admin/centers` selects
 * `*`, so both arrive without an API change. District is finer than city, so it
 * wins when both are set; city is the fallback; neither set means no sub-line
 * at all. Nothing is derived from `delivery_address` — that is a shipping
 * destination, not where the centre is.
 */
export function centerLocationLine(c: {
  district?: string | null;
  city?: string | null;
}): string | null {
  const district = c.district?.trim();
  if (district) return district;
  const city = c.city?.trim();
  return city ? city : null;
}
