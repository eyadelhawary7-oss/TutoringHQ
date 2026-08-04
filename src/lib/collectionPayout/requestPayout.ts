// src/lib/collectionPayout/requestPayout.ts
//
// ██ THE FRONT DOOR of payout System 1. ██
//
// ── WHAT WAS MISSING, AND HOW IT WAS MISSED ──────────────────────────────────
//
// The approve and release endpoints shipped first, are CSRF-gated, cap-gated,
// step-up-gated and unit-tested. The queue they work could never receive an
// entry: `createPayoutRequest` in ./payoutEngine.ts had ZERO callers anywhere in
// src/, and `src/app/api/admin/center-payouts/route.ts` exports GET and nothing
// else. Verified by grep on 4 August 2026 against this branch:
//
//   rg 'createPayoutRequest' src/            → 1 file (its own module)
//   rg 'payout_request_create' src/          → 1 file (its own module)
//   rg 'export async function POST' src/app/api/admin/center-payouts/route.ts
//                                            → no match
//
// This is the same shape as PAYOUT-SYSTEM-SPEC.md §2.1 — "`payout_requests` has
// no approval path whatsoever … its status can never leave `pending` through any
// code path in the application" — with the two ends swapped. §2.1 built the
// request with no approval; this branch built the approval with no request. A
// pipeline missing either end is not a pipeline, and in both cases the gap was
// invisible because every INDIVIDUAL piece was correct and tested.
//
// ── WHY THIS SHAPE IS THE SPEC'S AND NOT A GUESS ─────────────────────────────
//
// PAYOUT-SYSTEM-SPEC.md decides every axis of the front door:
//
//   WHO INITIATES — §7.1, as a spec invariant: "request authority is center-side,
//   release authority is platform-side, and they live in different tables so that
//   no single grant path can produce both." So this is NOT a `/api/admin/*` route
//   and an `admin_users` row is NOT what opens it.
//
//   WHICH CENTRE-SIDE ACTOR — Decision 1, and §2.7 in full: `/api/billing/
//   withdrawal` is owner-only while `/api/referrals/payout` gates on the
//   delegable `can_request_referral_payouts`, which is true on exactly ONE row in
//   the entire database. "Picking the weaker one would hand payout initiation to
//   staff accounts at centers that today are owner-only, with no announcement."
//   Decision 1's answer: **unify on owner-only plus step-up auth.** So this
//   refuses a non-owner centre user outright, and `can_request_referral_payouts`
//   is not consulted — a permission held by one row cannot be the gate on the
//   unified path without widening access for everyone else.
//
//   WHETHER VERIFICATION GATES IT — VERIFICATION-SPEC.md §6 and its capability
//   table: "Referral earnings — withdrawal ✅ Gated · §02: 'Verify to withdraw'".
//   `capabilitiesFor(state).withdrawals` is the machine-readable form and is what
//   is read below. Referral ACCRUAL is ungated and is untouched here.
//
//   WHAT MUST NOT COME FROM THE BODY — §7.4 and §3 invariant 5. `center_id` is
//   derived from the authenticated session by the route and passed in already
//   resolved. The RAIL is derived here, not chosen by the caller: the
//   counter-account is derived from `rail` inside the RPC, and letting a centre
//   owner name it is attack A6 (a hand-sent InstaPay posted against
//   `paymob_budget` drifts the modelled float below reality, the low-float alarm
//   fires, and finance tops up money that was never needed).
//
// ── HOW IT FAILS TODAY, WHICH IS THE ONLY WAY IT CAN BEHAVE TODAY ────────────
//
// Every call returns a REFUSAL with a named cause. There is no input, and no
// state of the world reachable from a browser, that makes this return ok. Gate 1
// alone guarantees it: the config point holds placeholders on every deployment.
// It never returns a fabricated payout id, never a 200 with `ok: false`, and
// never a silent no-op.
//
// The gate ORDER is load-bearing and is the same principle as
// ./enableCollection.ts: the most honest answer first. Telling an owner "verify
// your identity" while the rail is also unconfigured would send them through a
// Valify flow that changes nothing, and telling them "insufficient balance" while
// the ledger does not exist would blame them for an unapplied migration.

import type { SupabaseClient } from '@supabase/supabase-js';
import { capabilitiesFor } from '@/lib/verificationState';
import { loadCollectionPayoutConfig, refusalBody } from './config';
import { createPayoutRequest, getAvailableBalanceMinor } from './payoutEngine';
import type { CreatePayoutOk, EngineRefusal } from './payoutEngine';
import {
  type Principal,
  resolvePrincipalVerification,
  verificationRefusalBody,
} from './verificationGate';

/** The two balances System 1 pays out. §1(a) and §1(b). */
export const PAYOUT_SOURCES = ['referral_earnings', 'credit_balance'] as const;
export type PayoutSource = (typeof PAYOUT_SOURCES)[number];

export function isPayoutSource(v: unknown): v is PayoutSource {
  return typeof v === 'string' && (PAYOUT_SOURCES as readonly string[]).includes(v);
}

/**
 * The rail, DERIVED and never accepted from a caller.
 *
 * `manual_instapay` exists for a payout a human sends by hand from the platform
 * bank account; it is an operations action, not something a centre may ask for.
 * A centre request always targets the automated rail.
 */
export const REQUEST_RAIL = 'paymob_payouts' as const;

export type RequestRefusalCause =
  | 'not_owner'
  | 'payout_request_invalid'
  | 'collection_payout_not_configured'
  | 'principal_not_verified'
  | 'payout_destination_missing'
  | 'insufficient_available'
  | 'step_up_auth_required'
  | 'ledger_not_migrated'
  | 'engine_error';

export interface RequestRefusal {
  ok: false;
  cause: RequestRefusalCause;
  /** i18n key. Present in both messages/ar.json and messages/en.json. */
  messageKey: string;
  detail: Record<string, unknown>;
}

function refuse(
  cause: RequestRefusalCause,
  messageKey: string,
  detail: Record<string, unknown> = {},
): RequestRefusal {
  return { ok: false, cause, messageKey, detail };
}

export interface PayoutRequestInput {
  /** Resolved server-side by the route from the authenticated session. */
  principal: Principal;
  /** Requested GROSS in PIASTRES. Named `...Minor` so the unit cannot be lost. */
  amountMinor: number;
  source: PayoutSource;
  /**
   * Whether `verifyPasswordForSensitiveAction` has ALREADY succeeded for this
   * request. The route owns the HTTP half of step-up; this owns the gate.
   */
  stepUpVerified: boolean;
  /**
   * Caller-supplied, stable across retries of the SAME logical request. This is
   * the ONLY deduplication in the whole path — §6: the payout provider offers no
   * idempotency key of any kind.
   */
  idempotencyKey: string;
}

/**
 * A payout amount must be a positive safe integer number of piastres.
 *
 * Rejecting non-integers is not pedantry: `Number('10.5')` is a valid float and
 * `gross_minor` is `bigint`, so a fractional piastre would either round
 * somewhere invisible or raise inside the transaction with a Postgres string
 * instead of a legible cause.
 */
export function validateAmountMinor(raw: unknown): { ok: true; amountMinor: number } | RequestRefusal {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) {
    return refuse('payout_request_invalid', 'collectionPayout.request.amountInvalid', {
      field: 'amountMinor',
      unit: 'piastres',
      received: typeof raw === 'number' || typeof raw === 'string' ? raw : typeof raw,
      note: 'The amount must be a positive whole number of piastres. It is never read as EGP and never rounded.',
    });
  }
  return { ok: true, amountMinor: n };
}

/**
 * Read the centre's payout destination from a column that ACTUALLY EXISTS.
 *
 * LIVE FACT, verified 2026-08-04 (project lczmjpnbuhnsislcvzar,
 * information_schema.columns): `centers.instapay_number` text NULL exists. There
 * is no `iban`, no `account_holder` and no `payout_name_matches` column anywhere
 * in the schema, and none is read.
 *
 * This is a PRESENCE CHECK ONLY and its result never reaches the payout row. The
 * destination is snapshotted onto `center_payouts.snap_*` at APPROVAL behind an
 * UPDATE-blocking trigger, and release aborts if the live destination differs.
 * Reading a live destination at release time is attack A2 — approve on the 3rd,
 * the owner changes the number on the 5th, release on the 7th pays the new one.
 */
async function centreHasPayoutDestination(
  supabaseAdmin: SupabaseClient,
  centerId: string,
): Promise<{ present: boolean; checked: string[] }> {
  const checked = ['centers.instapay_number'];
  try {
    const { data, error } = await supabaseAdmin
      .from('centers')
      .select('instapay_number')
      .eq('id', centerId)
      .maybeSingle();
    if (error || !data) return { present: false, checked };
    const value = (data as { instapay_number?: string | null }).instapay_number ?? '';
    return { present: value.trim().length > 0, checked };
  } catch {
    return { present: false, checked };
  }
}

export interface PayoutRequestEligibility {
  ok: true;
  /**
   * The available balance, only when it came from the ledger. Null when there is
   * no source for it — see the note in the balance gate below.
   */
  availableMinor: number | null;
}

/**
 * Everything that must be true before a payout may be requested, EXCEPT step-up
 * auth — which is deliberately last, in `submitPayoutRequest`, so that a PIN is
 * never demanded for an action that cannot succeed for a reason the owner is
 * powerless to change.
 *
 * Read-only. Writes nothing on any path. This is also what a status surface can
 * call to render the reason without attempting the mutation, so the two can
 * never disagree about the cause.
 */
export async function evaluatePayoutRequestEligibility(
  supabaseAdmin: SupabaseClient,
  principal: Principal,
  amountMinor: number,
): Promise<PayoutRequestEligibility | RequestRefusal> {
  // A centre principal with no centerId is a CALLER defect, not a user error.
  // Refusing rather than falling back to the userId, because resolving one
  // subject's payout against another subject's centre is how money reaches the
  // wrong person.
  if (principal.kind !== 'center' || !principal.centerId) {
    return refuse('payout_request_invalid', 'collectionPayout.request.principalInvalid', {
      principalKind: principal.kind,
      hasCenterId: Boolean(principal.centerId),
      note: 'Payout System 1 pays CENTRES. Teacher settlement is System 2 and is explicitly out of scope (PAYOUT-SYSTEM-SPEC.md §9).',
    });
  }

  // Gate 1 — the config point. Placeholders ⇒ refuse, before anything else, and
  // this is the gate that fires on every deployment today.
  const cfg = await loadCollectionPayoutConfig(supabaseAdmin);
  if (!cfg.configured) {
    return refuse(
      'collection_payout_not_configured',
      'collectionPayout.cause.collection_payout_not_configured',
      refusalBody(cfg),
    );
  }

  // Gate 2 — verification. VERIFICATION-SPEC.md §6: withdrawals are gated.
  const verification = await resolvePrincipalVerification(supabaseAdmin, principal);
  if (!verification.verified) {
    return refuse('principal_not_verified', verification.messageKey, verificationRefusalBody(verification));
  }
  // Two independent authorities must both say yes, matching ./verificationGate.ts.
  // They cannot currently disagree; requiring both is what keeps a future change
  // to either one from silently opening the gate on the MONEY-OUT path.
  if (!capabilitiesFor('verified').withdrawals) {
    return refuse('principal_not_verified', 'collectionPayout.verification.notVerified', {
      note: 'The capability table does not grant withdrawals to a verified principal. Refusing rather than reconciling the disagreement in favour of paying.',
    });
  }

  // Gate 3 — somewhere to pay. Accruing an obligation with no exit is a trap.
  const destination = await centreHasPayoutDestination(supabaseAdmin, principal.centerId);
  if (!destination.present) {
    return refuse(
      'payout_destination_missing',
      'collectionPayout.request.payoutDestinationMissing',
      { checked: destination.checked },
    );
  }

  // Gate 4 — the balance, and ONLY when the figure is real.
  //
  // `getAvailableBalanceMinor` returns an UNSOURCED ZERO while the ledger is
  // unmigrated: zero meaning UNKNOWN, not zero meaning EMPTY. Comparing against
  // it would refuse every request with `insufficient_available` — a true refusal
  // wearing a false reason, blaming the owner for an unapplied migration they
  // cannot act on. So an unsourced balance SKIPS this gate and falls through to
  // the engine, which names `ledger_not_migrated`. The authoritative check is in
  // any case the one inside the RPC, under the per-centre advisory lock, on the
  // locked row (attack A3: two submissions 40ms apart each read the same
  // balance).
  const balance = await getAvailableBalanceMinor(supabaseAdmin, principal.centerId);
  if (balance.sourced && balance.availableMinor < amountMinor) {
    return refuse('insufficient_available', 'collectionPayout.request.insufficientAvailable', {
      availableMinor: balance.availableMinor,
      requestedMinor: amountMinor,
      note: 'Advisory only. The binding check runs inside payout_request_create under the per-centre advisory lock.',
    });
  }

  return { ok: true, availableMinor: balance.sourced ? balance.availableMinor : null };
}

export type PayoutRequestResult = CreatePayoutOk | RequestRefusal;

/**
 * Request a payout.
 *
 * Gate order, and why step-up is LAST:
 *   1–4  ./evaluatePayoutRequestEligibility — deployment truths and tenant state.
 *   5    step-up auth (Decision 1: owner-only PLUS step-up).
 *   6    `payout_request_create` — ONE transaction: the per-centre advisory
 *        lock, the balance read FOR UPDATE, the hold posting, the
 *        `center_payouts` row, and the `audit_log` row, all committing together
 *        so that if the log fails the payout fails (§7.4). Idempotent re-call
 *        returns the SAME payout, never a second one.
 *
 * The engine's refusals are re-labelled into this module's vocabulary rather
 * than passed through, so a caller keying on `cause` sees one vocabulary for the
 * whole front door instead of two that overlap.
 */
export async function submitPayoutRequest(
  supabaseAdmin: SupabaseClient,
  input: PayoutRequestInput,
): Promise<PayoutRequestResult> {
  const eligibility = await evaluatePayoutRequestEligibility(
    supabaseAdmin,
    input.principal,
    input.amountMinor,
  );
  if (!eligibility.ok) return eligibility;

  if (!input.stepUpVerified) {
    return refuse('step_up_auth_required', 'collectionPayout.request.stepUpRequired', {
      mechanism: 'verifyPasswordForSensitiveAction',
      note: 'PAYOUT-SYSTEM-SPEC.md Decision 1: the unified payout path is owner-only PLUS step-up auth. Nothing was requested.',
    });
  }

  const created = await createPayoutRequest(supabaseAdmin, {
    // Non-null by gate 0 in the eligibility pass above.
    centerId: input.principal.centerId as string,
    requestedGrossMinor: input.amountMinor,
    source: input.source,
    rail: REQUEST_RAIL,
    requestedByUserId: input.principal.userId,
    idempotencyKey: input.idempotencyKey,
  });

  if (!created.ok) return translateEngineRefusal(created);
  return created;
}

/**
 * Map an `EngineRefusal` onto this module's causes.
 *
 * `collection_payout_not_configured` is unreachable here — gate 1 already
 * refused it — but it is mapped rather than defaulted, because a cause that
 * silently becomes `engine_error` is a cause nobody can act on.
 */
function translateEngineRefusal(r: EngineRefusal): RequestRefusal {
  switch (r.cause) {
    case 'collection_payout_not_configured':
      return refuse(
        'collection_payout_not_configured',
        'collectionPayout.cause.collection_payout_not_configured',
        r.detail,
      );
    case 'ledger_not_migrated':
      return refuse('ledger_not_migrated', 'collectionPayout.cause.ledger_not_migrated', r.detail);
    default:
      return refuse('engine_error', r.messageKey, { engineCause: r.cause, ...r.detail });
  }
}

/**
 * HTTP status for a refusal.
 *
 * 409 is the default and the important one: the request was well-formed and the
 * caller is authorised — the SYSTEM is not ready. A 500 would read as a bug to
 * retry and a 200 would be the fake success this whole phase exists to remove.
 */
export function statusForRequestRefusal(cause: RequestRefusalCause): number {
  switch (cause) {
    case 'not_owner':
    case 'step_up_auth_required':
      return 403;
    case 'payout_request_invalid':
      return 400;
    case 'insufficient_available':
      return 422;
    default:
      return 409;
  }
}
