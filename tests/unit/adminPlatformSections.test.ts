/**
 * `Merged-Admin-Platform` §01–§03, §06 — the pure helpers behind this pass's
 * builds.
 *
 * Everything here guards the same class of bug: a divide-by-zero or an absent
 * measurement rendering as a confident number. On a platform with 2 centres
 * (both test rows) and 0 privacy requests live, that is the failure that would
 * actually ship.
 */

import { describe, it, expect } from 'vitest';
import {
  buildIntegrationHealth,
  PINGED_SERVICES,
  type StatusCheckRow,
} from '@/lib/adminIntegrationHealth';
import {
  daysUntilDue,
  primaryPrivacyTag,
  privacyQueueCounts,
} from '@/components/admin/PrivacyQueueHeader';
import {
  barHeightPct,
  centerLocationLine,
  monthLabel,
  revenueMixSharePct,
} from '@/lib/adminPlatformDisplay';

const NOW = new Date('2026-08-04T12:00:00.000Z');

function check(
  service: string,
  status: string,
  minutesAgo: number,
  ms: number | null = 120,
): StatusCheckRow {
  return {
    service,
    status,
    response_time_ms: ms,
    checked_at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
  };
}

describe('buildIntegrationHealth — §03 vendors frame', () => {
  it('returns exactly the three pinged services, in order, even with no rows', () => {
    const out = buildIntegrationHealth([], NOW);
    expect(out.map((r) => r.service)).toEqual([...PINGED_SERVICES]);
  });

  it('reports an unpinged service as unknown with a null rate, never 0%', () => {
    const out = buildIntegrationHealth([], NOW);
    for (const row of out) {
      expect(row.status).toBe('unknown');
      // The whole point: "not measured" must not render as "failed every time".
      expect(row.successRate24h).toBeNull();
      expect(row.checks24h).toBe(0);
      expect(row.lastCheckedAt).toBeNull();
    }
  });

  it('takes the newest ping as the current status regardless of row order', () => {
    const rows = [
      check('api', 'outage', 600),
      check('api', 'operational', 3),
      check('api', 'degraded', 120),
    ];
    const api = buildIntegrationHealth(rows, NOW).find((r) => r.service === 'api');
    expect(api?.status).toBe('operational');
    expect(api?.lastCheckedAt).toBe(rows[1].checked_at);
  });

  it('computes the 24h success rate over the window, not over every row given', () => {
    const rows = [
      check('payments', 'operational', 10),
      check('payments', 'operational', 20),
      check('payments', 'outage', 30),
      check('payments', 'degraded', 40),
      // Outside the window — must not dilute the rate.
      check('payments', 'outage', 60 * 30),
      check('payments', 'outage', 60 * 40),
    ];
    const pay = buildIntegrationHealth(rows, NOW).find((r) => r.service === 'payments');
    expect(pay?.checks24h).toBe(4);
    expect(pay?.successRate24h).toBe(50);
  });

  it('rounds the rate rather than truncating it', () => {
    const rows = [
      check('scanner', 'operational', 1),
      check('scanner', 'operational', 2),
      check('scanner', 'degraded', 3),
    ];
    const scanner = buildIntegrationHealth(rows, NOW).find((r) => r.service === 'scanner');
    expect(scanner?.successRate24h).toBe(67);
  });

  it('normalises an unrecognised status value to unknown instead of passing it through', () => {
    const scanner = buildIntegrationHealth([check('scanner', 'wobbly', 1)], NOW).find(
      (r) => r.service === 'scanner',
    );
    expect(scanner?.status).toBe('unknown');
  });

  it('skips rows with an unparseable timestamp rather than producing NaN', () => {
    const rows: StatusCheckRow[] = [
      { service: 'api', status: 'operational', response_time_ms: 5, checked_at: 'not-a-date' },
      check('api', 'operational', 5),
    ];
    const api = buildIntegrationHealth(rows, NOW).find((r) => r.service === 'api');
    expect(api?.checks24h).toBe(1);
    expect(api?.successRate24h).toBe(100);
  });

  it('ignores services nothing pings, so a stray row cannot invent a vendor', () => {
    const out = buildIntegrationHealth([check('valify', 'operational', 1)], NOW);
    expect(out.map((r) => r.service)).toEqual([...PINGED_SERVICES]);
    expect(out.every((r) => r.status === 'unknown')).toBe(true);
  });
});

describe('daysUntilDue — §06 countdown pill', () => {
  it('is null when there is no due date', () => {
    expect(daysUntilDue(null, NOW)).toBeNull();
  });

  it('is null for an unparseable due date rather than NaN', () => {
    expect(daysUntilDue('whenever', NOW)).toBeNull();
  });

  it('rounds a part-day up so 18 hours left reads as 1 day, not 0', () => {
    const due = new Date(NOW.getTime() + 18 * 60 * 60 * 1000).toISOString();
    expect(daysUntilDue(due, NOW)).toBe(1);
  });

  it('returns whole days for a clean multiple', () => {
    const due = new Date(NOW.getTime() + 5 * 86400000).toISOString();
    expect(daysUntilDue(due, NOW)).toBe(5);
  });

  it('goes negative when overdue instead of clamping to zero', () => {
    const due = new Date(NOW.getTime() - 3 * 86400000).toISOString();
    expect(daysUntilDue(due, NOW)).toBe(-3);
  });
});

describe('primaryPrivacyTag — §06 row tag', () => {
  it('has no tag for an empty or null type list', () => {
    expect(primaryPrivacyTag(null)).toBeNull();
    expect(primaryPrivacyTag([])).toBeNull();
  });

  it('leads with deletion when a request carries several types', () => {
    expect(primaryPrivacyTag(['access', 'deletion', 'portability'])).toBe('deletion');
  });

  it('falls back to access before portability', () => {
    expect(primaryPrivacyTag(['portability', 'access'])).toBe('access');
  });

  it('uses the stored value portability, not the display word export', () => {
    expect(primaryPrivacyTag(['portability'])).toBe('portability');
    expect(primaryPrivacyTag(['export'])).toBeNull();
  });

  it('returns null for an unrecognised type rather than mislabelling the row', () => {
    expect(primaryPrivacyTag(['correction'])).toBeNull();
  });
});

describe('barHeightPct — §02 revenue and by-plan bars', () => {
  it('draws nothing when every value is zero, rather than everything full', () => {
    // 0/0 guarded to 0. The alternative — treating "max is 0" as "this IS the
    // max" — paints six full bars over six months of no revenue.
    expect(barHeightPct(0, 0)).toBe(0);
  });

  it('is proportional to the largest value in the set', () => {
    expect(barHeightPct(50, 200)).toBe(25);
    expect(barHeightPct(200, 200)).toBe(100);
  });

  it('never exceeds 100 even if a value somehow overshoots the max', () => {
    expect(barHeightPct(400, 200)).toBe(100);
  });

  it('returns 0 for negative or non-finite input instead of a negative width', () => {
    expect(barHeightPct(-10, 200)).toBe(0);
    expect(barHeightPct(10, Number.NaN)).toBe(0);
    expect(barHeightPct(Number.POSITIVE_INFINITY, 200)).toBe(0);
  });
});

describe('monthLabel — §02 month axis', () => {
  it('renders a short month name for a YYYY-MM bucket', () => {
    expect(monthLabel('2026-07', 'en')).toBe('Jul');
  });

  it('reads the month in UTC so a Cairo-offset date cannot slip a month', () => {
    expect(monthLabel('2026-01', 'en')).toBe('Jan');
    expect(monthLabel('2026-12', 'en')).toBe('Dec');
  });

  it('passes an unrecognised bucket straight through instead of "Invalid Date"', () => {
    expect(monthLabel('', 'en')).toBe('');
    expect(monthLabel('2026-7', 'en')).toBe('2026-7');
    expect(monthLabel('July', 'en')).toBe('July');
  });
});

describe('revenueMixSharePct — §01 revenue mix bars', () => {
  it('is a share of the month total', () => {
    expect(revenueMixSharePct(86, 100)).toBe(86);
  });

  it('is 0 for every source when nothing was collected', () => {
    expect(revenueMixSharePct(0, 0)).toBe(0);
  });

  it('is 0 rather than negative when a total is negative', () => {
    expect(revenueMixSharePct(50, -10)).toBe(0);
  });
});

describe('centerLocationLine — §01 centre row sub-line', () => {
  it('prefers district, the finer of the two columns', () => {
    expect(centerLocationLine({ district: 'Nasr City', city: 'Cairo' })).toBe('Nasr City');
  });

  it('falls back to city when district is unset', () => {
    expect(centerLocationLine({ district: null, city: 'Alexandria' })).toBe('Alexandria');
  });

  it('renders nothing when neither is set — no placeholder location', () => {
    expect(centerLocationLine({ district: null, city: null })).toBeNull();
    expect(centerLocationLine({})).toBeNull();
  });

  it('treats a whitespace-only value as unset', () => {
    expect(centerLocationLine({ district: '   ', city: '  ' })).toBeNull();
    expect(centerLocationLine({ district: '  ', city: 'Giza' })).toBe('Giza');
  });
});

describe('privacyQueueCounts — unchanged behaviour this pass depends on', () => {
  it('counts an already-overdue open request as due soon', () => {
    const counts = privacyQueueCounts(
      [
        { status: 'pending', due_at: new Date(NOW.getTime() - 86400000).toISOString(), request_types: ['deletion'] },
        { status: 'completed', due_at: null, request_types: ['access'] },
      ],
      NOW,
    );
    expect(counts).toEqual({ open: 1, dueSoon: 1, closed: 1 });
  });
});
