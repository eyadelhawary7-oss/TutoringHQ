// src/lib/collectionPayout/enableCollection.ts
//
// The path by which a VERIFIED centre or teacher lets TutoringHQ collect tuition
// from parents on their behalf ("collect for me" / "collect for you").
//
// Three gates, evaluated in this order, each with its own named cause. The order
// matters: the most honest answer first. Telling a centre "verify your identity"
// when the platform-wide switch is also off would send them through a Valify
// flow that changes nothing.
//
//   1. THE CONFIG POINT (src/lib/collectionPayout/config.ts). Placeholders ⇒
//      refuse. Nobody can enable collection while the rail is unconfigured, the
//      rate card is zeroed and the platform switch is off.
//   2. THE VERIFICATION GATE (Territory A). Unverified ⇒ refuse, and say why.
//      design/VERIFICATION-SPEC.md §6: online collection is GATED on
//      verification for both centres and teachers. Referral ACCRUAL is not, and
//      is untouched here.
//   3. THE PAYOUT DESTINATION. Collecting money for a principal we cannot pay is
//      a trap: it accrues an obligation with no exit.
//
// ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────────
//
// It does not draw a screen. `Merged-Verification-Payouts` §01/§02,
// `Merged-Center-Money`, `Merged-Teacher-Money` and `Merged-Admin-Money` are
// protected files and Eyad's phase. This is the engine and the state; the
// inventory of screens that will need wiring is in the Territory C handoff.
//
// It does not write a verification column, because none exists.
//
// ── MULTI-TENANCY ────────────────────────────────────────────────────────────
//
// `center_id` is ALWAYS derived server-side from the authenticated user and
// NEVER from request input. Teachers are centre-less by design (users.center_id
// NULL, linked through teacher_center) and that is not a bug to fix — a teacher
// principal carries `centerId: null` and is resolved through `teacher_profiles`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCollectionPayoutConfig, refusalBody } from './config';
import {
  type Principal,
  resolvePrincipalVerification,
  verificationRefusalBody,
} from './verificationGate';

export type EnableRefusalCause =
  | 'collection_payout_not_configured'
  | 'principal_not_verified'
  | 'payout_destination_missing'
  | 'not_owner';

export interface EnableRefusal {
  ok: false;
  cause: EnableRefusalCause;
  messageKey: string;
  detail: Record<string, unknown>;
}

export interface EnableOk {
  ok: true;
  principal: Principal;
  enabledAt: string;
}

/**
 * Whether this principal MAY enable online collection, and the reason if not.
 *
 * This is the read-only half; it is what `GET /api/collection/status` renders
 * and what `POST /api/collection/enable` calls first. Separating them means the
 * status surface and the mutation can never disagree about the cause.
 */
export async function evaluateCollectionEligibility(
  supabaseAdmin: SupabaseClient,
  principal: Principal,
): Promise<EnableOk | EnableRefusal> {
  // Gate 1 — the config point.
  const cfg = await loadCollectionPayoutConfig(supabaseAdmin);
  if (!cfg.configured) {
    return {
      ok: false,
      cause: 'collection_payout_not_configured',
      messageKey: 'collectionPayout.cause.collection_payout_not_configured',
      detail: refusalBody(cfg),
    };
  }

  // Gate 2 — verification. Territory A owns the answer; this owns the refusal.
  const verification = await resolvePrincipalVerification(supabaseAdmin, principal);
  if (!verification.verified) {
    return {
      ok: false,
      cause: 'principal_not_verified',
      messageKey: verification.messageKey,
      detail: verificationRefusalBody(verification),
    };
  }

  // Gate 3 — a payout destination we can actually pay.
  const destination = await readPayoutDestination(supabaseAdmin, principal);
  if (!destination.present) {
    return {
      ok: false,
      cause: 'payout_destination_missing',
      messageKey: 'collectionPayout.enable.payoutDestinationMissing',
      detail: { checked: destination.checked },
    };
  }

  return { ok: true, principal, enabledAt: new Date().toISOString() };
}

/**
 * Read the principal's payout destination from columns that ACTUALLY EXIST.
 *
 * LIVE FACTS, verified 2026-08-04 (project lczmjpnbuhnsislcvzar,
 * information_schema.columns):
 *   centers.instapay_number            text     NULL   ✅ exists
 *   centers.instapay_reference         text     NULL   ✅ exists
 *   teacher_profiles.payout_destination jsonb   NULL   ✅ exists, 0 rows populated
 *   teacher_profiles.instapay_address  text     NULL   ✅ exists
 *
 * There is NO iban column, NO account_holder column and NO payout_name_matches
 * column anywhere in the schema. None is read here.
 *
 * ── ATTACK A2, and why this is a READ AND NOT A SNAPSHOT ─────────────────────
 * `centers.instapay_number` was writable through the /api/db proxy until it was
 * added to CENTERS_PROTECTED_COLUMNS (src/lib/dbProxyProtectedColumns.ts:159, in
 * commit d728da75). Even so, this function's result MUST NEVER be read at
 * release time. The destination is snapshotted onto `center_payouts` at APPROVAL
 * into immutable `snap_*` columns with an UPDATE-blocking trigger, and release
 * aborts if the live destination differs. Reading a live destination at release
 * is attack A2 — approve on the 3rd, owner changes the number on the 5th,
 * release on the 7th pays the new one.
 */
async function readPayoutDestination(
  supabaseAdmin: SupabaseClient,
  principal: Principal,
): Promise<{ present: boolean; checked: string[] }> {
  if (principal.kind === 'center' && principal.centerId) {
    const { data, error } = await supabaseAdmin
      .from('centers')
      .select('instapay_number')
      .eq('id', principal.centerId)
      .maybeSingle();
    const checked = ['centers.instapay_number'];
    if (error || !data) return { present: false, checked };
    const value = (data as { instapay_number?: string | null }).instapay_number ?? '';
    return { present: value.trim().length > 0, checked };
  }

  const { data, error } = await supabaseAdmin
    .from('teacher_profiles')
    .select('payout_destination, instapay_address')
    .eq('user_id', principal.userId)
    .maybeSingle();
  const checked = ['teacher_profiles.payout_destination', 'teacher_profiles.instapay_address'];
  if (error || !data) return { present: false, checked };
  const row = data as { payout_destination?: unknown; instapay_address?: string | null };
  const hasJson = row.payout_destination != null && typeof row.payout_destination === 'object';
  const hasInstapay = (row.instapay_address ?? '').trim().length > 0;
  return { present: hasJson || hasInstapay, checked };
}

/**
 * Enable online collection for a principal.
 *
 * Today this ALWAYS refuses — gate 1 and gate 2 both fail — and that is the
 * intended, correct behaviour. It is written as the complete path so that when
 * the config point is filled and Territory A lands, the only thing that changes
 * is that the gates start passing.
 *
 * The persistence step is deliberately behind gate 3 and is the one part that
 * needs a column that does not exist yet: there is no `collection_enabled`
 * column on `centers` or `teacher_profiles`. It is PROPOSED, not applied, in
 * supabase/migrations/20260804140000_PROPOSAL_payout_system_1_ledger.sql.
 */
export async function enableCollection(
  supabaseAdmin: SupabaseClient,
  principal: Principal,
): Promise<EnableOk | EnableRefusal> {
  const eligibility = await evaluateCollectionEligibility(supabaseAdmin, principal);
  if (!eligibility.ok) return eligibility;

  const { error } = await supabaseAdmin.rpc('collection_enable_for_principal', {
    p_center_id: principal.centerId,
    p_user_id: principal.userId,
    p_principal_kind: principal.kind,
  });
  if (error) {
    return {
      ok: false,
      cause: 'collection_payout_not_configured',
      messageKey: 'collectionPayout.cause.ledger_not_migrated',
      detail: {
        operation: 'collection_enable_for_principal',
        message: error.message,
        migrationProposal:
          'supabase/migrations/20260804140000_PROPOSAL_payout_system_1_ledger.sql',
      },
    };
  }
  return eligibility;
}
