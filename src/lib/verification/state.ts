/**
 * The verification state machine — the single source of truth for "is this
 * provider verified?" across the whole app.
 *
 * Nothing may re-derive verification state locally. Every surface (centre home,
 * teacher home, teacher settings, attendance, admin account detail, admin
 * platform) imports `resolveVerificationState` or consumes a `VerificationState`
 * produced by it. That is what makes it impossible for one screen to drift into
 * drawing a badge the rest of the app cannot justify.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * OWNERSHIP NOTE — same as `config.ts`. Territory A owns this path. Its branch
 * had zero commits when this was written. If Territory A lands a richer state
 * machine, take theirs and delete this; `tests/unit/verificationContract.test.ts`
 * pins the shape Territory B's UI depends on.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * LIVE SCHEMA FACT, re-verified 4 Aug 2026 against project lczmjpnbuhnsislcvzar:
 *
 *   select table_name, column_name from information_schema.columns
 *   where table_schema='public'
 *     and (column_name ilike '%verif%' or column_name ilike '%national%'
 *          or column_name ilike '%kyc%' or column_name ilike '%valify%');
 *
 * 12 rows, ALL of them OTP (`students.phone_verified`,
 * `phone_verifications.verified_at`, …) or backup integrity
 * (`backup_log.last_verified_at`). `public.centers` has 128 columns and NOT ONE
 * of `verification_status`, `verified_at`, `national_id`,
 * `valify_transaction_id` or `payout_name_matches`. No verification table
 * exists (`information_schema.tables` has only `phone_verifications`, which is
 * OTP).
 *
 * So today `resolveVerificationState` returns `available: false` with cause
 * `state_source_missing` for every subject, and that is CORRECT — it is the
 * honest answer, not a bug to route around. The moment the migration proposal
 * in `supabase/migrations/*_verification_state_columns.sql` is applied by hand,
 * the reader starts finding columns and the same function starts returning real
 * status values. No UI change is needed for that transition.
 */

import type { VerificationConfigResult } from './config';

/**
 * Every state a provider can be in.
 *
 * `unverified | verified` are the only two the designs draw
 * (`design/VERIFICATION-SPEC.md` §4). The other four come from §9.1, which
 * names them as required-and-undrawn: a hosted redirect with an out-of-band
 * webhook cannot avoid them. `pending` in particular is the one that must never
 * render as `unverified` — a user who returns from Valify before the webhook
 * lands would otherwise read "Not verified" as "rejected".
 */
export const VERIFICATION_STATUSES = [
  'unverified',
  'pending',
  'verified',
  'failed',
  'expired',
  'provider_error',
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * Why verification state cannot be reported at all. Distinct from a status:
 * a status is a fact about the provider, an unavailable cause is a fact about
 * US. Conflating them is how "we have not built this" turns into
 * "you have not verified", which is a lie told to the user.
 */
export type VerificationUnavailableCause =
  /** Valify credentials absent from the deployment. */
  | 'provider_not_configured'
  /** Valify credentials present but still holding `.env.example` placeholders. */
  | 'provider_placeholder_credentials'
  /** No verification columns in the live schema — the migration is unapplied. */
  | 'state_source_missing';

export type VerificationStateUnavailable = {
  available: false;
  cause: VerificationUnavailableCause;
  /** Operator-facing, English, never rendered to an end user. */
  detail: string;
};

export type VerificationStateAvailable = {
  available: true;
  status: VerificationStatus;
  /** ISO timestamp; null for every status except `verified`. */
  verifiedAt: string | null;
  /**
   * Valify transaction reference. BACKEND ONLY — required for Transaction
   * Inquiry and audit, never rendered in any UI (VERIFICATION-SPEC §9.7).
   */
  providerRef: string | null;
};

export type VerificationState = VerificationStateUnavailable | VerificationStateAvailable;

/** Whether a subject is a centre or a solo teacher. Both verify; both are gated. */
export type VerificationSubjectKind = 'center' | 'teacher';

/**
 * The row shape the reader pulls once the migration is applied. Column names
 * match the migration proposal exactly; nothing here exists in the live catalog
 * yet, which is why the reader treats a missing-column error as expected.
 */
export type VerificationRow = {
  verification_status: string | null;
  verified_at: string | null;
  valify_transaction_id: string | null;
};

/** The columns the migration proposes. Kept next to the row type on purpose. */
export const VERIFICATION_STATE_COLUMNS = [
  'verification_status',
  'verified_at',
  'valify_transaction_id',
] as const satisfies readonly (keyof VerificationRow)[];

function isVerificationStatus(v: unknown): v is VerificationStatus {
  return typeof v === 'string' && (VERIFICATION_STATUSES as readonly string[]).includes(v);
}

export type ResolveVerificationStateInput = {
  /** Result of the ONE config point, `readVerificationConfig()`. */
  config: VerificationConfigResult;
  /**
   * False when the live schema has no verification columns. The reader sets
   * this from an actual PostgREST undefined-column error, not from a guess.
   */
  stateSourceAvailable: boolean;
  /** The row, or null when the subject simply has no verification record yet. */
  row: VerificationRow | null;
};

/**
 * Resolve the one true verification state.
 *
 * ORDER MATTERS AND IS THE POINT.
 *
 * Config is checked BEFORE the row. If Valify is not wired up, then even a row
 * saying `verification_status='verified'` cannot be trusted — no live webhook
 * could have written it, so it is test data, a manual edit, or a migration
 * default. Reporting `available: false` in that case is the difference between
 * "we cannot tell you" and a green checkmark backed by no integration, which is
 * the single worst outcome this feature can have.
 *
 * An unknown status string is treated as `provider_error`, not silently
 * downgraded to `unverified` — an unrecognised value means our mapping is stale
 * and the user should see an honest "something is wrong", not a confident "no".
 */
export function resolveVerificationState(input: ResolveVerificationStateInput): VerificationState {
  const { config, stateSourceAvailable, row } = input;

  if (!config.configured) {
    const cause: VerificationUnavailableCause =
      config.cause === 'placeholder_credentials'
        ? 'provider_placeholder_credentials'
        : 'provider_not_configured';
    return {
      available: false,
      cause,
      detail:
        `Valify is not wired up (${config.cause}). ` +
        `missing=[${config.missing.join(',')}] placeholder=[${config.placeholder.join(',')}]. ` +
        'No verification outcome can be produced or trusted, so no surface may claim one.',
    };
  }

  if (!stateSourceAvailable) {
    return {
      available: false,
      cause: 'state_source_missing',
      detail:
        'No verification columns in the live schema. The migration proposal ' +
        'supabase/migrations/20260804140000_verification_state_columns.sql is NOT APPLIED. ' +
        `Expected columns: ${VERIFICATION_STATE_COLUMNS.join(', ')}.`,
    };
  }

  // Source is live and credentials are real. A subject with no row has simply
  // never started verification — that is a genuine `unverified`, not an outage.
  if (!row || row.verification_status == null) {
    return { available: true, status: 'unverified', verifiedAt: null, providerRef: null };
  }

  if (!isVerificationStatus(row.verification_status)) {
    return {
      available: true,
      status: 'provider_error',
      verifiedAt: null,
      providerRef: row.valify_transaction_id ?? null,
    };
  }

  const status = row.verification_status;
  return {
    available: true,
    status,
    // A timestamp only means something on a pass. Carrying one on a failed or
    // pending row would let a surface render "verified 12/07/2025" beside
    // "not verified".
    verifiedAt: status === 'verified' ? (row.verified_at ?? null) : null,
    providerRef: row.valify_transaction_id ?? null,
  };
}

/**
 * The gate. `true` ONLY for an available, passed check.
 *
 * Every money surface that verification gates — online collection, withdrawals,
 * teacher auto-collect (VERIFICATION-SPEC §6) — asks this and nothing else.
 * Unavailable is never permissive: if we cannot tell, the answer is no.
 */
export function isVerified(state: VerificationState): boolean {
  return state.available && state.status === 'verified';
}
