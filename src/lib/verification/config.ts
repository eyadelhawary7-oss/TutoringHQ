/**
 * THE ONE CONFIGURATION POINT for identity verification (Valify e-KYC).
 *
 * Governing instruction (Eyad, Phase 4):
 *   "Externalities are not blockers for code. Build the complete flow against
 *    ONE clearly named config point with placeholder values, failing visibly."
 *   "Fail visibly, never fake success."
 *
 * Every part of the verification feature — the redirect launcher, the webhook,
 * the admin vendor row, every badge and every CTA — resolves its availability
 * through THIS module and no other. There is deliberately no second place to
 * look and no per-surface fallback. If this module says "not configured", the
 * whole feature says "not configured", in the user's own language, out loud.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * OWNERSHIP NOTE — read before editing.
 *
 * Territory A (`claude/phase4-valify-config-and-client`) owns the Valify config
 * point and HTTP client. At the time this file was written that branch sat at
 * origin/master with ZERO commits, so nothing existed to import. This file is
 * the contract Territory B (verification UI surfaces) codes against, written at
 * the path Territory A will land at.
 *
 * WHEN TERRITORY A LANDS: take Territory A's `config.ts` and delete this one.
 * Do NOT end up with two config points — that is the exact failure the
 * governing instruction forbids. `tests/unit/verificationContract.test.ts`
 * pins the shape Territory B depends on; if Territory A's module diverges,
 * that test fails at CI rather than the UI failing at runtime.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Law 151/2020 note: nothing in this module ever touches the ID document.
 * Verification is a redirect to a Valify-hosted page (decided 26 July 2026,
 * `design/DECISION-national-id-2026-07-26.md`). The image, the selfie and every
 * intermediate field stay on Valify's infrastructure. We hold an outcome only.
 * These credentials therefore authenticate a link request and a webhook — they
 * never authorise an upload to us, because there is no upload to us.
 */

/**
 * The env keys that make up the config point. This tuple IS the surface: adding
 * a Valify env var anywhere else in the codebase without adding it here is a
 * defect, because the availability guard would not see it.
 */
export const VERIFICATION_CONFIG_ENV_KEYS = [
  'VALIFY_BASE_URL',
  'VALIFY_API_KEY',
  'VALIFY_FLOW_ID',
  'VALIFY_WEBHOOK_SECRET',
] as const;

export type VerificationConfigKey = (typeof VERIFICATION_CONFIG_ENV_KEYS)[number];

/**
 * Values that are syntactically present but semantically absent. `.env.example`
 * ships every Valify key with `placeholder`, and a deploy that copies the
 * example forward must fail exactly as loudly as a deploy that sets nothing.
 * A truthy-string check would call `VALIFY_API_KEY=placeholder` "configured"
 * and hand the user a green checkmark backed by no integration.
 */
const PLACEHOLDER_VALUES = new Set([
  'placeholder',
  'your-key-here',
  'replace-me',
  'replace_me',
  'changeme',
  'change-me',
  'todo',
  'tbd',
  'xxx',
  'none',
  'null',
  'undefined',
  'example',
]);

/** True when `raw` is a placeholder rather than a real credential. */
export function isPlaceholderValue(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  if (!v) return true;
  if (PLACEHOLDER_VALUES.has(v)) return true;
  // `https://example.com`, `example.com/api`, `VALIFY_BASE_URL=<your-url>`.
  if (v.includes('example.com')) return true;
  if (v.startsWith('<') && v.endsWith('>')) return true;
  return false;
}

export type VerificationConfigConfigured = {
  configured: true;
  baseUrl: string;
  apiKey: string;
  flowId: string;
  webhookSecret: string;
};

/**
 * `missing` = key absent or empty. `placeholder` = key present, still holding
 * an example value. They are separated because they are different operator
 * mistakes with different fixes, and the admin vendor row says which one it is.
 */
export type VerificationConfigUnavailable = {
  configured: false;
  cause: 'missing_credentials' | 'placeholder_credentials';
  missing: VerificationConfigKey[];
  placeholder: VerificationConfigKey[];
};

export type VerificationConfigResult =
  | VerificationConfigConfigured
  | VerificationConfigUnavailable;

type EnvLike = Record<string, string | undefined>;

/**
 * Read the config point. Never throws — callers that must have credentials use
 * `requireVerificationConfig`; callers that only need to render an honest state
 * use this and branch on `configured`.
 */
export function readVerificationConfig(env: EnvLike = process.env): VerificationConfigResult {
  const missing: VerificationConfigKey[] = [];
  const placeholder: VerificationConfigKey[] = [];

  for (const key of VERIFICATION_CONFIG_ENV_KEYS) {
    const raw = env[key];
    if (typeof raw !== 'string' || !raw.trim()) {
      missing.push(key);
      continue;
    }
    if (isPlaceholderValue(raw)) placeholder.push(key);
  }

  if (missing.length > 0 || placeholder.length > 0) {
    return {
      configured: false,
      // Missing outranks placeholder: an operator who has set nothing needs a
      // different instruction from one who has set the example values.
      cause: missing.length > 0 ? 'missing_credentials' : 'placeholder_credentials',
      missing,
      placeholder,
    };
  }

  return {
    configured: true,
    baseUrl: (env.VALIFY_BASE_URL as string).trim().replace(/\/+$/, ''),
    apiKey: (env.VALIFY_API_KEY as string).trim(),
    flowId: (env.VALIFY_FLOW_ID as string).trim(),
    webhookSecret: (env.VALIFY_WEBHOOK_SECRET as string).trim(),
  };
}

/**
 * Thrown by any code path that cannot proceed without live credentials — the
 * link request, the webhook verifier, the outcome writer. Carries a NAMED cause
 * and the exact offending keys so the failure is diagnosable from one log line
 * and can never be mistaken for a transient error.
 *
 * The `code` is stable and is what routes return to the client as
 * `{ error: 'verification_not_configured', cause }`.
 */
export class VerificationNotConfiguredError extends Error {
  readonly code = 'verification_not_configured' as const;
  readonly causeCode: VerificationConfigUnavailable['cause'];
  readonly missing: VerificationConfigKey[];
  readonly placeholder: VerificationConfigKey[];

  constructor(detail: VerificationConfigUnavailable) {
    super(
      `Identity verification is not configured (${detail.cause}). ` +
        `missing=[${detail.missing.join(',')}] placeholder=[${detail.placeholder.join(',')}]. ` +
        'Set the Valify credentials on the deployment. No verification outcome may be ' +
        'recorded and no surface may claim a verified state until this is fixed.',
    );
    this.name = 'VerificationNotConfiguredError';
    this.causeCode = detail.cause;
    this.missing = detail.missing;
    this.placeholder = detail.placeholder;
  }
}

/**
 * Fail-closed accessor. Use in every server path that would otherwise contact
 * Valify or persist an outcome. Throws rather than returning a degraded object,
 * so a forgotten branch cannot silently continue into a fake success.
 */
export function requireVerificationConfig(env: EnvLike = process.env): VerificationConfigConfigured {
  const result = readVerificationConfig(env);
  if (!result.configured) throw new VerificationNotConfiguredError(result);
  return result;
}
