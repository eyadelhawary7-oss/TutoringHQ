/** Billing calendar rules in Africa/Cairo (matches server withdrawal window). */

export function getTodayCairo(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function isWithdrawalWindowOpen(): boolean {
  const today = getTodayCairo();
  const dayOfMonth = parseInt(today.slice(8, 10), 10);
  const month = parseInt(today.slice(5, 7), 10);
  const isQuarterMonth = [1, 4, 7, 10].includes(month);
  return isQuarterMonth && dayOfMonth >= 1 && dayOfMonth <= 14;
}

/** Next Jan/Apr/Jul/Oct 1 on or after `ymd` (YYYY-MM-DD). */
export function nextQuarterFirstOnOrAfter(ymd: string): string {
  const [y0, m0, d0] = ymd.split('-').map((x) => parseInt(x, 10));
  for (let i = 0; i < 500; i++) {
    const dt = new Date(Date.UTC(y0, m0 - 1, d0 + i));
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    if ([1, 4, 7, 10].includes(m) && d === 1) {
      return `${y}-${String(m).padStart(2, '0')}-01`;
    }
  }
  return ymd;
}

/**
 * The quarter window in which a withdrawal requested on `ymd` will be processed.
 *
 * PAYOUT-SYSTEM-SPEC.md §2.4 — this used to unconditionally return the *next*
 * quarter, so a request made inside an open window was told to wait three
 * months for money it had just successfully requested:
 * `nextProcessingQuarterStart('2026-01-05')` returned `2026-04-01`, even though
 * 5 January is day 5 of the open January window.
 *
 * The only caller (`POST /api/billing/withdrawal`) reaches this line *after*
 * `isWithdrawalWindowOpen()` has already returned true, so in practice the
 * answer was wrong every single time it was shown.
 *
 * Correct behaviour: if `ymd` falls inside an open window (day 1–14 of a
 * quarter month), the request is processed in *that* window, so return the
 * quarter start we are currently in. Otherwise the next one.
 */
export function nextProcessingQuarterStart(ymd: string): string {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  const QUARTER_MONTHS = [1, 4, 7, 10];

  // Inside an open window: this request is handled by the window we are in.
  if (QUARTER_MONTHS.includes(m) && d >= 1 && d <= 14) {
    return `${y}-${String(m).padStart(2, '0')}-01`;
  }

  if (m <= 3) return `${y}-04-01`;
  if (m <= 6) return `${y}-07-01`;
  if (m <= 9) return `${y}-10-01`;
  return `${y + 1}-01-01`;
}
