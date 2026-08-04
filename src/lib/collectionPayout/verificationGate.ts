// src/lib/collectionPayout/verificationGate.ts
//
// The seam between Territory C (this work: collection + payout engine) and
// Territory A (identity verification: the Valify redirect, the state machine and
// the guard). Territory A owns the state; this module owns the QUESTION
// "may this principal collect / be paid out?" and the refusal when the answer
// is no.
//
// ── LIVE FACT, verified 2026-08-04 against project lczmjpnbuhnsislcvzar ──────
//
//   select table_name, column_name from information_schema.columns
//   where table_schema='public'
//     and (column_name ilike '%verif%' or column_name ilike '%national%'
//          or column_name ilike '%kyc%'  or column_name ilike '%valify%');
//
// Sixteen rows came back. Every one of them is an OTP flag
// (students.phone_verified, phone_verifications.verified_at,
// enrollment_otps.verified_at, teacher_signup_otps.verified_at), a backup
// integrity stamp (backup_log.last_verified_at), or a payout-destination /
// permission column. NOT ONE is identity verification.
//
// `centers` has 108 columns and NONE of them is national_id,
// verification_status, verified_at, verified_name, valify_transaction_id or
// payout_name_matches. The same holds for `users`, `teacher_profiles` and
// `teacher_center`. There is no `verifications` table, no `kyc_*`, no
// `valify_*`, no `identity_*` in the 137-table enumeration.
//
// ── THEREFORE ────────────────────────────────────────────────────────────────
//
// This module DOES NOT QUERY a verification column. Selecting a column that does
// not exist is the F26 defect class — CI has no live database, so it passes
// every gate and 500s in production (the 8 July student-detail outage). Instead
// the gate returns a NAMED REFUSAL that says the state has no live source.
//
// It never returns `verified: true` from a guess, a default, an env flag, or a
// request field. There is exactly one way for this to return verified and it
// does not exist yet.
//
// ── WIRING POINT FOR TERRITORY A ─────────────────────────────────────────────
//
// When Territory A lands `verification_status`, `verified_at` and
// `valify_transaction_id` (proposed, not applied, in
// supabase/migrations/20260804140000_PROPOSAL_payout_system_1_ledger.sql for the
// payout side; Territory A proposes the verification columns themselves), the
// ONLY change here is to replace the body of `resolvePrincipalVerification`
// with a read of Territory A's guard. Nothing downstream changes: every consumer
// already branches on this union.
//
// ── PRIVACY (Egyptian Law 151/2020) ──────────────────────────────────────────
//
// Whatever replaces the body must NOT bring the ID document anywhere near this
// process. design/DECISION-national-id-2026-07-26.md: the document image never
// touches TutoringHQ infrastructure; verification is a redirect to a
// Valify-hosted page and we store only an outcome — status, timestamp, provider
// reference — plus the ID number and legal name for the ETA e-receipt skeleton.
// The legal basis is COMPLIANCE WITH A LEGAL OBLIGATION (the ETA e-receipt),
// not consent, so there is no opt-out and the consent language elsewhere in the
// privacy policy does not apply to that field. This gate must never render,
// return, or log a national ID number.

import type { SupabaseClient } from '@supabase/supabase-js';

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
  /** Territory A landed, and this principal has simply not verified. */
  | 'principal_not_verified'
  /** Territory A landed and the check is still running. Not a rejection. */
  | 'verification_pending'
  /** Verified, but no payout destination on file. */
  | 'payout_destination_missing';

export type VerificationGateResult =
  | {
      verified: true;
      verifiedAt: string;
      /** Backend-only provider reference. NEVER rendered. */
      providerReference: string;
    }
  | {
      verified: false;
      cause: VerificationRefusalCause;
      /** i18n key, present in both ar.json and en.json. */
      messageKey: string;
      /**
       * What a human would have to do to change this answer. For the
       * schema-absent cause this is deliberately an engineering action, not a
       * user action — telling a centre owner to "try again" when no code path
       * can ever succeed is the fake-success failure in a politer voice.
       */
      blockedOn: string;
    };

const SCHEMA_ABSENT: VerificationGateResult = {
  verified: false,
  cause: 'verification_state_not_in_schema',
  messageKey: 'collectionPayout.verification.stateNotInSchema',
  blockedOn:
    'Identity verification has no live source: there is no verification column on centers, users or teacher_profiles, and no verification table. Territory A (Valify redirect + state machine) must land, and its migration must be applied by hand, before any principal can be verified.',
};

/**
 * Resolve whether a principal may collect online / be paid out.
 *
 * `supabaseAdmin` is accepted so the signature does not change when Territory A
 * wires a real read in; it is deliberately unused today because there is
 * nothing in the catalog to read.
 */
/* eslint-disable @typescript-eslint/no-unused-vars -- Both parameters are
   deliberately unused: there is nothing in the live catalog to read (see the
   header). They are part of the signature NOW so that Territory A's wiring is a
   body change and not a call-site change across every consumer. */
export async function resolvePrincipalVerification(
  _supabaseAdmin: SupabaseClient,
  _principal: Principal,
): Promise<VerificationGateResult> {
  // No read. See the header: querying a column that does not exist is F26.
  return SCHEMA_ABSENT;
}
/* eslint-enable @typescript-eslint/no-unused-vars */

/** True only for a positively verified principal. Never true by default. */
export function isVerified(result: VerificationGateResult): result is Extract<
  VerificationGateResult,
  { verified: true }
> {
  return result.verified === true;
}

/** The refusal payload a route returns when the gate says no. */
export function verificationRefusalBody(
  result: Extract<VerificationGateResult, { verified: false }>,
) {
  return {
    ok: false as const,
    error: 'principal_not_verified',
    cause: result.cause,
    messageKey: result.messageKey,
    blockedOn: result.blockedOn,
  };
}
