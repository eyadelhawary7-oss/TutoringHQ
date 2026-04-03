/**
 * Quarterly subscription anchor: next_payment_due after a successful Paymob renewal.
 * Anchor date chain: subscription_start_date → billing_cycle_start → approved_at::date (no billing_start_date).
 */

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
 * Next quarterly due: first occurrence of anchor_day on/after (next_payment_due + 3 months)::date.
 * All centers use quarterly billing per product rules.
 */
export function computeNextQuarterlyPaymentDue(center: AnchorCenterFields): string {
  const due = center.next_payment_due;
  if (!due) {
    return addMonthsToDateStr(new Date().toISOString().slice(0, 10), 3);
  }

  const anchorYmd =
    center.subscription_start_date?.slice(0, 10) ||
    center.billing_cycle_start?.slice(0, 10) ||
    (center.approved_at ? center.approved_at.slice(0, 10) : null);

  const cursorYmd = addMonthsToDateStr(due, 3);
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
