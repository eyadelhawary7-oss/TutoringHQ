/**
 * Quarterly subscription anchor: next_payment_due after a successful Paymob renewal.
 * Anchor date chain: subscription_start_date → billing_cycle_start → approved_at::date.
 */

import { cairoDateKey } from '@/lib/cairo/day';

function parseYmd(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  return { y, m, d };
}

function formatYmd(y: number, m0: number, day: number): string {
  return `${y}-${String(m0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** Anchor calendar day (1–31), snapping 29 → 28 in Feb when the month has no 29th. */
function clampDayForMonth(year: number, month0: number, anchorDay: number): number {
  const dim = daysInMonth(year, month0);
  if (month0 === 1 && anchorDay === 29 && dim < 29) return 28;
  return Math.min(anchorDay, dim);
}

function utcDateFromYmd(ymd: string): number {
  const { y, m, d } = parseYmd(ymd);
  return Date.UTC(y, m - 1, d);
}

/** Add whole calendar months to a YYYY-MM-DD (UTC calendar arithmetic). */
export function addMonthsToDateStr(ymd: string, months: number): string {
  const { y, m, d } = parseYmd(ymd);
  const dt = new Date(Date.UTC(y, m - 1 + months, 1));
  const ny = dt.getUTCFullYear();
  const nm = dt.getUTCMonth();
  const day = clampDayForMonth(ny, nm, d);
  return formatYmd(ny, nm, day);
}

export type AnchorCenterFields = {
  next_payment_due: string | null;
  subscription_start_date?: string | null;
  billing_cycle_start?: string | null;
  approved_at?: string | null;
};

/**
 * Next due: first occurrence of anchor_day on/after (next_payment_due + N months)::date.
 * `periodMonths` is the billing cadence length — 3 for quarterly centers, 12 for
 * annual (see centerRenewalPeriodMonths). The anchor-day snapping is cadence-
 * agnostic: it always lands the due date on the subscription's anchor day-of-month.
 */
export function computeNextPaymentDue(center: AnchorCenterFields, periodMonths: number): string {
  const months = Number.isFinite(periodMonths) && periodMonths > 0 ? Math.trunc(periodMonths) : 3;
  const due = center.next_payment_due;
  if (!due) {
    // L9: Cairo calendar day, not UTC — avoids an off-by-one near Cairo midnight.
    return addMonthsToDateStr(cairoDateKey(new Date()), months);
  }

  const anchorYmd =
    center.subscription_start_date?.slice(0, 10) ||
    center.billing_cycle_start?.slice(0, 10) ||
    (center.approved_at ? center.approved_at.slice(0, 10) : null);

  const cursorYmd = addMonthsToDateStr(due, months);
  const cursorTs = utcDateFromYmd(cursorYmd);

  if (!anchorYmd) {
    return cursorYmd;
  }

  const anchorDay = parseYmd(anchorYmd).d;
  const c = parseYmd(cursorYmd);
  let y = c.y;
  let m0 = c.m - 1;

  for (let k = 0; k < 48; k++) {
    const day = clampDayForMonth(y, m0, anchorDay);
    const cand = formatYmd(y, m0, day);
    if (utcDateFromYmd(cand) >= cursorTs) {
      return cand;
    }
    m0 += 1;
    if (m0 > 11) {
      m0 = 0;
      y += 1;
    }
  }

  return cursorYmd;
}

/**
 * Next quarterly due (+3 months). Thin wrapper over computeNextPaymentDue — the
 * historical center default. Kept for the many non-annual call sites so their
 * behaviour stays byte-identical.
 */
export function computeNextQuarterlyPaymentDue(center: AnchorCenterFields): string {
  return computeNextPaymentDue(center, 3);
}

/** Safety cap on catch-up iterations — 600 monthly periods is 50 years; no real
 * stale-data scenario needs more, and this stops a pathological input from
 * looping indefinitely. */
const MAX_CATCH_UP_PERIODS = 600;

export interface CatchUpResult {
  /** First due date on or after `now`, period-aware and anchor-day-snapped. */
  nextDue: string;
  /** How many WHOLE periods beyond the single ordinary advance were skipped
   * because the stored due date was more than one period stale. Zero for the
   * ordinary case (one missed cron cycle, a payment made on the due day, etc). */
  periodsSkipped: number;
}

/**
 * computeNextPaymentDue, but never lands in the past. A single `+periodMonths`
 * advance assumes at most one period was missed; if `next_payment_due` sat
 * unpaid for LONGER than that (e.g. the auto-suspend interlock was off, or a
 * cron outage), that one advance can still land before `now` — and the center
 * would re-enter the blocked state the instant it finishes paying. This keeps
 * advancing whole periods (anchor-day-snapped, same as computeNextPaymentDue)
 * until the result is on or after `now`.
 *
 * Does NOT bill for the skipped periods — this only moves the clock forward.
 * `periodsSkipped` is for the caller to log/alert on; catching up silently
 * would hide a center that has been unpaid for an unusually long stretch.
 */
export function computeNextPaymentDueCatchUp(
  center: AnchorCenterFields,
  periodMonths: number,
  now: Date = new Date(),
): CatchUpResult {
  const todayYmd = cairoDateKey(now);
  let candidate = computeNextPaymentDue(center, periodMonths);
  let periodsSkipped = 0;
  let cursor: AnchorCenterFields = center;

  while (candidate < todayYmd && periodsSkipped < MAX_CATCH_UP_PERIODS) {
    periodsSkipped += 1;
    cursor = { ...cursor, next_payment_due: candidate };
    candidate = computeNextPaymentDue(cursor, periodMonths);
  }

  return { nextDue: candidate, periodsSkipped };
}
