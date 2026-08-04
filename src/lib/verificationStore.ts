/**
 * Verification persistence — reads and writes the verification outcome.
 *
 * ============================================================================
 * THE TABLES THIS MODULE READS DO NOT EXIST YET. THAT IS HANDLED, NOT IGNORED.
 * ============================================================================
 * Verified live against project `lczmjpnbuhnsislcvzar` on 4 August 2026:
 * `information_schema.tables` contains no `verification_records` and no
 * `verification_attempts`, and `centers` has no verification column of any kind.
 * The DDL is a PROPOSAL at
 * `supabase/migrations/20260804140000_verification_records_proposal.sql`
 * and Eyad applies it by hand (CLAUDE.md rule 5 — merging does not apply).
 *
 * Referencing a table that does not exist is the F26 class that caused the
 * 8 July student-detail outage, and CI cannot catch it because CI has no live
 * database. So this module does not merely reference the tables and hope: every
 * query result is passed through `isMissingRelation()`, and an undefined-table
 * error is translated into the NAMED cause `verification_schema_not_applied`
 * rather than escaping as an opaque 500. The caller then refuses out loud with
 * an accurate reason — "not set up on this environment" — instead of showing a
 * user a server error for a feature that was never switched on.
 *
 * Two independent gates therefore stand between a user and these tables today:
 * the Valify guard (no credentials) and this one (no schema). Both must pass
 * before a single row is written. Neither can be satisfied by accident.
 *
 * ----------------------------------------------------------------------------
 * MULTI-TENANCY
 * ----------------------------------------------------------------------------
 * `center_id` and `user_id` are ALWAYS derived server-side from the
 * authenticated session by the calling route and passed in as a resolved
 * `VerificationSubject`. Nothing in this module reads a subject from request
 * input, and the webhook in particular resolves its subject by looking up OUR
 * minted reference in `verification_attempts` — never from the reference's
 * contents and never from anything else in the callback body.
 *
 * Teachers are centre-less by design (`users.center_id` IS NULL, membership via
 * `teacher_center`). A teacher subject therefore carries `user_id` and a NULL
 * `center_id`, and that is correct, not a gap to be filled.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getValifyConfigStatus,
  type ValifyUnconfiguredCause,
} from '@/lib/valifyGuardLogic';
import {
  isPersistedVerificationState,
  resolveEffectiveState,
  stateForOutcome,
  type EffectiveVerification,
  type VerificationOutcome,
  type VerificationRecord,
} from '@/lib/verificationState';

export const VERIFICATION_RECORDS_TABLE = 'verification_records';
export const VERIFICATION_ATTEMPTS_TABLE = 'verification_attempts';

/** Who is being verified. Always resolved server-side from the session. */
export type VerificationSubject =
  | { kind: 'center'; centerId: string }
  | { kind: 'teacher'; userId: string };

export type VerificationStoreFailure =
  | 'verification_schema_not_applied'
  | 'query_failed'
  | 'attempt_not_found';

export class VerificationStoreError extends Error {
  readonly cause_code: VerificationStoreFailure;

  constructor(cause: VerificationStoreFailure, message: string) {
    super(message);
    this.name = 'VerificationStoreError';
    this.cause_code = cause;
  }
}

/**
 * Does this Supabase error mean "that table does not exist"?
 *
 * Two shapes, because PostgREST and Postgres each have their own:
 *   42P01   — Postgres `undefined_table`, surfaced when the statement reaches PG
 *   PGRST205 — PostgREST could not find the table in its schema cache
 * A missing COLUMN (42703 / PGRST204) counts too: a partially-applied migration
 * is not an applied migration, and pretending otherwise is the same defect one
 * step later.
 */
export function isMissingRelation(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  if (['42P01', '42703', 'PGRST205', 'PGRST204'].includes(code)) return true;
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return (
    message.includes('does not exist') ||
    message.includes('could not find the table') ||
    message.includes('schema cache')
  );
}

function rowToRecord(row: Record<string, unknown> | null): VerificationRecord | null {
  if (row == null) return null;
  const state = row.state;
  // An unrecognised state is NOT coerced to something convenient. Falling back
  // to 'verified' would be catastrophic and falling back to 'unverified' would
  // silently strip a real verification, so the row is treated as absent and the
  // caller resolves to 'unverified' — the same as never having started, which
  // is the only safe reading of a row we cannot interpret.
  if (!isPersistedVerificationState(state)) return null;
  return {
    state,
    verified_at: typeof row.verified_at === 'string' ? row.verified_at : null,
    legal_name: typeof row.legal_name === 'string' ? row.legal_name : null,
    national_id: typeof row.national_id === 'string' ? row.national_id : null,
    last_outcome:
      typeof row.last_outcome === 'string'
        ? (row.last_outcome as VerificationOutcome)
        : null,
  };
}

/**
 * Read a subject's verification record and fold in the guard verdict.
 *
 * This is the ONE function every surface should call to ask "is this provider
 * verified?". It returns `unconfigured` whenever Valify is not contracted or the
 * schema is not applied, and in those states `isVerified` is false regardless of
 * what any row says.
 */
export async function getEffectiveVerification(
  supabaseAdmin: SupabaseClient,
  subject: VerificationSubject,
): Promise<EffectiveVerification> {
  const guard = getValifyConfigStatus();
  if (!guard.configured) {
    return resolveEffectiveState(null, guard.cause);
  }

  let record: VerificationRecord | null = null;
  let schemaCause: ValifyUnconfiguredCause | null = null;

  // The subject columns are applied inline rather than through a helper so the
  // tenant filter is visible at the point of the query. Every read of this
  // table is scoped by a server-derived subject; there is no unscoped read.
  const base = supabaseAdmin
    .from(VERIFICATION_RECORDS_TABLE)
    .select('state, verified_at, legal_name, national_id, last_outcome');

  const scoped =
    subject.kind === 'center'
      ? base.eq('subject_type', 'center').eq('center_id', subject.centerId)
      : base.eq('subject_type', 'teacher').eq('user_id', subject.userId);

  const { data, error } = await scoped.maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      schemaCause = 'verification_schema_not_applied';
    } else {
      // A real query failure must NOT read as "not verified yet" — that is a
      // silent downgrade. Throw so the route returns a named 5xx.
      throw new VerificationStoreError(
        'query_failed',
        `Could not read ${VERIFICATION_RECORDS_TABLE}: ${
          (error as { message?: string }).message ?? 'unknown error'
        }`,
      );
    }
  } else {
    record = rowToRecord((data as Record<string, unknown> | null) ?? null);
  }

  return resolveEffectiveState(record, schemaCause);
}

export interface RecordedAttempt {
  referenceId: string;
  expiresAt: string;
}

/**
 * Persist a started attempt, binding OUR minted reference to the subject.
 *
 * This binding is what makes the webhook safe. When the callback arrives
 * carrying only a reference, the subject comes from THIS row — the callback
 * never gets to name whose account it is verifying.
 */
export async function recordAttemptStarted(
  supabaseAdmin: SupabaseClient,
  subject: VerificationSubject,
  attempt: RecordedAttempt,
): Promise<void> {
  const { error } = await supabaseAdmin.from(VERIFICATION_ATTEMPTS_TABLE).insert({
    reference_id: attempt.referenceId,
    subject_type: subject.kind,
    center_id: subject.kind === 'center' ? subject.centerId : null,
    user_id: subject.kind === 'teacher' ? subject.userId : null,
    expires_at: attempt.expiresAt,
    state: 'pending',
  });

  if (error) {
    if (isMissingRelation(error)) {
      throw new VerificationStoreError(
        'verification_schema_not_applied',
        `${VERIFICATION_ATTEMPTS_TABLE} is not present in this database. Apply the migration proposal first.`,
      );
    }
    throw new VerificationStoreError(
      'query_failed',
      `Could not record the verification attempt: ${
        (error as { message?: string }).message ?? 'unknown error'
      }`,
    );
  }
}

/** Resolve which subject a webhook reference belongs to. Server-side truth. */
export async function resolveSubjectForReference(
  supabaseAdmin: SupabaseClient,
  referenceId: string,
): Promise<VerificationSubject> {
  const { data, error } = await supabaseAdmin
    .from(VERIFICATION_ATTEMPTS_TABLE)
    .select('subject_type, center_id, user_id')
    .eq('reference_id', referenceId)
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      throw new VerificationStoreError(
        'verification_schema_not_applied',
        `${VERIFICATION_ATTEMPTS_TABLE} is not present in this database.`,
      );
    }
    throw new VerificationStoreError(
      'query_failed',
      `Could not resolve the verification attempt: ${
        (error as { message?: string }).message ?? 'unknown error'
      }`,
    );
  }

  const row = data as { subject_type?: string; center_id?: string; user_id?: string } | null;
  if (!row) {
    throw new VerificationStoreError(
      'attempt_not_found',
      `No verification attempt matches reference ${referenceId}. Refusing to act on an unbound callback.`,
    );
  }

  if (row.subject_type === 'center' && row.center_id) {
    return { kind: 'center', centerId: row.center_id };
  }
  if (row.subject_type === 'teacher' && row.user_id) {
    return { kind: 'teacher', userId: row.user_id };
  }

  throw new VerificationStoreError(
    'attempt_not_found',
    `Verification attempt ${referenceId} has no usable subject binding.`,
  );
}

export interface OutcomeToPersist {
  outcome: VerificationOutcome;
  providerReference: string | null;
  /** Only meaningful on `passed`; ignored otherwise. */
  nationalId: string | null;
  /** Only meaningful on `passed`; ignored otherwise. */
  legalName: string | null;
  /** The instant the outcome occurred, ISO 8601 UTC. */
  occurredAt: string;
  /**
   * The CAIRO calendar day of `occurredAt`, as YYYY-MM-DD.
   *
   * Stored separately from the instant on purpose. The user-visible
   * verification date ("verified 12/07/2025", VERIFICATION-SPEC §1.2) is a
   * Cairo date, and deriving it from a UTC instant at render time drifts by a
   * day for anything after 22:00 Cairo. Computed once, here, by the caller via
   * `cairoDateKey()` — never with a bare `new Date()` at the display layer.
   */
  occurredOnCairoDay: string;
}

/**
 * Write the outcome of a verified webhook.
 *
 * Only reachable from the webhook route, and only after the HMAC passed. The
 * tax-skeleton fields are written ONLY on a pass — a failed, abandoned or
 * expired check produces no ETA receipt, so there is no legal obligation to
 * satisfy and therefore no lawful basis to retain a national ID from it. On any
 * non-pass this explicitly writes NULL over both, so a previous attempt's data
 * cannot linger against a now-unverified provider.
 */
export async function persistVerificationOutcome(
  supabaseAdmin: SupabaseClient,
  subject: VerificationSubject,
  outcome: OutcomeToPersist,
): Promise<{ state: string }> {
  const state = stateForOutcome(outcome.outcome);
  const passed = outcome.outcome === 'passed';

  const row = {
    subject_type: subject.kind,
    center_id: subject.kind === 'center' ? subject.centerId : null,
    user_id: subject.kind === 'teacher' ? subject.userId : null,
    state,
    last_outcome: outcome.outcome,
    provider: 'valify',
    provider_reference: outcome.providerReference,
    national_id: passed ? outcome.nationalId : null,
    legal_name: passed ? outcome.legalName : null,
    verified_at: passed ? outcome.occurredAt : null,
    verified_cairo_day: passed ? outcome.occurredOnCairoDay : null,
    updated_at: outcome.occurredAt,
  };

  const { error } = await supabaseAdmin
    .from(VERIFICATION_RECORDS_TABLE)
    .upsert(row, {
      onConflict: subject.kind === 'center' ? 'center_id' : 'user_id',
    });

  if (error) {
    if (isMissingRelation(error)) {
      throw new VerificationStoreError(
        'verification_schema_not_applied',
        `${VERIFICATION_RECORDS_TABLE} is not present in this database. The outcome was NOT recorded.`,
      );
    }
    throw new VerificationStoreError(
      'query_failed',
      `Could not persist the verification outcome: ${
        (error as { message?: string }).message ?? 'unknown error'
      }`,
    );
  }

  return { state };
}
