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

export function nextProcessingQuarterStart(ymd: string): string {
  const [y, m] = ymd.split('-').map((x) => parseInt(x, 10));
  if (m <= 3) return `${y}-04-01`;
  if (m <= 6) return `${y}-07-01`;
  if (m <= 9) return `${y}-10-01`;
  return `${y + 1}-01-01`;
}
