// src/lib/collectionPayout/verificationGate.ts
//
// The seam between the collection + payout engine (this territory) and identity
// verification (the Valify redirect, the state machine and the guard). The
// identity engine owns the STATE; this module owns the QUESTION "may this
// principal collect / be paid out?" and the refusal when the answer is no.
//
// ── THE SEAM IS NOW WIRED. IT WAS A CONSTANT. ────────────────────────────────
//
// `resolvePrincipalVerification` previously ignored both of its parameters and
// returned a module-level SCHEMA_ABSENT constant unconditionally. That was honest
// — the answer it gave was the correct answer — but it was honest by coincidence
// rather than by derivation, and it would have stayed "no live source" for the
// rest of time, including the hour after Eyad applied the migration. It now
// actually calls `getEffectiveVerification()` and `capabilitiesFor()` and derives
// its refusal from what they return.
//
// The refusal today is UNCHANGED IN SUBSTANCE and unchanged in cause code:
// `verification_state_not_in_schema`, because the identity tables genuinely are
// not in the database and `getEffectiveVerification` reports exactly that. The
// difference is that this is now the answer the engine gave, not the answer this
// file was hardcoded to give.
//
// ── LIVE FACTS, RE-VERIFIED 2026-08-04 against project lczmjpnbuhnsislcvzar ──
//
// Every number below was produced by running the query, this session. The
// version of this header that shipped on the collection-and-payout branch said
// sixteen identity-pattern columns, 108 columns on `centers` and 137 tables. All
// three were wrong. The material conclusion they supported was right, which is
// exactly why the wrong numbers survived review: a correct conclusion does not
// audit its own premises.
//
//   select count(*) from information_schema.columns
//   where table_schema='public'
//     and (column_name ilike '%verif%' or column_name ilike '%national%'
//          or column_name ilike '%kyc%'  or column_name ilike '%valify%');
//   → 6
//
// SIX rows, not sixteen, and they are:
//   backup_log.last_verified_at          (backup integrity)
//   enrollment_otps.verified_at          (OTP)
//   phone_verifications.verified_at      (OTP)
//   students.parent_phone_verified       (OTP)
//   students.phone_verified              (OTP)
//   teacher_signup_otps.verified_at      (OTP)
//
// NOT ONE is identity verification. Note also that the earlier header described
// the matches as including "payout-destination / permission columns" — that
// pattern cannot match such a column, and no such column matched. It was
// description invented to fit a count that was itself invented.
//
//   select count(*) from information_schema.columns
//   where table_schema='public' and table_name='centers';           → 128
//   ... and table_name='teacher_profiles';                          →  24
//   select count(*) from information_schema.tables
//   where table_schema='public' and table_type='BASE TABLE';        → 142
//
// `centers` has 128 columns (not 108) and NONE of them is national_id,
// verification_status, verified_at, verified_name, valify_transaction_id or
// payout_name_matches. `teacher_profiles` has 24, likewise. Of the 142 base
// tables (not 137) neither `verification_records` nor `verification_attempts`
// exists, and there is no `kyc_*`, `valify_*` or `identity_*` among them.
//
// ── WHY THIS IS STILL NOT AN F26 ─────────────────────────────────────────────
//
// Selecting a column that does not exist is the defect class that caused the
// 8 July student-detail outage: CI has no live database, so it passes every gate
// and 500s in production. This module now DOES issue a query — through
// `getEffectiveVerification` — against tables that do not exist. That is safe
// only because every read in `verificationStore.ts` is passed through
// `isMissingRelation()`, which translates an undefined-table error into the named
// cause `verification_schema_not_applied` instead of letting it escape as a 500.
// The gate below then maps that cause to a refusal. The error is expected,
// caught, and named — which is the difference between handling F26 and being it.
//
// It never returns `verified: true` from a guess, a default, an env flag, or a
// request field. The ONLY route to `verified: true` is an `EffectiveVerification`
// whose `isVerified` is true, which `resolveEffectiveState` can only produce when
// the Valify guard is satisfied AND a stored row says verified — and the only
// actor permitted to write that row is an HMAC-verified Valify webhook.
//
// ── PRIVACY (Egyptian Law 151/2020) ──────────────────────────────────────────
//
// design/DECISION-national-id-2026-07-26.md: the ID document image never touches
// TutoringHQ infrastructure; verification is a redirect to a Valify-hosted page
// and we store only an outcome — status, timestamp, provider reference — plus the
// ID number and legal name for the ETA e-receipt skeleton. The legal basis is
// COMPLIANCE WITH A LEGAL OBLIGATION (the ETA e-receipt), not consent, so there
// is no opt-out and the consent language elsewhere in the privacy policy does not
// apply to that field.
//
// This gate must never render, return, or log a national ID number, and it
// cannot: `EffectiveVerification`, the only thing it receives, has no field
// carrying one. The success arm below also drops the `providerReference` it used
// to declare — VERIFICATION-SPEC §9.7 makes that backend-only, no consumer in the
// payout path ever read it, and a field that must never be shown is safest when
// it is not passed through the money path at all.

import type { SupabaseClient } from '@supabase/supabase-js';
import { capabilitiesFor } from '@/lib/verificationState';
import {
  VerificationStoreError,
  getEffectiveVerification,
  type VerificationSubject,
} from '@/lib/verificationStore';

/** Who is being gated. Teachers are centre-less (users.center_id NULL). */
export type PrincipalKind = 'center' | 'teacher';

export interface Principal {
  kind: PrincipalKind;
  /** centers.id for a centre principal; null for a teacher. */
  centerId: string | null;
  /** users.id — the authenticated user. Always server-derived, never from a body. */
  userId: string;
}

export type VerificationRefusalCause =
  /** No live source for verification state. The state of the world today. */
  | 'verification_state_not_in_schema'
  /** The Valify credentials are absent or still placeholders. */
  | 'verification_provider_not_configured'
  /** The verification state exists but could not be read. Never permissive. */
  | 'verification_state_unreadable'
  /** This principal has simply not verified. */
  | 'principal_not_verified'
  /** The check is still running. Not a rejection. */
  | 'verification_pending'
  /** Verified, but no payout destination on file. */
  | 'payout_destination_missing';

export type VerificationGateResult =
  | {
      verified: true;
      /**
       * ISO instant of the pass. Nullable because a verified row with no
       * timestamp is a data defect, not a reason to block money that the state
       * machine has already cleared — the caller renders a date only if it has
       * one.
       */
      verifiedAt: string | null;
    }
  | {
      verified: false;
      cause: VerificationRefusalCause;
      /** i18n key, present in both ar.json and en.json. */
      messageKey: string;
      /**
       * What a human would have to do to change this answer. For the
       * schema-absent and provider-not-configured causes this is deliberately an
       * engineering action, not a user action — telling a centre owner to "try
       * again" when no code path can ever succeed is the fake-success failure in
       * a politer voice.
       */
      blockedOn: string;
    };

type Refusal = Extract<VerificationGateResult, { verified: false }>;

const SCHEMA_ABSENT: Refusal = {
  verified: false,
  cause: 'verification_state_not_in_schema',
  messageKey: 'collectionPayout.verification.stateNotInSchema',
  blockedOn:
    'Identity verification has no live source: verification_records and verification_attempts are absent from the database (142 base tables in public, neither among them, verified 4 Aug 2026). The identity migration proposal must be applied by hand before any principal can be verified.',
};

const PROVIDER_NOT_CONFIGURED: Refusal = {
  verified: false,
  cause: 'verification_provider_not_configured',
  messageKey: 'collectionPayout.verification.providerNotConfigured',
  blockedOn:
    'The Valify credentials on this deployment are absent or still the .env.example placeholders, so no identity check can run and no verification outcome could have been recorded. Set the real VALIFY_* values before expecting any principal to be verified.',
};

const STATE_UNREADABLE: Refusal = {
  verified: false,
  cause: 'verification_state_unreadable',
  messageKey: 'collectionPayout.verification.unreadable',
  blockedOn:
    'The verification record could not be read (a query failure, not a missing table). Nothing was changed. An unreadable state is never a verified state, so this refuses until the read succeeds.',
};

const NOT_VERIFIED: Refusal = {
  verified: false,
  cause: 'principal_not_verified',
  messageKey: 'collectionPayout.verification.notVerified',
  blockedOn: 'This principal has not passed an identity check. They can start one.',
};

const PENDING: Refusal = {
  verified: false,
  cause: 'verification_pending',
  messageKey: 'collectionPayout.verification.pending',
  blockedOn:
    'An identity check is in flight. It is not a rejection and there is nothing for anyone to do but wait for the webhook.',
};

const MALFORMED_PRINCIPAL: Refusal = {
  verified: false,
  cause: 'verification_state_unreadable',
  messageKey: 'collectionPayout.verification.unreadable',
  blockedOn:
    'The principal handed to the gate was a centre with no centerId. That is a caller defect. Refusing rather than falling back to the userId, because gating one subject on another subject’s verification is how money reaches the wrong person.',
};

/**
 * Resolve whether a principal may collect online / be paid out.
 *
 * TENANCY: the `Principal` is already resolved server-side by the caller from the
 * authenticated session. This function converts it to a `VerificationSubject` and
 * passes it straight through; nothing here reads a subject from request input,
 * and `getEffectiveVerification` scopes every query by that subject.
 */
export async function resolvePrincipalVerification(
  supabaseAdmin: SupabaseClient,
  principal: Principal,
): Promise<VerificationGateResult> {
  let subject: VerificationSubject;
  if (principal.kind === 'center') {
    if (!principal.centerId) return MALFORMED_PRINCIPAL;
    subject = { kind: 'center', centerId: principal.centerId };
  } else {
    subject = { kind: 'teacher', userId: principal.userId };
  }

  let effective;
  try {
    effective = await getEffectiveVerification(supabaseAdmin, subject);
  } catch (err) {
    if (err instanceof VerificationStoreError) {
      return err.cause_code === 'verification_schema_not_applied' ? SCHEMA_ABSENT : STATE_UNREADABLE;
    }
    // An unrecognised throw is still a refusal. The one thing this function must
    // never do on an error path is return verified.
    return STATE_UNREADABLE;
  }

  if (effective.state === 'unconfigured') {
    return effective.cause === 'verification_schema_not_applied'
      ? SCHEMA_ABSENT
      : PROVIDER_NOT_CONFIGURED;
  }
  if (effective.state === 'pending') return PENDING;

  // Two independent authorities must both say yes: the resolved boolean and the
  // capability table (VERIFICATION-SPEC §6, which is what actually decides that
  // online collection is a gated capability). They cannot currently disagree —
  // `capabilitiesFor` keys on the same state — and requiring both is what keeps
  // a future change to either one from silently opening the gate.
  if (!effective.isVerified || !capabilitiesFor(effective.state).onlineCollection) {
    return NOT_VERIFIED;
  }

  return { verified: true, verifiedAt: effective.verified_at };
}

/** True only for a positively verified principal. Never true by default. */
export function isVerified(
  result: VerificationGateResult,
): result is Extract<VerificationGateResult, { verified: true }> {
  return result.verified === true;
}

/** The refusal payload a route returns when the gate says no. */
export function verificationRefusalBody(result: Refusal) {
  return {
    ok: false as const,
    error: 'principal_not_verified',
    cause: result.cause,
    messageKey: result.messageKey,
    blockedOn: result.blockedOn,
  };
}
