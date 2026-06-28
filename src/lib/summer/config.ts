// src/lib/summer/config.ts
//
// The Summer-2026 control surface. All knobs live in the existing key-value
// `platform_config` store (never columns) and are editable from the super-admin
// pricing/promo panel with no rebuild. Six keys:
//
//   summer.promo.enabled        bool    master kill switch (hides ribbon+popup, disables summer mode)
//   summer.free_until           date    SUMMER_FREE_UNTIL   (free for everyone until)
//   summer.first_charge_floor   date    FIRST_CHARGE_FLOOR  (first invoice never before)
//   summer.trial_days           number  TRIAL_DAYS          (trial length in days)
//   summer.pay_window_days      number  PAY_WINDOW_DAYS     (payable days before lock)
//   summer.first_charge_release text    HELD | RELEASED     (one-time hold on first invoices)
//
// Parsing is pure (testable); the server reader uses the service-role client, the
// same pattern as pricingConfig.ts. Hardcoded fallbacks mirror the migration
// defaults so callers get sane values even before the migration runs.

import { createClient } from '@supabase/supabase-js';
import type { SummerScheduleConfig } from '@/lib/summer/dates';

export const SUMMER_ENABLED_KEY = 'summer.promo.enabled';
export const SUMMER_FREE_UNTIL_KEY = 'summer.free_until';
export const SUMMER_FIRST_CHARGE_FLOOR_KEY = 'summer.first_charge_floor';
export const SUMMER_TRIAL_DAYS_KEY = 'summer.trial_days';
export const SUMMER_PAY_WINDOW_DAYS_KEY = 'summer.pay_window_days';
export const SUMMER_FIRST_CHARGE_RELEASE_KEY = 'summer.first_charge_release';

export const SUMMER_CONFIG_KEYS = [
  SUMMER_ENABLED_KEY,
  SUMMER_FREE_UNTIL_KEY,
  SUMMER_FIRST_CHARGE_FLOOR_KEY,
  SUMMER_TRIAL_DAYS_KEY,
  SUMMER_PAY_WINDOW_DAYS_KEY,
  SUMMER_FIRST_CHARGE_RELEASE_KEY,
] as const;

export type SummerConfigKey = (typeof SUMMER_CONFIG_KEYS)[number];

/** First-charge release flag — HELD (default) blocks all first invoices; RELEASED lets them fire. */
export type FirstChargeRelease = 'HELD' | 'RELEASED';

export interface SummerConfig extends SummerScheduleConfig {
  /** Master switch. When false, summer mode is OFF everywhere (ribbon, popup, billing). */
  enabled: boolean;
  /** One-time hold on the money side. Default HELD until a live test payment is confirmed. */
  firstChargeRelease: FirstChargeRelease;
}

export const SUMMER_CONFIG_DEFAULTS: SummerConfig = {
  enabled: false,
  freeUntil: '2026-08-16',
  firstChargeFloor: '2026-08-30',
  trialDays: 14,
  payWindowDays: 2,
  firstChargeRelease: 'HELD',
};

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return fallback;
}

function intIn(value: unknown, fallback: number, min: number): number {
  let n: number | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) n = value;
  else if (typeof value === 'string' && value.trim() !== '') {
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed)) n = parsed;
  }
  if (n == null || !Number.isFinite(n)) return fallback;
  return Math.max(min, Math.floor(n));
}

/** Accept "YYYY-MM-DD" (possibly JSON-quoted); fall back when malformed. */
function ymd(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  return fallback;
}

function release(value: unknown, fallback: FirstChargeRelease): FirstChargeRelease {
  if (typeof value === 'string') {
    const s = value.trim().toUpperCase();
    if (s === 'RELEASED') return 'RELEASED';
    if (s === 'HELD') return 'HELD';
  }
  return fallback;
}

/** Pure parse of a key→raw-value map into a typed SummerConfig (used by the reader + tests). */
export function parseSummerConfig(rows: Record<string, unknown>): SummerConfig {
  return {
    enabled: bool(rows[SUMMER_ENABLED_KEY], SUMMER_CONFIG_DEFAULTS.enabled),
    freeUntil: ymd(rows[SUMMER_FREE_UNTIL_KEY], SUMMER_CONFIG_DEFAULTS.freeUntil),
    firstChargeFloor: ymd(rows[SUMMER_FIRST_CHARGE_FLOOR_KEY], SUMMER_CONFIG_DEFAULTS.firstChargeFloor),
    trialDays: intIn(rows[SUMMER_TRIAL_DAYS_KEY], SUMMER_CONFIG_DEFAULTS.trialDays, 0),
    payWindowDays: intIn(rows[SUMMER_PAY_WINDOW_DAYS_KEY], SUMMER_CONFIG_DEFAULTS.payWindowDays, 1),
    firstChargeRelease: release(rows[SUMMER_FIRST_CHARGE_RELEASE_KEY], SUMMER_CONFIG_DEFAULTS.firstChargeRelease),
  };
}

function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Server-side read of all summer keys. Falls back to defaults when DB unreachable. */
export async function getSummerConfig(): Promise<SummerConfig> {
  const client = svc();
  if (!client) return { ...SUMMER_CONFIG_DEFAULTS };
  const { data } = await client
    .from('platform_config')
    .select('key, value')
    .in('key', SUMMER_CONFIG_KEYS as unknown as string[]);
  const rows: Record<string, unknown> = {};
  for (const row of data ?? []) {
    rows[(row as { key: string }).key] = (row as { value: unknown }).value;
  }
  return parseSummerConfig(rows);
}

/** Summer mode is the master switch AND the release flag. Both must hold for money to move. */
export function summerModeActive(cfg: SummerConfig): boolean {
  return cfg.enabled === true;
}

/** First invoices may fire only when the master switch is on AND the hold is released. */
export function firstChargeAllowed(cfg: SummerConfig): boolean {
  return cfg.enabled === true && cfg.firstChargeRelease === 'RELEASED';
}
