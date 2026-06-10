/**
 * Dashboard session cache for instant rehydrate of `safeData.totalStudents`
 * et al. Scoped by user+center and TTL-bounded so a stale snapshot from a
 * prior session, prior centre, or earlier point in time cannot persist
 * across reloads/tab-restores and mislead the operator.
 *
 * Background: the dashboard renders `students.length` from a client-side
 * `dbSelect('students')` keyed only by center_id (locale-independent). The
 * old cache key was a single global string (`chq_dashboard_cache_v5`),
 * which meant a snapshot written in one session was happily rehydrated in
 * another - producing locale-correlated "ghost counts" whenever two tabs
 * happened to start from different cached states (e.g. /ar opened first
 * when the centre had N students, /en opened later after the count
 * changed, both keep showing their own stale value until a fresh fetch
 * lands). Scoping the key by user+center and rejecting entries past
 * `DASHBOARD_CACHE_TTL_MS` closes the leak.
 */

export const DASHBOARD_CACHE_PREFIX = 'chq_dashboard_cache_v6';

/** 10 minutes. Long enough to be useful on tab restore, short enough that an
 *  edit a few minutes ago is not perpetually masked by the cache. */
export const DASHBOARD_CACHE_TTL_MS = 10 * 60 * 1000;

export interface DashboardCacheScope {
  userId: string;
  centerId: string;
}

export interface DashboardCacheEnvelope<T> {
  scope: DashboardCacheScope;
  data: T;
}

export function dashboardCacheKey(scope: DashboardCacheScope): string {
  return `${DASHBOARD_CACHE_PREFIX}:${scope.userId}:${scope.centerId}`;
}

type Validator<T> = (value: unknown) => value is T;

export interface ReadOptions<T extends { generatedAt?: string }> {
  scope: DashboardCacheScope;
  now: number;
  storage: Pick<Storage, 'getItem'> | null;
  validate: Validator<T>;
  ttlMs?: number;
}

/**
 * Returns the cached payload only when (a) the envelope scope matches the
 * caller's scope, (b) the payload's `generatedAt` is within TTL, and
 * (c) the caller-provided `validate` shape-check passes. Otherwise null.
 */
export function readDashboardCache<T extends { generatedAt?: string }>(
  options: ReadOptions<T>,
): T | null {
  const { scope, now, storage, validate, ttlMs = DASHBOARD_CACHE_TTL_MS } = options;
  if (!storage) return null;
  try {
    const raw = storage.getItem(dashboardCacheKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const envelope = parsed as { scope?: DashboardCacheScope; data?: unknown };
    if (
      envelope.scope?.userId !== scope.userId ||
      envelope.scope?.centerId !== scope.centerId
    ) {
      return null;
    }
    if (!validate(envelope.data)) return null;
    const generatedAt = (envelope.data as { generatedAt?: string }).generatedAt;
    if (!generatedAt) return null;
    const ageMs = now - new Date(generatedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > ttlMs) return null;
    return envelope.data as T;
  } catch {
    return null;
  }
}

export interface WriteOptions<T> {
  scope: DashboardCacheScope;
  data: T;
  storage: Pick<Storage, 'setItem'> | null;
}

export function writeDashboardCache<T>(options: WriteOptions<T>): void {
  const { scope, data, storage } = options;
  if (!storage) return;
  try {
    const envelope: DashboardCacheEnvelope<T> = { scope, data };
    storage.setItem(dashboardCacheKey(scope), JSON.stringify(envelope));
  } catch {
    /* private mode / quota - non-fatal */
  }
}
