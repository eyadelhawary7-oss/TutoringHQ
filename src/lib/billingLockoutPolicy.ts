// src/lib/billingLockoutPolicy.ts
//
// The one gate that decides whether the single-day billing lockout is ALLOWED to
// take effect at all. It combines three independent guards; the lockout may lock,
// downgrade a teacher, or paywall a center only when ALL THREE hold:
//
//   1. The auto-charge interlock (THE critical one). Saved-card auto-charge must
//      be live. If PAYMOB_RECURRING_INTEGRATION_ID is unset, empty, or still the
//      literal "placeholder", the interlock is OFF and NOTHING locks. A one-day
//      window is only a safety net when the card charges itself at 00:00; with the
//      engine inert it would become a race every customer must win by hand, so the
//      lockout must physically refuse to fire. See the Job 3 brief.
//   2. summer.first_charge_release === 'RELEASED'. While HELD (the default and the
//      current live value) the whole policy cannot fire.
//   3. The kill switch billing.lockout.enabled is not explicitly false. This lets
//      the lockout be turned off without a deploy AFTER first_charge_release flips.
//
// When the policy is inactive, every enforcement point (middleware page redirect,
// the API-layer lock check, the 11:59 PM lock cron) treats every center as OPEN.
// The interlock being the ONLY thing that stops a lock is the one case that raises
// a Sentry warning (reason 'autocharge_not_configured'): it means someone flipped
// first_charge_release to RELEASED while the recurring credential is still a
// placeholder, which is exactly the outage this interlock exists to prevent.
//
// Values are read from the existing key-value platform_config store (never columns)
// so they can be tuned without a deploy. Reads are cached for a short TTL because
// the state is global and changes rarely; middleware may call this per request.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSummerConfig, type FirstChargeRelease } from '@/lib/summer/config';
import { getPaymobRecurringIntegrationId } from '@/lib/paymobConfig';
import { centerIsLockedNow, type CenterBillingRow } from '@/lib/billingAccessGate';

/** Kill switch. Absent or anything other than the boolean/`"false"` string => enabled. */
export const LOCKOUT_ENABLED_KEY = 'billing.lockout.enabled';
/** Cairo local "HH:MM" times the same-day card retries fire at. Capped by max attempts. */
export const LOCKOUT_RETRY_TIMES_KEY = 'billing.lockout.retry_times_cairo';
/** Cairo local "HH:MM" the second WhatsApp reminder fires at when still unpaid. */
export const LOCKOUT_REMINDER_TIME_KEY = 'billing.lockout.reminder_time_cairo';
/** Existing key: hard cap on same-day dunning attempts. */
export const DUNNING_MAX_ATTEMPTS_KEY = 'subscription_dunning_max_attempts';

export const LOCKOUT_CONFIG_KEYS = [
  LOCKOUT_ENABLED_KEY,
  LOCKOUT_RETRY_TIMES_KEY,
  LOCKOUT_REMINDER_TIME_KEY,
  DUNNING_MAX_ATTEMPTS_KEY,
] as const;

export const LOCKOUT_DEFAULTS = {
  /** Absent kill switch means the lockout is enabled (it is still gated by 1 and 2). */
  killSwitchEnabled: true,
  retryTimesCairo: ['09:00', '14:00', '19:00'],
  reminderTimeCairo: '17:00',
  maxAttempts: 3,
} as const;

/**
 * The auto-charge interlock. TRUE only when the recurring/MOTO integration id is a
 * real credential. Deliberately STRICTER than getPaymobRecurringIntegrationId():
 * the production env is literally "placeholder" (see .env.example), which trims to a
 * non-empty string, so a bare truthiness check would wrongly report "configured".
 * Env-only, so it is safe to call from edge middleware.
 *
 * ACCEPTED LIMIT: this validates the PRESENCE of a real-looking value, not that the
 * credential can actually charge a card. Unset / empty / "placeholder" read as OFF
 * (an unset value never reads as ON); any other non-empty value reads as ON (a
 * typo'd real value never reads as OFF). Proving the credential truly works is what
 * the one real test payment before flipping first_charge_release is for.
 */
export function recurringAutochargeConfigured(
  raw: string | undefined = getPaymobRecurringIntegrationId(),
): boolean {
  if (!raw) return false; // unset or empty (already trimmed by the accessor)
  const v = raw.trim().toLowerCase();
  if (v === '' || v === 'placeholder') return false;
  return true;
}

export type LockoutInactiveReason =
  | 'autocharge_not_configured'
  | 'first_charge_held'
  | 'kill_switch_off';

export interface LockoutPolicyState {
  /** Whether the lockout may lock/downgrade/paywall right now. */
  active: boolean;
  /** Why it is inactive (null when active). Only 'autocharge_not_configured' is Sentry-worthy. */
  reason: LockoutInactiveReason | null;
  retryTimesCairo: string[];
  reminderTimeCairo: string;
  maxAttempts: number;
}

export interface LockoutPolicyInput {
  firstChargeRelease: FirstChargeRelease;
  killSwitchEnabled: boolean;
  autochargeConfigured: boolean;
  retryTimesCairo: string[];
  reminderTimeCairo: string;
  maxAttempts: number;
}

/**
 * Pure evaluation of the three guards. Precedence is chosen so that
 * reason === 'autocharge_not_configured' fires ONLY when the interlock is the sole
 * blocker (release is RELEASED and the kill switch is on) — the one dangerous case
 * that must log loudly and raise a Sentry warning.
 */
export function evaluateLockoutPolicy(input: LockoutPolicyInput): LockoutPolicyState {
  let reason: LockoutInactiveReason | null = null;
  if (input.firstChargeRelease !== 'RELEASED') reason = 'first_charge_held';
  else if (!input.killSwitchEnabled) reason = 'kill_switch_off';
  else if (!input.autochargeConfigured) reason = 'autocharge_not_configured';
  return {
    active: reason === null,
    reason,
    retryTimesCairo: input.retryTimesCairo,
    reminderTimeCairo: input.reminderTimeCairo,
    maxAttempts: input.maxAttempts,
  };
}

/** Kill switch parse: only an explicit boolean false / "false" disables. */
export function parseKillSwitchEnabled(value: unknown): boolean {
  if (value === false) return false;
  if (typeof value === 'string' && value.trim().toLowerCase() === 'false') return false;
  return true;
}

/** Parse "HH:MM" (24h). Returns null when malformed. */
export function parseHhMm(value: unknown): { hour: number; minute: number } | null {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** Parse the retry-times value (JSON array or comma string of "HH:MM"), sorted, valid only. */
export function parseRetryTimes(value: unknown, fallback: string[]): string[] {
  let list: unknown[] = [];
  if (Array.isArray(value)) list = value;
  else if (typeof value === 'string') {
    const s = value.trim();
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) list = parsed;
      } catch {
        list = [];
      }
    } else if (s.length > 0) {
      list = s.split(',');
    }
  }
  const valid = list
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((x) => parseHhMm(x) !== null);
  if (valid.length === 0) return [...fallback];
  // De-dup and sort chronologically for stable per-day scheduling.
  const uniq = Array.from(new Set(valid));
  uniq.sort((a, b) => {
    const pa = parseHhMm(a)!;
    const pb = parseHhMm(b)!;
    return pa.hour * 60 + pa.minute - (pb.hour * 60 + pb.minute);
  });
  return uniq;
}

function toIntInRange(value: unknown, fallback: number, min: number, max: number): number {
  let n: number | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) n = value;
  else if (typeof value === 'string' && value.trim() !== '') {
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed)) n = parsed;
  }
  if (n == null) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/** Parse the four config rows into the tunable knobs (defaults applied per-key). */
export function parseLockoutConfigRows(rows: Record<string, unknown>): {
  killSwitchEnabled: boolean;
  retryTimesCairo: string[];
  reminderTimeCairo: string;
  maxAttempts: number;
} {
  const reminder = parseHhMm(rows[LOCKOUT_REMINDER_TIME_KEY]);
  return {
    killSwitchEnabled: LOCKOUT_ENABLED_KEY in rows
      ? parseKillSwitchEnabled(rows[LOCKOUT_ENABLED_KEY])
      : LOCKOUT_DEFAULTS.killSwitchEnabled,
    retryTimesCairo: parseRetryTimes(rows[LOCKOUT_RETRY_TIMES_KEY], [...LOCKOUT_DEFAULTS.retryTimesCairo]),
    reminderTimeCairo: reminder ? `${String(reminder.hour).padStart(2, '0')}:${String(reminder.minute).padStart(2, '0')}` : LOCKOUT_DEFAULTS.reminderTimeCairo,
    maxAttempts: toIntInRange(rows[DUNNING_MAX_ATTEMPTS_KEY], LOCKOUT_DEFAULTS.maxAttempts, 1, 10),
  };
}

/** Minimal shape of a Supabase client that can read platform_config. */
type ConfigReader = Pick<SupabaseClient, 'from'>;

function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function readLockoutRows(client: ConfigReader): Promise<Record<string, unknown>> {
  const { data } = await client
    .from('platform_config')
    .select('key, value')
    .in('key', [...LOCKOUT_CONFIG_KEYS, 'summer.first_charge_release']);
  const rows: Record<string, unknown> = {};
  for (const row of data ?? []) {
    rows[(row as { key: string }).key] = (row as { value: unknown }).value;
  }
  return rows;
}

// The state is GLOBAL (not per-user), so a short time cache is valid regardless of
// which client fetched it. Middleware calls this per request; the cache keeps that
// to at most one lightweight read per TTL window across the whole instance.
const STATE_TTL_MS = 30_000;
let cached: { state: LockoutPolicyState; at: number } | null = null;

/** Test-only: clear the module cache so a stubbed env/config is re-read. */
export function __resetLockoutPolicyCache(): void {
  cached = null;
}

/**
 * Resolve the live policy state. Pass an authenticated client (e.g. the middleware's
 * anon+cookie client) to avoid a service-role read in edge; omit it on node paths
 * (crons, API routes) to use the service-role client. Falls back to "inactive" on any
 * read failure so a transient error never wrongly paywalls a center.
 */
export async function getLockoutPolicyState(
  client?: ConfigReader,
  nowMs: number = Date.now(),
): Promise<LockoutPolicyState> {
  if (cached && nowMs - cached.at < STATE_TTL_MS) return cached.state;

  const autochargeConfigured = recurringAutochargeConfigured();
  let firstChargeRelease: FirstChargeRelease = 'HELD';
  let knobs: {
    killSwitchEnabled: boolean;
    retryTimesCairo: string[];
    reminderTimeCairo: string;
    maxAttempts: number;
  } = {
    killSwitchEnabled: LOCKOUT_DEFAULTS.killSwitchEnabled,
    retryTimesCairo: [...LOCKOUT_DEFAULTS.retryTimesCairo],
    reminderTimeCairo: LOCKOUT_DEFAULTS.reminderTimeCairo,
    maxAttempts: LOCKOUT_DEFAULTS.maxAttempts,
  };

  try {
    const reader = client ?? serviceClient();
    if (reader) {
      const rows = await readLockoutRows(reader);
      knobs = parseLockoutConfigRows(rows);
      // Read the release flag from the same round-trip when present; otherwise fall
      // back to the dedicated summer reader (service-role) so we never miss HELD.
      const rel = rows['summer.first_charge_release'];
      if (typeof rel === 'string' && rel.trim().toUpperCase() === 'RELEASED') {
        firstChargeRelease = 'RELEASED';
      } else if (typeof rel === 'string' && rel.trim().toUpperCase() === 'HELD') {
        firstChargeRelease = 'HELD';
      } else {
        firstChargeRelease = (await getSummerConfig()).firstChargeRelease;
      }
    } else {
      firstChargeRelease = (await getSummerConfig()).firstChargeRelease;
    }
  } catch {
    // Fail closed toward "inactive": leave HELD so nothing locks on a read error.
    firstChargeRelease = 'HELD';
  }

  const state = evaluateLockoutPolicy({
    firstChargeRelease,
    autochargeConfigured,
    ...knobs,
  });
  cached = { state, at: nowMs };
  return state;
}

/**
 * The single enforcement predicate every lock point must use. A center is locked
 * for enforcement ONLY when the policy is active AND the single-day rule says so.
 * When the policy is inactive (interlock off / HELD / kill switch), NO center is
 * ever locked — this is what makes the interlock a hard, global stop.
 */
export function isCenterLockedForEnforcement(
  row: CenterBillingRow,
  policyActive: boolean,
  now: Date = new Date(),
): boolean {
  if (!policyActive) return false;
  return centerIsLockedNow(row, now);
}
