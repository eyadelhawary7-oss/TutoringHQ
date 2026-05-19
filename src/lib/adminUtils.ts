import { formatNumber } from '@/lib/formatNumber';

/**
 * Canonical center-count semantics for ALL admin KPI surfaces.
 *
 * - "Total Centers" = count(centers WHERE status != 'deleted' AND is_test = false)
 * - "Active Centers" = count(centers WHERE status = 'active' AND is_test = false)
 *
 * `is_test = false` is the default for every admin aggregate (see CLAUDE.md).
 * Use the `include_test=1` query string only as a documented diagnostic.
 *
 * Pages that label a KPI "Total Centers" (admin overview, /admin/billing,
 * /admin/analytics) MUST source from queries that match the Total filter.
 * Pages labeled "Active Centers" (/admin/finance, /admin/health, /ceo-dashboard)
 * MUST source from queries that match the Active filter. Misalignment between
 * label and underlying query is the cause of cross-page KPI drift.
 */
export const ADMIN_CENTER_COUNT_SEMANTICS = Object.freeze({
  totalLabel: 'totalCenters',
  activeLabel: 'activeCenters',
} as const);

/** Tailwind class strings keyed by center / subscription status. */
export const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-700',
  trial: 'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-700',
};

export function centerStatusLabel(
  status: string | undefined,
  tStatus: (key: string) => string,
): string {
  const s = (status || 'active').toLowerCase().replace(/-/g, '_');
  const known = new Set([
    'active',
    'suspended',
    'pending',
    'trial',
    'rejected',
    'cancelled',
    'pending_payment',
    'paid',
    'overdue',
  ]);
  if (known.has(s)) return tStatus(s);
  return tStatus('active');
}

export function formatAdminLastActiveDisplay(
  raw: string | null | undefined,
  locale: string,
  tAdmin: (key: string, values?: Record<string, string>) => string,
): string {
  const s = raw?.trim() ?? '';
  if (!s || /^never$/i.test(s)) return tAdmin('neverActive');
  const m = s.match(/^(\d+)\s*days?\s*ago$/i);
  if (m) {
    const days = parseInt(m[1]!, 10);
    return tAdmin('daysAgo', { days: formatNumber(days, locale) });
  }
  return s;
}

export function isAdminLastActiveStaleRaw(raw: string | null | undefined): boolean {
  const s = raw?.trim() ?? '';
  return /^never$/i.test(s) || /\bdays?\s*ago$/i.test(s) || s.toLowerCase().includes('days');
}
