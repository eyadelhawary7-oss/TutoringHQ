/**
 * Valify (identity verification / e-KYC) configuration — THE single named
 * config point for the whole verification feature.
 *
 * ============================================================================
 * THIS IS THE ONE CONFIG SURFACE. Nothing else may read the VALIFY_* env vars.
 * (Written that way rather than with the `process.env.` prefix on purpose:
 * scripts/check-env.ts scans source for that literal and would report the
 * wildcard as a real env key missing from .env.example. paymobConfig.ts's
 * equivalent comment does exactly that today — PAYMOB_ is in the script's
 * output on master, and it is noise.)
 * ============================================================================
 *
 * Every Valify credential the platform uses is read ONLY here. Downstream code
 * does NOT import these accessors either — it asks `src/lib/valifyGuardLogic.ts`
 * whether Valify is configured, and that guard is the only consumer of this
 * module's raw values. That is deliberate: a raw accessor returning a string
 * tempts a caller into `if (key) { ...proceed... }`, which would happily
 * proceed on the literal string "placeholder". The guard is what knows a
 * placeholder is not a credential.
 *
 * This mirrors `src/lib/paymobConfig.ts` (values) + `src/lib/paymobGuardLogic.ts`
 * (is-it-real), which is the established precedent in this repo for a credential
 * that has a named slot before the vendor has issued it — see
 * `PAYMOB_RECURRING_INTEGRATION_ID`, which ships as `placeholder` in
 * `.env.example` and makes the saved-card engine refuse with a named cause
 * rather than charge.
 *
 * SERVER-ONLY by use. The names are deliberately NOT prefixed `NEXT_PUBLIC_`,
 * so Next strips them from any client bundle — a Valify secret can never reach
 * the browser. (We do not import the `server-only` package, because this module
 * is pulled into modules that unit tests import and that package throws under
 * vitest — same reasoning as paymobConfig.ts.)
 *
 * Accessors read `process.env` at CALL time, never memoized at import, so a
 * value set after boot — and stubbed env in tests — is always honored.
 *
 * ----------------------------------------------------------------------------
 * STATUS AS OF 4 AUGUST 2026: NO VALIFY CREDENTIALS EXIST.
 * ----------------------------------------------------------------------------
 * Eyad has not contracted Valify. Every key below ships as a placeholder in
 * `.env.example` and MUST stay that way until real values arrive. While they are
 * placeholders the guard reports `valify_not_configured` and every entry point
 * refuses out loud. Nothing pretends to succeed, and no surface renders a
 * verified badge. When the credentials arrive it is an env change in Vercel and
 * nothing else — the whole path downstream of here is already built.
 *
 * Two vendor facts are still UNKNOWN and are recorded on the relevant accessors
 * rather than guessed (design/VERIFICATION-SPEC.md §2b): the webhook payload
 * shape, and whether the webhook is signed at all. `VALIFY_WEBHOOK_SECRET`
 * assumes it is HMAC-signed. If Valify turns out to authenticate its callback
 * some other way, that assumption changes here and in `valifyClient.ts` and
 * nowhere else.
 *
 * ----------------------------------------------------------------------------
 * ONLINE COLLECTION IS NOT AN ENV FLAG AND IS NOT DEFINED HERE.
 * ----------------------------------------------------------------------------
 * Its config point already exists and is DB-shaped:
 *   platform_config key 'digital_student_fee_collection.enabled'
 *   read only by src/lib/digitalStudentFeeCollection.ts
 * Verified live on 4 August 2026: that row EXISTS with value `false`
 * (updated_at 2026-06-19). design/PAYOUT-SYSTEM-SPEC.md §0 and §9 say the row is
 * absent — that claim is STALE; do not write a migration that inserts it, it
 * would collide. We reference the existing module rather than inventing a second
 * switch for the same thing.
 */

/**
 * Values that are a NAMED SLOT, not a credential.
 *
 * `.env.example` in this repo fills unissued credentials with `placeholder` or
 * `your-key-here` (see PAYMOB_RECURRING_INTEGRATION_ID, SUPER_ADMIN_PHONES,
 * CSRF_SECRET). A deploy that copies `.env.example` forward therefore has
 * *present but meaningless* env vars, and a plain `if (process.env.X)` check
 * treats those as configured. That is precisely the "green checkmark backed by
 * no integration" failure this feature must not have.
 */
const PLACEHOLDER_EXACT: ReadonlySet<string> = new Set([
  'placeholder',
  'your-key-here',
  'your-key',
  'changeme',
  'change-me',
  'todo',
  'tbd',
  'none',
  'null',
  'undefined',
  'xxx',
  'example',
  'test',
  'unset',
]);

/** Substrings that mark a value as a slot rather than a secret. */
const PLACEHOLDER_SUBSTRINGS: readonly string[] = [
  'placeholder',
  'your-key',
  'your-api',
  'your-secret',
  'changeme',
  'change-me',
  'replace-me',
  'example.com',
  '<',
];

/**
 * True when `value` is absent, blank, or one of the repo's placeholder tokens.
 * Exported because the guard and `scripts/check-env.ts` must agree exactly on
 * what "still a placeholder" means; two divergent definitions would let a
 * credential be live to one and dead to the other.
 */
export function isPlaceholderValue(value: string | undefined | null): boolean {
  if (value == null) return true;
  const t = String(value).trim();
  if (t.length === 0) return true;
  const lower = t.toLowerCase();
  if (PLACEHOLDER_EXACT.has(lower)) return true;
  return PLACEHOLDER_SUBSTRINGS.some((s) => lower.includes(s));
}

function readTrimmed(name: string): string | undefined {
  const v = process.env[name];
  if (v == null) return undefined;
  const t = String(v).trim();
  return t.length > 0 ? t : undefined;
}

/**
 * The env var names this feature owns, in one array so the guard, the health
 * report and `scripts/check-env.ts` enumerate the identical set.
 */
export const VALIFY_ENV_KEYS = [
  'VALIFY_API_KEY',
  'VALIFY_BASE_URL',
  'VALIFY_FLOW_ID',
  'VALIFY_WEBHOOK_SECRET',
] as const;

export type ValifyEnvKey = (typeof VALIFY_ENV_KEYS)[number];

/**
 * `X-Valify-Api-Key` for the Web Verification Flow link request
 * (`POST /api/link/v1/request/`). Secret.
 */
export function getValifyApiKey(): string | undefined {
  return readTrimmed('VALIFY_API_KEY');
}

/**
 * API base. Production is `https://verify.valifysolutions.com`; staging is on
 * `valifystage.com` (design/VERIFICATION-SPEC.md §2b). Deliberately has NO
 * default: defaulting it would let a half-configured deploy send a real
 * verification attempt at a host nobody chose. Absent → not configured.
 */
export function getValifyBaseUrl(): string | undefined {
  return readTrimmed('VALIFY_BASE_URL');
}

/**
 * UUID of the pre-configured Valify module set (Egyptian National ID OCR +
 * face match + liveness). Optional per Valify's docs — when omitted Valify uses
 * the account default flow. Reported by the guard but NOT required, so a
 * missing flow id never blocks: it is a vendor-side default, not a credential.
 */
export function getValifyFlowId(): string | undefined {
  return readTrimmed('VALIFY_FLOW_ID');
}

/**
 * Shared secret for verifying the inbound Valify webhook HMAC.
 *
 * REQUIRED, and required loudly. The webhook is the ONLY trust anchor for
 * verified state (design/VERIFICATION-SPEC.md §2b: "The `return_url` is a UX
 * destination, nothing more"). Without this secret the callback cannot be
 * authenticated, so the webhook fails closed with 401 rather than trusting its
 * payload — a webhook that trusts an unsigned body would let anyone who can POST
 * to a public URL mark themselves verified and unlock payouts.
 *
 * ⚠ VENDOR-UNKNOWN: Valify's public docs do not state whether the Web
 * Verification Flow webhook is signed, nor with which algorithm or header. This
 * slot assumes HMAC-SHA256 over the raw body in `X-Valify-Signature`, matching
 * how `verifyHmac.ts` already handles Paymob and Bosta. Confirm with
 * techsupport@valify.me before the first real credential is set; if the scheme
 * differs, `verifyValifyWebhookSignature()` in valifyClient.ts changes and
 * nothing else does.
 */
export function getValifyWebhookSecret(): string | undefined {
  return readTrimmed('VALIFY_WEBHOOK_SECRET');
}

/** Raw snapshot of every Valify env value. Guard-only; do not call elsewhere. */
export function readValifyEnvSnapshot(): Record<ValifyEnvKey, string | undefined> {
  return {
    VALIFY_API_KEY: getValifyApiKey(),
    VALIFY_BASE_URL: getValifyBaseUrl(),
    VALIFY_FLOW_ID: getValifyFlowId(),
    VALIFY_WEBHOOK_SECRET: getValifyWebhookSecret(),
  };
}
