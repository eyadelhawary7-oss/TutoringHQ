/**
 * Defaults for platform_config rows that must appear in /admin/platform-config
 * even when DB migrations have not inserted them yet.
 */
export const PLATFORM_CONFIG_INSERT_DEFAULTS: Record<string, number> = {
  blast_price_per_parent: 8,
  announcement_cap_monthly: 2,
  data_deletion_days: 90,
  qr_card_price: 55,
};

export type PlatformConfigRow = { key: string; value: unknown };

export function mergeMissingPlatformConfigRows<T extends PlatformConfigRow>(rows: T[]): T[] {
  const map = new Map<string, T>(rows.map((r) => [r.key, r]));
  for (const [key, defaultValue] of Object.entries(PLATFORM_CONFIG_INSERT_DEFAULTS)) {
    if (!map.has(key)) {
      map.set(key, { key, value: defaultValue } as T);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}
