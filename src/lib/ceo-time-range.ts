// All date arithmetic uses UTC to avoid timezone day-shift bugs.

export type RangeKey =
  | '7D'
  | '30D'
  | '90D'
  | '6M'
  | '1Y'
  | 'MTD'
  | 'QTD'
  | 'YTD'
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'last_quarter'
  | 'last_6_months'
  | 'this_year'
  | 'last_year'
  | 'all_time';

export interface ResolvedRange {
  key: RangeKey;
  from: string;
  to: string;
}

const fmt = (d: Date): string => d.toISOString().split('T')[0];

const firstOfMonth = (y: number, m: number): Date => new Date(Date.UTC(y, m, 1));

const lastOfMonth = (y: number, m: number): Date => new Date(Date.UTC(y, m + 1, 0));

/** Pills shown on CEO dashboard (URL ?range=) */
export const CEO_RANGE_PILLS: RangeKey[] = ['7D', '30D', '90D', '6M', '1Y', 'MTD', 'QTD', 'YTD'];

const LEGACY_RANGE_KEYS: RangeKey[] = [
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'last_6_months',
  'this_year',
  'last_year',
  'all_time',
];

export const DEFAULT_RANGE: RangeKey = '30D';

export const VALID_RANGE_KEYS: RangeKey[] = [...CEO_RANGE_PILLS, ...LEGACY_RANGE_KEYS];

export function isValidRangeKey(s: string | undefined): s is RangeKey {
  return (VALID_RANGE_KEYS as readonly string[]).includes(s ?? '');
}

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUtcDays(d: Date, delta: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + delta));
}

export function resolveRange(key: RangeKey = DEFAULT_RANGE): ResolvedRange {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const today = utcDay(now);

  const currentQ = Math.floor(m / 3);
  const qStart = currentQ * 3;
  const prevQStart = qStart - 3;

  switch (key) {
    case '7D':
      return { key, from: fmt(addUtcDays(today, -6)), to: fmt(today) };

    case '30D':
      return { key, from: fmt(addUtcDays(today, -29)), to: fmt(today) };

    case '90D':
      return { key, from: fmt(addUtcDays(today, -89)), to: fmt(today) };

    case '6M':
    case 'last_6_months':
      return {
        key,
        from: fmt(new Date(Date.UTC(y, m - 6, 1))),
        to: fmt(today),
      };

    case '1Y':
      return { key, from: fmt(addUtcDays(today, -364)), to: fmt(today) };

    case 'MTD':
    case 'this_month':
      return { key, from: fmt(firstOfMonth(y, m)), to: fmt(today) };

    case 'QTD':
    case 'this_quarter':
      return { key, from: fmt(firstOfMonth(y, qStart)), to: fmt(today) };

    case 'YTD':
    case 'this_year':
      return {
        key,
        from: fmt(new Date(Date.UTC(y, 0, 1))),
        to: fmt(today),
      };

    case 'last_month': {
      const ly = m === 0 ? y - 1 : y;
      const lm = m === 0 ? 11 : m - 1;
      return { key, from: fmt(firstOfMonth(ly, lm)), to: fmt(lastOfMonth(ly, lm)) };
    }

    case 'last_quarter': {
      const pqy = prevQStart < 0 ? y - 1 : y;
      const pqm = prevQStart < 0 ? prevQStart + 12 : prevQStart;
      return {
        key,
        from: fmt(firstOfMonth(pqy, pqm)),
        to: fmt(lastOfMonth(pqy, pqm + 2)),
      };
    }

    case 'last_year':
      return {
        key,
        from: fmt(new Date(Date.UTC(y - 1, 0, 1))),
        to: fmt(new Date(Date.UTC(y - 1, 11, 31))),
      };

    case 'all_time':
      return {
        key,
        from: '2025-01-01',
        to: fmt(today),
      };

    default:
      return resolveRange(DEFAULT_RANGE);
  }
}
