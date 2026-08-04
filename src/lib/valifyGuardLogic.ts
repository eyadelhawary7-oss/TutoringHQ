/**
 * Valify guard — the one question: "is Valify actually configured?"
 *
 * Modelled on `src/lib/paymobGuardLogic.ts`. Same shape, same discipline: the
 * config module holds values, this module holds the judgement, and every
 * downstream caller asks THIS and never re-reads the raw config.
 *
 * The judgement it makes that a truthiness check cannot: a PLACEHOLDER IS NOT A
 * CREDENTIAL. `.env.example` ships `VALIFY_API_KEY=placeholder`, so on any deploy
 * that copied the example forward `process.env.VALIFY_API_KEY` is a non-empty
 * string. `if (apiKey)` would pass. This guard fails.
 *
 * Every refusal carries a NAMED CAUSE from `ValifyUnconfiguredCause`. Callers
 * surface the name; nothing swallows it, nothing degrades to a silent no-op, and
 * nothing returns an optimistic success. There is no code path anywhere in this
 * feature that can report "verified" while this guard says unconfigured.
 */

import {
  VALIFY_ENV_KEYS,
  type ValifyEnvKey,
  isPlaceholderValue,
  readValifyEnvSnapshot,
} from '@/lib/valifyConfig';

/**
 * Why verification is unavailable. These strings are stable identifiers: they
 * go into API responses, Sentry tags and logs, and the UI maps them to copy.
 */
export type ValifyUnconfiguredCause =
  /** One or more required VALIFY_* env values are absent or still a placeholder. */
  | 'valify_not_configured'
  /**
   * Credentials are real but the verification tables have not been applied to
   * the database yet. Migrations are a MANUAL apply in this repo (CLAUDE.md
   * rule 5) — merging the migration file does not apply it. Without this cause
   * a configured deploy would hit an undefined-table error and surface a 500,
   * which reads as a bug rather than as "not switched on yet".
   */
  | 'verification_schema_not_applied';

export interface ValifyConfigStatus {
  /** True only when every REQUIRED credential is present and not a placeholder. */
  configured: boolean;
  /** Named cause when `configured` is false; null when configured. */
  cause: ValifyUnconfiguredCause | null;
  /** Required keys that are absent or still a placeholder. Never partial-truth. */
  missing: ValifyEnvKey[];
  /** Optional keys not set. Reported, never blocking. */
  optionalMissing: ValifyEnvKey[];
}

/**
 * Credentials without which no verification can happen at all.
 *
 * VALIFY_FLOW_ID is deliberately NOT here: Valify's link API treats `flow` as
 * optional and falls back to the account-default module set, so a missing flow
 * id is a reportable gap, not a blocker.
 */
const REQUIRED_KEYS: readonly ValifyEnvKey[] = [
  'VALIFY_API_KEY',
  'VALIFY_BASE_URL',
  'VALIFY_WEBHOOK_SECRET',
];

const OPTIONAL_KEYS: readonly ValifyEnvKey[] = VALIFY_ENV_KEYS.filter(
  (k) => !REQUIRED_KEYS.includes(k),
);

/**
 * Full status of the Valify config surface. Pure over `process.env`, so tests
 * drive it by stubbing env and never by mocking this module.
 */
export function getValifyConfigStatus(): ValifyConfigStatus {
  const snapshot = readValifyEnvSnapshot();

  const missing = REQUIRED_KEYS.filter((k) => isPlaceholderValue(snapshot[k]));
  const optionalMissing = OPTIONAL_KEYS.filter((k) => isPlaceholderValue(snapshot[k]));

  return {
    configured: missing.length === 0,
    cause: missing.length === 0 ? null : 'valify_not_configured',
    missing,
    optionalMissing,
  };
}

/** The one question. True only when Valify can genuinely be called. */
export function isValifyConfigured(): boolean {
  return getValifyConfigStatus().configured;
}

/**
 * Thrown by `assertValifyConfigured()`. Carries the named cause and, for the
 * config case, exactly which keys are missing — so an operator reading a log
 * learns what to set rather than that "something" is wrong.
 */
export class ValifyNotConfiguredError extends Error {
  readonly cause_code: ValifyUnconfiguredCause;
  readonly missing: readonly string[];

  constructor(cause: ValifyUnconfiguredCause, missing: readonly string[] = []) {
    super(
      cause === 'valify_not_configured'
        ? `VALIFY_GUARD: identity verification is not configured. Missing or placeholder: ${
            missing.length > 0 ? missing.join(', ') : '(unknown)'
          }`
        : 'VALIFY_GUARD: the verification schema has not been applied to this database yet.',
    );
    this.name = 'ValifyNotConfiguredError';
    this.cause_code = cause;
    this.missing = missing;
  }
}

/**
 * Throw unless Valify is genuinely configured. For call sites that cannot
 * meaningfully continue — the link request, the webhook's persistence step.
 *
 * NOTE the contrast with `assertPaymobProductionOrThrow()`, which returns early
 * during `next build` and outside production. This one has NO such escape. A
 * build-time exemption is right for Paymob, where the guard's job is to stop a
 * sandbox key reaching production; it would be wrong here, where the guard's job
 * is to stop a fake success reaching a user. Unconfigured must refuse in every
 * environment, including local dev, or local dev is where someone sees a green
 * checkmark that means nothing.
 */
export function assertValifyConfigured(): void {
  const status = getValifyConfigStatus();
  if (!status.configured) {
    throw new ValifyNotConfiguredError('valify_not_configured', status.missing);
  }
}

/**
 * Operator-facing summary for a health/status surface. Never returns a bare
 * boolean dressed as "ok": when unconfigured it says so and names the keys.
 *
 * `mode` mirrors `getPaymobHealthMode()`'s vocabulary so an ops dashboard can
 * render both the same way.
 */
export function getValifyHealth(): {
  mode: 'live' | 'unconfigured';
  cause: ValifyUnconfiguredCause | null;
  missing: string[];
  optionalMissing: string[];
  note: string;
} {
  const status = getValifyConfigStatus();
  return {
    mode: status.configured ? 'live' : 'unconfigured',
    cause: status.cause,
    missing: [...status.missing],
    optionalMissing: [...status.optionalMissing],
    note: status.configured
      ? 'Valify credentials present. Verification entry points are live.'
      : 'Valify is NOT contracted. Identity verification, online collection and payouts stay refused with a named cause. No surface may render a verified badge.',
  };
}

/**
 * Human-legible, non-technical refusal text for a named cause, in both locales.
 *
 * Kept here rather than in `messages/*.json` on purpose. These strings are
 * emitted by API routes as part of a JSON error body — there is no React tree
 * and no `next-intl` context at that point — and adding keys to only one of
 * ar.json / en.json breaks the i18n parity build gate. The verification SCREENS
 * that will render these live in `Merged-Verification-Payouts`, which is one of
 * the six protected files and is not this territory's to build; when those
 * screens are built they should move this copy into the message catalogues as a
 * matched ar/en pair and render by `cause` code.
 */
export function refusalMessage(cause: ValifyUnconfiguredCause): { en: string; ar: string } {
  switch (cause) {
    case 'valify_not_configured':
      return {
        en: 'Identity verification is not available yet. Our verification provider is not connected, so we cannot verify anyone — including you. Nothing you did failed, and nothing has been recorded against your account.',
        ar: 'التحقق من الهوية غير متاح حاليًا. لم يتم ربط مزوّد التحقق بعد، لذلك لا يمكننا التحقق من أي حساب — بما في ذلك حسابك. لم يفشل أي إجراء قمت به، ولم يُسجَّل أي شيء على حسابك.',
      };
    case 'verification_schema_not_applied':
      return {
        en: 'Identity verification is not available yet. The verification records have not been set up on this environment. Nothing you did failed, and nothing has been recorded against your account.',
        ar: 'التحقق من الهوية غير متاح حاليًا. لم يتم إعداد سجلات التحقق على هذه البيئة بعد. لم يفشل أي إجراء قمت به، ولم يُسجَّل أي شيء على حسابك.',
      };
  }
}
