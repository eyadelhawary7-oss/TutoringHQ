// src/lib/collectionPayout/config.ts
//
// ██ THE ONE CONFIG POINT for online collection and payout System 1. ██
//
// Eyad, 4 August 2026: "Externalities are not blockers for code. Build the
// complete flow against ONE clearly named config point with placeholder values,
// failing visibly." and "Fail visibly, never fake success."
//
// This module IS that config point. Everything the collection-and-payout path
// needs from the outside world — the Paymob Payouts rail credentials, the payout
// callback HMAC secret, the delegate approval cap, the collection rate card
// switch — is resolved here and nowhere else. No other module in
// src/lib/collectionPayout/ or src/app/api/{collection,admin/payouts,webhooks/
// payout-provider,cron/payout-reconciliation}/ reads process.env or
// platform_config for these values.
//
// WHY ONE POINT: the credentials do not exist. Paymob Payouts onboarding is
// manual on their side and has not started (PAYOUT-SYSTEM-SPEC.md §8). Valify
// credentials do not exist either. So every one of these keys ships holding a
// placeholder, and the entire path must refuse loudly rather than pretend. When
// the credentials arrive, they land here and nowhere else.
//
// HOW IT FAILS: `loadCollectionPayoutConfig()` returns a discriminated union.
// When `configured` is false it carries a NAMED, USER-LEGIBLE cause list. Every
// consumer must branch on it and surface the cause. A consumer that ignores the
// union and reads a credential anyway will read the literal placeholder string
// and the provider will reject it — but that is the second line of defence, not
// the first.
//
// WHAT IT NEVER DOES: it never returns a default that would let money move, it
// never substitutes a test credential for a live one, and it never reports
// `configured: true` on a partially-filled config.

import type { SupabaseClient } from '@supabase/supabase-js';

/** Stable identifier for this config surface, quoted in every refusal payload. */
export const COLLECTION_PAYOUT_CONFIG_POINT = 'src/lib/collectionPayout/config.ts';

// ── Environment keys ────────────────────────────────────────────────────────
// All six ship as placeholders in .env.example. Named with one prefix so a
// deployment audit can grep a single string.

export const ENV_KEYS = {
  /** Paymob Payouts base URL, e.g. https://payouts.paymobsolutions.com/api/secure/ */
  railBaseUrl: 'COLLECTION_PAYOUT_RAIL_BASE_URL',
  /** OAuth2 client_id — one of the four mandatory Payouts credentials (§8). */
  railClientId: 'COLLECTION_PAYOUT_RAIL_CLIENT_ID',
  /** OAuth2 client_secret. */
  railClientSecret: 'COLLECTION_PAYOUT_RAIL_CLIENT_SECRET',
  /** OAuth2 username (grant_type=password). */
  railUsername: 'COLLECTION_PAYOUT_RAIL_USERNAME',
  /** OAuth2 password. */
  railPassword: 'COLLECTION_PAYOUT_RAIL_PASSWORD',
  /**
   * Shared secret for the payout provider callback HMAC.
   *
   * PAYOUT-SYSTEM-SPEC.md §8 question 4: the payout HMAC algorithm, field order
   * and transport are UNDOCUMENTED, and HMAC is OFF BY DEFAULT at Paymob and
   * must be requested from the account manager. Until this holds a real secret
   * the webhook cannot authenticate anything, so it rejects every callback
   * (attack A1 — callback replay drains the platform).
   */
  railCallbackHmacSecret: 'COLLECTION_PAYOUT_RAIL_CALLBACK_HMAC_SECRET',
} as const;

export type EnvKeyName = (typeof ENV_KEYS)[keyof typeof ENV_KEYS];

/**
 * The env shape these readers need. Deliberately looser than `NodeJS.ProcessEnv`
 * (which requires NODE_ENV) so a test can pass an exact, minimal record and
 * prove what happens with NOTHING set — the case that matters most here.
 */
export type EnvRecord = Record<string, string | undefined>;

// ── platform_config keys ────────────────────────────────────────────────────

export const PLATFORM_CONFIG_KEYS = {
  /**
   * The master switch for online student-fee collection. LIVE VALUE VERIFIED
   * 2026-08-04 against project lczmjpnbuhnsislcvzar: the row EXISTS with
   * value `false`, updated_at 2026-06-19T21:14:03Z.
   *
   * PAYOUT-SYSTEM-SPEC.md §0 and §9 both say this key "has no row in
   * platform_config at all". That is STALE — the row is there. Behaviour is
   * unchanged (still dormant) but an INSERT-based migration would collide.
   */
  collectionEnabled: 'digital_student_fee_collection.enabled',
  /**
   * The B1 rate card. LIVE VALUE VERIFIED 2026-08-04:
   *   {"vat_pct":0.14,"teacher_pct":0,"customer_pct":0,"processing_flat":0}
   * All the money percentages are ZERO, which is the dormant state. A zeroed
   * rate card is treated as UNCONFIGURED, not as "collection is free" — quoting
   * a 0% collection fee would be a fabricated split.
   */
  lessonCommission: 'lesson_commission',
  /**
   * Delegate approval cap, in PIASTRES.
   *
   * PAYOUT-SYSTEM-SPEC.md §11: "the cap config key NAMES ITS UNIT explicitly
   * (`payout_delegate_cap_minor`, piastres — not a bare `..._cap` that reads as
   * EGP to the next person who touches it)". Decided value is 10,000 EGP =
   * 1,000,000 piastres. VERIFIED 2026-08-04: this key has NO ROW in
   * platform_config. Absent ⇒ delegated approval is unavailable entirely and
   * every payout goes to the CEO. It never defaults to a number.
   */
  delegateCapMinor: 'payout_delegate_cap_minor',
  /**
   * Rolling-7-day per-centre approval cap, in PIASTRES (§7.2 anti-splitting).
   * VERIFIED 2026-08-04: no row. Absent ⇒ delegated approval unavailable.
   */
  delegateWindowCapMinor: 'payout_delegate_window_cap_minor',
  /**
   * Kill switch (§7 controls: "a kill switch that halts all releases, reachable
   * without a deploy"). Absent or true ⇒ releases halted. FAIL CLOSED: the
   * switch must be explicitly `false` for releases to be permitted, so a
   * missing row halts rather than releases.
   */
  releasesHalted: 'payout_releases_halted',
} as const;

// ── Placeholder detection ───────────────────────────────────────────────────

/**
 * Values that mean "nobody has filled this in". Matched case-insensitively.
 * `.env.example` in this repo already uses `placeholder` and `your-key-here`,
 * so those are included rather than inventing a new convention.
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^placeholder/i,
  /placeholder$/i,
  /^your-key-here$/i,
  /^changeme$/i,
  /^todo$/i,
  /^tbd$/i,
  /^not[-_ ]?configured$/i,
  /^replace[-_ ]?me$/i,
  /^example\.com$/i,
  /^https?:\/\/example\.com/i,
];

/** True when `raw` is absent, blank, or one of the recognised placeholders. */
export function isPlaceholderValue(raw: string | undefined | null): boolean {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (v === '') return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(v));
}

// ── Result shape ────────────────────────────────────────────────────────────

/**
 * A machine-readable cause. Each maps to an i18n key under
 * `collectionPayout.cause.*` in messages/ar.json and messages/en.json, so every
 * refusal is legible to the person who hit it and not only to a log reader.
 */
export type ConfigCause =
  | 'rail_credentials_placeholder'
  | 'rail_callback_hmac_placeholder'
  | 'collection_switch_off'
  | 'rate_card_unset'
  | 'delegate_cap_unset'
  | 'releases_halted'
  | 'config_unreadable';

export interface ConfigProblem {
  cause: ConfigCause;
  /** i18n key. Present in both ar.json and en.json. */
  messageKey: string;
  /** The env keys or platform_config keys that must be filled to clear it. */
  keys: string[];
}

export function problem(cause: ConfigCause, keys: string[]): ConfigProblem {
  return { cause, messageKey: `collectionPayout.cause.${cause}`, keys };
}

/** The B1 rate card, resolved. All rates are fractions, never percentages. */
export interface RateCard {
  /** Collection fee taken from the provider. B1 locks 0.10. */
  collectionFeeRate: number;
  /** Price markup rate applied to the provider fee. B1 locks 0.075. */
  markupRate: number;
  /** Flat EGP added to the markup. B1 locks 7.5. */
  markupFlatEgp: number;
  /** Parent processing fee rate on the provider price. B1 locks 0.015. */
  parentFeeRate: number;
  /** Flat EGP added to the parent processing fee. B1 locks 1.5. */
  parentFeeFlatEgp: number;
  /** VAT fraction. 0.14, inclusive. */
  vatRate: number;
}

export interface RailCredentials {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  callbackHmacSecret: string;
}

export type CollectionPayoutConfig =
  | {
      configured: true;
      configPoint: string;
      rail: RailCredentials;
      rateCard: RateCard;
      collectionEnabled: true;
      delegateCapMinor: number;
      delegateWindowCapMinor: number;
      releasesHalted: false;
    }
  | {
      configured: false;
      configPoint: string;
      /** Never empty when `configured` is false. */
      problems: ConfigProblem[];
      /**
       * Sub-readiness, so a caller can tell a centre "collection is off" without
       * also implying the payout rail is fine. Both false today.
       */
      collectionReady: false;
      payoutReady: false;
    };

// ── Env-only read (sync, pure, no I/O) ──────────────────────────────────────

export interface RailEnvReadResult {
  present: boolean;
  missing: EnvKeyName[];
  /** Raw values. NEVER log these; they are read back only by the rail client. */
  values: RailCredentials;
}

/**
 * Read the six rail env keys. Pure apart from `process.env`, so it is unit
 * testable by stubbing the env record.
 */
export function readRailEnv(env: EnvRecord = process.env): RailEnvReadResult {
  const pick = (k: EnvKeyName) => (typeof env[k] === 'string' ? (env[k] as string).trim() : '');
  const values: RailCredentials = {
    baseUrl: pick(ENV_KEYS.railBaseUrl),
    clientId: pick(ENV_KEYS.railClientId),
    clientSecret: pick(ENV_KEYS.railClientSecret),
    username: pick(ENV_KEYS.railUsername),
    password: pick(ENV_KEYS.railPassword),
    callbackHmacSecret: pick(ENV_KEYS.railCallbackHmacSecret),
  };
  const missing: EnvKeyName[] = [];
  if (isPlaceholderValue(values.baseUrl)) missing.push(ENV_KEYS.railBaseUrl);
  if (isPlaceholderValue(values.clientId)) missing.push(ENV_KEYS.railClientId);
  if (isPlaceholderValue(values.clientSecret)) missing.push(ENV_KEYS.railClientSecret);
  if (isPlaceholderValue(values.username)) missing.push(ENV_KEYS.railUsername);
  if (isPlaceholderValue(values.password)) missing.push(ENV_KEYS.railPassword);
  return { present: missing.length === 0, missing, values };
}

/**
 * The callback HMAC secret specifically, for the webhook route.
 *
 * Separate from `readRailEnv().present` because the webhook must reject on a
 * placeholder HMAC secret even if the disbursement credentials are somehow
 * present — an unauthenticated callback is attack A1 regardless of what else is
 * configured.
 */
export function readCallbackHmacSecret(
  env: EnvRecord = process.env,
): { present: false } | { present: true; secret: string } {
  const raw = typeof env[ENV_KEYS.railCallbackHmacSecret] === 'string'
    ? (env[ENV_KEYS.railCallbackHmacSecret] as string).trim()
    : '';
  if (isPlaceholderValue(raw)) return { present: false };
  return { present: true, secret: raw };
}

// ── Rate-card parsing (pure) ────────────────────────────────────────────────

/**
 * Parse `platform_config.lesson_commission` into the B1 rate card.
 *
 * Returns null when the row is absent, malformed, or ALL-ZERO. All-zero is the
 * live state and it is not a valid rate card: a 0% collection fee with a 0
 * parent fee would mean quoting a split the business does not charge, which is
 * a fabricated number, not a free service.
 *
 * The stored shape live is {vat_pct, teacher_pct, customer_pct, processing_flat}.
 * It does not carry the markup terms, so those come from the LOCKED B1 rate
 * card constants below and are asserted, not read — B1 says "one rate card",
 * and a config-driven markup would let the two drift.
 */
export const B1_MARKUP_RATE = 0.075;
export const B1_MARKUP_FLAT_EGP = 7.5;
export const B1_PARENT_FEE_RATE = 0.015;
export const B1_PARENT_FEE_FLAT_EGP = 1.5;
export const B1_COLLECTION_FEE_RATE = 0.1;
export const B1_VAT_RATE = 0.14;

export function parseRateCard(raw: unknown): RateCard | null {
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };
  const teacherPct = num(o.teacher_pct);
  const customerPct = num(o.customer_pct);
  const processingFlat = num(o.processing_flat);
  const vatPct = num(o.vat_pct);
  if (!Number.isFinite(teacherPct) || !Number.isFinite(vatPct)) return null;
  // All-zero money terms == dormant == unconfigured.
  const allZero =
    (teacherPct || 0) === 0 && (customerPct || 0) === 0 && (processingFlat || 0) === 0;
  if (allZero) return null;
  if (teacherPct <= 0 || teacherPct >= 1) return null;
  if (vatPct <= 0 || vatPct >= 1) return null;
  return {
    collectionFeeRate: teacherPct,
    markupRate: B1_MARKUP_RATE,
    markupFlatEgp: B1_MARKUP_FLAT_EGP,
    parentFeeRate: B1_PARENT_FEE_RATE,
    parentFeeFlatEgp: B1_PARENT_FEE_FLAT_EGP,
    vatRate: vatPct,
  };
}

/** Parse a piastres cap. Rejects non-integers, negatives and zero. */
export function parseCapMinor(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

// ── The async loader ────────────────────────────────────────────────────────

type ConfigRow = { key: string; value: unknown };

/**
 * Resolve the whole config surface: env credentials plus the platform_config
 * rows. One round trip.
 *
 * FAILS CLOSED on every axis. An unreadable platform_config produces
 * `config_unreadable`, not a set of defaults.
 */
export async function loadCollectionPayoutConfig(
  supabaseAdmin: SupabaseClient,
  env: EnvRecord = process.env,
): Promise<CollectionPayoutConfig> {
  const problems: ConfigProblem[] = [];

  const rail = readRailEnv(env);
  if (!rail.present) {
    problems.push(problem('rail_credentials_placeholder', rail.missing));
  }
  if (isPlaceholderValue(rail.values.callbackHmacSecret)) {
    problems.push(problem('rail_callback_hmac_placeholder', [ENV_KEYS.railCallbackHmacSecret]));
  }

  const wanted = Object.values(PLATFORM_CONFIG_KEYS);
  let rows: ConfigRow[] = [];
  try {
    const { data, error } = await supabaseAdmin
      .from('platform_config')
      .select('key, value')
      .in('key', wanted);
    if (error) {
      problems.push(problem('config_unreadable', wanted));
    } else {
      rows = (data ?? []) as ConfigRow[];
    }
  } catch {
    problems.push(problem('config_unreadable', wanted));
  }

  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  const collectionEnabled = byKey.get(PLATFORM_CONFIG_KEYS.collectionEnabled) === true;
  if (!collectionEnabled) {
    problems.push(problem('collection_switch_off', [PLATFORM_CONFIG_KEYS.collectionEnabled]));
  }

  const rateCard = parseRateCard(byKey.get(PLATFORM_CONFIG_KEYS.lessonCommission));
  if (!rateCard) {
    problems.push(problem('rate_card_unset', [PLATFORM_CONFIG_KEYS.lessonCommission]));
  }

  const delegateCapMinor = parseCapMinor(byKey.get(PLATFORM_CONFIG_KEYS.delegateCapMinor));
  const delegateWindowCapMinor = parseCapMinor(
    byKey.get(PLATFORM_CONFIG_KEYS.delegateWindowCapMinor),
  );
  if (delegateCapMinor == null || delegateWindowCapMinor == null) {
    problems.push(
      problem('delegate_cap_unset', [
        PLATFORM_CONFIG_KEYS.delegateCapMinor,
        PLATFORM_CONFIG_KEYS.delegateWindowCapMinor,
      ]),
    );
  }

  // Fail closed: only an explicit `false` permits releases.
  const releasesHalted = byKey.get(PLATFORM_CONFIG_KEYS.releasesHalted) !== false;
  if (releasesHalted) {
    problems.push(problem('releases_halted', [PLATFORM_CONFIG_KEYS.releasesHalted]));
  }

  if (problems.length > 0) {
    return {
      configured: false,
      configPoint: COLLECTION_PAYOUT_CONFIG_POINT,
      problems,
      collectionReady: false,
      payoutReady: false,
    };
  }

  return {
    configured: true,
    configPoint: COLLECTION_PAYOUT_CONFIG_POINT,
    rail: rail.values,
    rateCard: rateCard as RateCard,
    collectionEnabled: true,
    delegateCapMinor: delegateCapMinor as number,
    delegateWindowCapMinor: delegateWindowCapMinor as number,
    releasesHalted: false,
  };
}

/**
 * The refusal payload every route returns when the config point is not filled.
 *
 * Deliberately verbose: it names the config point, every unmet cause, and every
 * key that would clear it. A caller looking at this response can tell exactly
 * what is missing without reading the source.
 */
export function refusalBody(cfg: Extract<CollectionPayoutConfig, { configured: false }>) {
  return {
    ok: false as const,
    error: 'collection_payout_not_configured',
    configPoint: cfg.configPoint,
    causes: cfg.problems.map((p) => p.cause),
    messageKeys: cfg.problems.map((p) => p.messageKey),
    unsetKeys: [...new Set(cfg.problems.flatMap((p) => p.keys))],
  };
}
