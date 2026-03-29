// All date arithmetic uses UTC to avoid timezone day-shift bugs.

export type RangeKey =
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

export const DEFAULT_RANGE: RangeKey = 'this_month';

export const VALID_RANGE_KEYS: RangeKey[] = [
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'last_6_months',
  'this_year',
  'last_year',
  'all_time',
];

export function isValidRangeKey(s: string | undefined): s is RangeKey {
  return (VALID_RANGE_KEYS as readonly string[]).includes(s ?? '');
}

export function resolveRange(key: RangeKey = DEFAULT_RANGE): ResolvedRange {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  const currentQ = Math.floor(m / 3);
  const qStart = currentQ * 3;
  const prevQStart = qStart - 3;

  switch (key) {
    case 'this_month':
      return { key, from: fmt(firstOfMonth(y, m)), to: fmt(now) };

    case 'last_month': {
      const ly = m === 0 ? y - 1 : y;
      const lm = m === 0 ? 11 : m - 1;
      return { key, from: fmt(firstOfMonth(ly, lm)), to: fmt(lastOfMonth(ly, lm)) };
    }

    case 'this_quarter':
      return { key, from: fmt(firstOfMonth(y, qStart)), to: fmt(now) };

    case 'last_quarter': {
      const pqy = prevQStart < 0 ? y - 1 : y;
      const pqm = prevQStart < 0 ? prevQStart + 12 : prevQStart;
      return {
        key,
        from: fmt(firstOfMonth(pqy, pqm)),
        to: fmt(lastOfMonth(pqy, pqm + 2)),
      };
    }

    case 'last_6_months':
      return {
        key,
        from: fmt(new Date(Date.UTC(y, m - 6, 1))),
        to: fmt(now),
      };

    case 'this_year':
      return {
        key,
        from: fmt(new Date(Date.UTC(y, 0, 1))),
        to: fmt(now),
      };

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
        to: fmt(now),
      };

    default:
      return resolveRange('this_month');
  }
}
