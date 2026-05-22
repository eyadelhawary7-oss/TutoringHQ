import { describe, it, expect } from 'vitest';
import {
  dashboardCacheKey,
  readDashboardCache,
  writeDashboardCache,
  DASHBOARD_CACHE_PREFIX,
  DASHBOARD_CACHE_TTL_MS,
} from '@/lib/dashboardCache';

interface Snapshot {
  totalStudents: number;
  trendData: { dayKey: string; count: number }[];
  generatedAt: string;
}

const isSnapshot = (v: unknown): v is Snapshot =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as Snapshot).totalStudents === 'number' &&
  Array.isArray((v as Snapshot).trendData);

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

const SCOPE_A = { userId: 'user-a', centerId: 'center-x' };
const SCOPE_B = { userId: 'user-b', centerId: 'center-x' };
const SCOPE_C = { userId: 'user-a', centerId: 'center-y' };

describe('dashboardCacheKey', () => {
  it('includes both user and center so two operators on one tab never collide', () => {
    expect(dashboardCacheKey(SCOPE_A)).toBe(`${DASHBOARD_CACHE_PREFIX}:user-a:center-x`);
    expect(dashboardCacheKey(SCOPE_A)).not.toBe(dashboardCacheKey(SCOPE_B));
    expect(dashboardCacheKey(SCOPE_A)).not.toBe(dashboardCacheKey(SCOPE_C));
  });
});

describe('readDashboardCache + writeDashboardCache', () => {
  it('round-trips a fresh snapshot for the same scope', () => {
    const storage = makeStorage();
    const now = Date.parse('2026-05-22T10:00:00Z');
    const snap: Snapshot = {
      totalStudents: 50,
      trendData: [{ dayKey: '2026-05-22', count: 5 }],
      generatedAt: new Date(now).toISOString(),
    };
    writeDashboardCache({ scope: SCOPE_A, data: snap, storage });
    const read = readDashboardCache<Snapshot>({
      scope: SCOPE_A,
      now,
      storage,
      validate: isSnapshot,
    });
    expect(read?.totalStudents).toBe(50);
  });

  it('refuses to serve another user\'s snapshot (the dashboard-ghost-count bug)', () => {
    const storage = makeStorage();
    const now = Date.parse('2026-05-22T10:00:00Z');
    // User A cached a snapshot showing 50 students at center X.
    writeDashboardCache({
      scope: SCOPE_A,
      data: {
        totalStudents: 50,
        trendData: [{ dayKey: '2026-05-22', count: 5 }],
        generatedAt: new Date(now).toISOString(),
      } satisfies Snapshot,
      storage,
    });
    // User B (different account, same tab/origin) must NOT see A's 50.
    const read = readDashboardCache<Snapshot>({
      scope: SCOPE_B,
      now,
      storage,
      validate: isSnapshot,
    });
    expect(read).toBeNull();
  });

  it('refuses to serve a snapshot from a different center', () => {
    const storage = makeStorage();
    const now = Date.parse('2026-05-22T10:00:00Z');
    writeDashboardCache({
      scope: SCOPE_A,
      data: {
        totalStudents: 50,
        trendData: [],
        generatedAt: new Date(now).toISOString(),
      } satisfies Snapshot,
      storage,
    });
    const read = readDashboardCache<Snapshot>({
      scope: SCOPE_C,
      now,
      storage,
      validate: isSnapshot,
    });
    expect(read).toBeNull();
  });

  it('rejects snapshots older than the TTL so stale counts do not persist', () => {
    const storage = makeStorage();
    const writtenAt = Date.parse('2026-05-22T10:00:00Z');
    const now = writtenAt + DASHBOARD_CACHE_TTL_MS + 1;
    writeDashboardCache({
      scope: SCOPE_A,
      data: {
        totalStudents: 4,
        trendData: [],
        generatedAt: new Date(writtenAt).toISOString(),
      } satisfies Snapshot,
      storage,
    });
    const read = readDashboardCache<Snapshot>({
      scope: SCOPE_A,
      now,
      storage,
      validate: isSnapshot,
    });
    expect(read).toBeNull();
  });

  it('accepts snapshots within the TTL', () => {
    const storage = makeStorage();
    const writtenAt = Date.parse('2026-05-22T10:00:00Z');
    const now = writtenAt + DASHBOARD_CACHE_TTL_MS - 1;
    writeDashboardCache({
      scope: SCOPE_A,
      data: {
        totalStudents: 4,
        trendData: [],
        generatedAt: new Date(writtenAt).toISOString(),
      } satisfies Snapshot,
      storage,
    });
    const read = readDashboardCache<Snapshot>({
      scope: SCOPE_A,
      now,
      storage,
      validate: isSnapshot,
    });
    expect(read?.totalStudents).toBe(4);
  });

  it('returns null when validate rejects the shape (corrupt rehydrate)', () => {
    const storage = makeStorage();
    const now = Date.parse('2026-05-22T10:00:00Z');
    storage.setItem(
      dashboardCacheKey(SCOPE_A),
      JSON.stringify({ scope: SCOPE_A, data: { totalStudents: 'not-a-number' } }),
    );
    const read = readDashboardCache<Snapshot>({
      scope: SCOPE_A,
      now,
      storage,
      validate: isSnapshot,
    });
    expect(read).toBeNull();
  });

  it('returns null when storage is unavailable (SSR)', () => {
    const now = Date.parse('2026-05-22T10:00:00Z');
    const read = readDashboardCache<Snapshot>({
      scope: SCOPE_A,
      now,
      storage: null,
      validate: isSnapshot,
    });
    expect(read).toBeNull();
  });
});
