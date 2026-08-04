// src/lib/collectionPayout/payoutEngine.ts
//
// The orchestration layer for payout System 1. Everything that MOVES MONEY goes
// through exactly one `SECURITY DEFINER` RPC per operation; this module never
// performs a multi-step money mutation itself.
//
// ── WHY, IN ONE PARAGRAPH (PAYOUT-SYSTEM-SPEC.md §2.2) ───────────────────────
//
// The existing `PATCH /api/admin/withdrawals/[id]` performs four separate
// un-transacted round trips: a non-locking `.select`, a `status !== 'pending'`
// check, `cancel_reservation_atomic`, `spend_credits_atomic`, then
// `.update({status:'paid'})`. Two admins working the queue at once — or ONE
// OPERATOR DOUBLE-CLICKING — both pass the status check, both proceed, and BOTH
// return `{success:true}` and BOTH fire the "withdrawal processed" WhatsApp. A
// zero-row UPDATE returns no error from PostgREST, so the loser is
// indistinguishable from the winner. On the other branch, if
// `spend_credits_atomic` raises after `cancel_reservation_atomic` already
// released the reservation, the centre's full balance is restored and
// immediately re-withdrawable WHILE THE CASH HAS ALREADY BEEN SENT.
//
// This module does not reproduce that shape. Every operation below is:
//   ONE transaction · a locking read (`SELECT … FOR UPDATE` plus
//   `pg_advisory_xact_lock` per centre) · idempotent on re-call via a caller
//   supplied `idempotency_key` · an `audit_log` row written INSIDE the same
//   transaction so that if the log fails, the payout fails.
//
// ── WHY THE RPCS DO NOT EXIST YET, AND WHAT HAPPENS ──────────────────────────
//
// LIVE FACT, verified 2026-08-04 (project lczmjpnbuhnsislcvzar, pg_proc): the
// only payout-adjacent functions in `public` are `reserve_credits_atomic`,
// `cancel_reservation_atomic`, `spend_credits_atomic`, `earn_credits_atomic`
// (all prosecdef) and `enforce_payout_status_transition` (a trigger fn on
// `commission_payouts`, the internal STAFF commission system — a different
// thing entirely). THERE IS NO PAYOUT-APPROVAL RPC. There is no
// `center_payouts` table, no `ledger_*` table, no `payout_provider_events`.
//
// They are PROPOSED, NOT APPLIED, in
//   supabase/migrations/20260804150000_PROPOSAL_payout_system_1_ledger.sql
// whose header says "NOT APPLIED — Eyad applies this by hand".
//
// So every call below currently fails at the database with "function does not
// exist" / "relation does not exist". This module CATCHES that specific class
// and converts it into a NAMED, LEGIBLE refusal (`ledger_not_migrated`) rather
// than a 500 with a Postgres string in it. It never swallows it into a success.

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCollectionPayoutConfig, refusalBody } from './config';
import { describeWaiting } from './payoutAging';
import {
  type ApproverFacts,
  type AuthoritySource,
  evaluateCaps,
  resolveApproverTier,
} from './payoutCaps';
import { type PayoutState } from './payoutStates';

// ── Named failure causes ────────────────────────────────────────────────────

export type EngineCause =
  | 'collection_payout_not_configured'
  | 'ledger_not_migrated'
  | 'approver_refused'
  | 'cap_refused'
  | 'payout_not_found'
  | 'illegal_transition'
  | 'rail_cannot_release'
  | 'step_up_auth_required'
  | 'engine_error';

export interface EngineRefusal {
  ok: false;
  cause: EngineCause;
  messageKey: string;
  /** Everything a reader needs to know why, without opening the source. */
  detail: Record<string, unknown>;
}

export function refusal(
  cause: EngineCause,
  detail: Record<string, unknown> = {},
): EngineRefusal {
  return { ok: false, cause, messageKey: `collectionPayout.cause.${cause}`, detail };
}

/**
 * PostgREST / Postgres signals for "the proposed migration has not been applied".
 *   42883 undefined_function · 42P01 undefined_table · PGRST202 no such RPC
 *   PGRST205 no such table in schema cache
 */
const NOT_MIGRATED_CODES = new Set(['42883', '42P01', 'PGRST202', 'PGRST205']);

export function isNotMigrated(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  if (err.code && NOT_MIGRATED_CODES.has(err.code)) return true;
  const m = (err.message ?? '').toLowerCase();
  return (
    m.includes('does not exist') ||
    m.includes('could not find the function') ||
    m.includes('could not find the table')
  );
}

const MIGRATION_FILE =
  'supabase/migrations/20260804150000_PROPOSAL_payout_system_1_ledger.sql';

/**
 * Every RPC in the proposal is `RETURNS TABLE (...)`, which is SET-RETURNING —
 * PostgREST hands those back as an ARRAY, not as an object. Reading `data.id`
 * off an array yields `undefined` silently, which would look like "the RPC
 * returned nothing" and send the caller down the wrong branch. This normalises
 * the two shapes so a later change from TABLE to a composite type cannot break
 * the caller either.
 */
function firstRow<T>(data: unknown): T | null {
  if (data == null) return null;
  if (Array.isArray(data)) return (data.length > 0 ? (data[0] as T) : null);
  return data as T;
}

function notMigrated(op: string): EngineRefusal {
  return refusal('ledger_not_migrated', {
    operation: op,
    migrationProposal: MIGRATION_FILE,
    appliedBy: 'Eyad, by hand. Migrations are never auto-applied to production.',
    note:
      'The payout ledger, center_payouts, payout_provider_events, the approval log and the transition RPCs are a PROPOSAL. Until the migration is applied by hand and the objects are confirmed present in the live catalog, no payout can be created, approved or released.',
  });
}

// ── Balance, honestly ───────────────────────────────────────────────────────

export interface AvailableBalance {
  /** Piastres. Zero when unsourced. */
  availableMinor: number;
  /**
   * FALSE means the number is a placeholder zero, not a computed zero. A surface
   * MUST render the reason rather than a bare "0 EGP available", or it is
   * fabricating a balance.
   */
  sourced: boolean;
  reasonKey?: string;
  reasonDetail?: string;
}

const UNSOURCED_ZERO: AvailableBalance = {
  availableMinor: 0,
  sourced: false,
  reasonKey: 'collectionPayout.balance.notSourced',
  reasonDetail:
    'The double-entry ledger does not exist in the live catalog, so there is no source for an available balance. This reads zero because it is unknown, not because it is empty.',
};

/**
 * available_minor(center).
 *
 * §4 writes the figure as `SUM(payable) − SUM(open holds) − SUM(reserve_withheld)
 * − SUM(clawback_receivable)`. That is the right ANSWER but the wrong ARITHMETIC
 * for double entry: a hold DEBITS payable and CREDITS reserve_withheld in one
 * balanced transaction, so subtracting reserve_withheld again takes the same
 * amount off twice. The RPC therefore sums the signed entries on `payable`
 * alone, which already carries every deduction. The divergence and the check
 * that proves it are documented at the function in the migration proposal.
 *
 * Returns an UNSOURCED ZERO while the ledger is unmigrated. It never falls back
 * to `centers.credit_balance` — that column is the OTHER authority, and reading
 * it here would recreate the dual-authority window that attack A5 exploits
 * (the ledger holds the credits, the monthly billing run spends the same credits
 * via `spend_credits_atomic`, and the payout then releases the cash).
 */
export async function getAvailableBalanceMinor(
  supabaseAdmin: SupabaseClient,
  centerId: string,
): Promise<AvailableBalance> {
  try {
    const { data, error } = await supabaseAdmin.rpc('payout_available_minor', {
      p_center_id: centerId,
    });
    if (error) {
      if (isNotMigrated(error)) return UNSOURCED_ZERO;
      return {
        ...UNSOURCED_ZERO,
        reasonDetail: `Ledger read failed: ${error.message}`,
      };
    }
    const n = Number(data);
    if (!Number.isSafeInteger(n) || n < 0) return UNSOURCED_ZERO;
    return { availableMinor: n, sourced: true };
  } catch {
    return UNSOURCED_ZERO;
  }
}

// ── Create a payout request ─────────────────────────────────────────────────

export interface CreatePayoutInput {
  centerId: string;
  /** Requested GROSS in piastres. The figure the caps are compared against. */
  requestedGrossMinor: number;
  /** 'referral_earnings' | 'credit_balance' — what accrued the balance. */
  source: 'referral_earnings' | 'credit_balance';
  /** 'paymob_payouts' | 'manual_instapay'. Determines the counter-account. */
  rail: 'paymob_payouts' | 'manual_instapay';
  /** Server-derived. Never from a request body. */
  requestedByUserId: string;
  /** Caller-supplied, stable across retries of the SAME logical request. */
  idempotencyKey: string;
}

export interface CreatePayoutOk {
  ok: true;
  payoutId: string;
  state: PayoutState;
  /** Honest ageing from the moment it is created. */
  waiting: ReturnType<typeof describeWaiting>;
}

/**
 * Create a payout request.
 *
 * ONE transaction inside `payout_request_create`:
 *   pg_advisory_xact_lock(hashtext('payout:'||center_id))   ← §3 invariant 4
 *   SELECT the payable balance FOR UPDATE
 *   INSERT the hold posting + the ledger transaction + entries
 *   INSERT center_payouts (state 'requested')
 *   INSERT audit_log
 * The `one_open_payout_per_center` partial unique index is the backstop for
 * attack A3 (two submissions 40ms apart each reading the same balance).
 *
 * The counter-account is derived from `rail` INSIDE the RPC, never passed by the
 * caller — §3 invariant 5. Passing it would let a hand-sent InstaPay post
 * against `paymob_budget` and drift the float model (attack A6).
 */
export async function createPayoutRequest(
  supabaseAdmin: SupabaseClient,
  input: CreatePayoutInput,
): Promise<CreatePayoutOk | EngineRefusal> {
  const cfg = await loadCollectionPayoutConfig(supabaseAdmin);
  if (!cfg.configured) {
    return refusal('collection_payout_not_configured', refusalBody(cfg));
  }
  try {
    const { data, error } = await supabaseAdmin.rpc('payout_request_create', {
      p_center_id: input.centerId,
      p_requested_gross_minor: input.requestedGrossMinor,
      p_source: input.source,
      p_rail: input.rail,
      p_requested_by: input.requestedByUserId,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) {
      if (isNotMigrated(error)) return notMigrated('payout_request_create');
      return refusal('engine_error', { operation: 'payout_request_create', message: error.message });
    }
    const row = firstRow<{ payout_id: string; status: PayoutState; requested_at: string }>(data);
    if (!row?.payout_id) {
      return refusal('engine_error', { operation: 'payout_request_create', message: 'empty result' });
    }
    return {
      ok: true,
      payoutId: row.payout_id,
      state: row.status,
      waiting: describeWaiting(row.requested_at),
    };
  } catch (e) {
    return refusal('engine_error', {
      operation: 'payout_request_create',
      message: e instanceof Error ? e.message : 'unknown',
    });
  }
}

// ── Approve ─────────────────────────────────────────────────────────────────

export interface ApprovePayoutInput {
  payoutId: string;
  approver: ApproverFacts;
  /**
   * Whether step-up auth (`verifyPasswordForSensitiveAction`) has ALREADY
   * succeeded for this request. §7: "Step-up auth on approval, reusing
   * verifyPasswordForSensitiveAction — the mechanism already exists and is
   * already used for permission edits. Do not invent a new one."
   */
  stepUpVerified: boolean;
  isResend: boolean;
  idempotencyKey: string;
}

export interface ApprovePayoutOk {
  ok: true;
  payoutId: string;
  state: PayoutState;
  tier: 'ceo' | 'delegate';
  authoritySource: AuthoritySource;
  amountComparedMinor: number;
  /** The cap in force AT APPROVAL, snapshotted onto the row. §7.3 item 3. */
  capInForceMinor: number;
}

/**
 * Approve a payout.
 *
 * The tier and cap checks below are a PRE-CHECK for a legible error. The RPC
 * re-evaluates ALL of them in-transaction under the per-centre advisory lock,
 * reading the amount FROM THE LOCKED ROW rather than from a parameter, resolving
 * the actor's tier server-side and reading the cap in-transaction. §7.1.
 *
 * §7.3 item 2 is handled inside the RPC too: authority and cap are re-evaluated
 * at EVERY transition that can still move money, and revoking
 * `can_approve_payouts` sweeps that actor's approved-but-unsubmitted payouts
 * back to `requested`. Without that, a manager approves eight payouts, the CEO
 * revokes two hours later believing the exposure is closed, and the release job
 * pays all of them two days on.
 */
export async function approvePayout(
  supabaseAdmin: SupabaseClient,
  input: ApprovePayoutInput,
): Promise<ApprovePayoutOk | EngineRefusal> {
  const cfg = await loadCollectionPayoutConfig(supabaseAdmin);
  if (!cfg.configured) {
    return refusal('collection_payout_not_configured', refusalBody(cfg));
  }

  const resolved = resolveApproverTier(input.approver);
  if (resolved.tier === 'none') {
    return refusal('approver_refused', {
      cause: resolved.cause,
      messageKey: resolved.messageKey,
      note:
        'Payout approval requires a real admin_users row. SUPER_ADMIN_PHONES alone is refused: that path mints a CEO with no database row and is forensically anonymous (PAYOUT-SYSTEM-SPEC.md §7.5, logged as S10).',
    });
  }

  if (!input.stepUpVerified) {
    return refusal('step_up_auth_required', {
      mechanism: 'verifyPasswordForSensitiveAction',
      note: 'Single-signature approval makes confirming the human at the keyboard more important, not less.',
    });
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('payout_approve', {
      p_payout_id: input.payoutId,
      p_approver_admin_user_id: resolved.adminUserId,
      p_authority_source: resolved.authoritySource,
      p_is_resend: input.isResend,
      p_step_up_verified: input.stepUpVerified,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) {
      if (isNotMigrated(error)) return notMigrated('payout_approve');
      // The RPC raises with a named SQLSTATE-carried cause for cap refusals so
      // the message is the same string the pre-check would have produced.
      return refusal('cap_refused', { operation: 'payout_approve', message: error.message });
    }
    const row = firstRow<{
      payout_id: string;
      status: PayoutState;
      amount_compared_minor: number;
      cap_in_force_minor: number;
    }>(data);
    if (!row?.payout_id) {
      return refusal('engine_error', { operation: 'payout_approve', message: 'empty result' });
    }
    return {
      ok: true,
      payoutId: row.payout_id,
      state: row.status,
      tier: resolved.tier,
      authoritySource: resolved.authoritySource,
      amountComparedMinor: row.amount_compared_minor,
      capInForceMinor: row.cap_in_force_minor,
    };
  } catch (e) {
    return refusal('engine_error', {
      operation: 'payout_approve',
      message: e instanceof Error ? e.message : 'unknown',
    });
  }
}

/**
 * Pre-check the caps without touching the database, so an admin queue can show
 * "this one needs the CEO" before anyone clicks. Advisory only.
 */
export function precheckCaps(args: {
  approver: ApproverFacts;
  requestedGrossMinor: number;
  perPayoutCapMinor: number;
  windowCapMinor: number;
  windowApprovedMinor: number;
  isResend: boolean;
}) {
  const resolved = resolveApproverTier(args.approver);
  return evaluateCaps({
    tier: resolved.tier,
    requestedGrossMinor: args.requestedGrossMinor,
    perPayoutCapMinor: args.perPayoutCapMinor,
    windowCapMinor: args.windowCapMinor,
    windowApprovedMinor: args.windowApprovedMinor,
    isResend: args.isResend,
  });
}

// ── Release ─────────────────────────────────────────────────────────────────

export interface ReleasePayoutInput {
  payoutId: string;
  releasedByAdminUserId: string;
  idempotencyKey: string;
}

/**
 * Release an approved payout onto the rail.
 *
 * This CANNOT succeed today and must not pretend to. Two independent blocks:
 *   1. THE CONFIG POINT holds placeholders, so there are no rail credentials.
 *   2. THE LEDGER IS NOT MIGRATED, so there is no `center_payouts` row to move.
 *
 * When the credentials do arrive, the release path must still obey §6:
 *   - a timeout or error leaves the payout `indeterminate` and it is NEVER
 *     auto-retried — the provider has NO idempotency key of any kind, so a
 *     retried disburse is processed as an entirely new transaction;
 *   - a resend requires POSITIVE evidence of absence, from an inquiry issued
 *     with the `bank_transactions` flag BOTH true and false (the provider's own
 *     docs classify `bank_wallet` both ways), and only when both return zero;
 *   - an unrecognised response code is NEVER terminal.
 */
export async function releasePayout(
  supabaseAdmin: SupabaseClient,
  input: ReleasePayoutInput,
): Promise<{ ok: true; payoutId: string; state: PayoutState } | EngineRefusal> {
  const cfg = await loadCollectionPayoutConfig(supabaseAdmin);
  if (!cfg.configured) {
    return refusal('rail_cannot_release', {
      ...refusalBody(cfg),
      note:
        'Release moves real money onto an irrevocable rail. With the config point holding placeholders there is nothing to release onto, and this refuses rather than marking the payout paid.',
    });
  }
  try {
    const { data, error } = await supabaseAdmin.rpc('payout_transition', {
      p_payout_id: input.payoutId,
      p_to_status: 'submitting',
      p_actor_admin_user_id: input.releasedByAdminUserId,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) {
      if (isNotMigrated(error)) return notMigrated('payout_transition');
      return refusal('illegal_transition', { operation: 'payout_transition', message: error.message });
    }
    const row = firstRow<{ payout_id: string; status: PayoutState }>(data);
    if (!row?.payout_id) {
      return refusal('engine_error', { operation: 'payout_transition', message: 'empty result' });
    }
    return { ok: true, payoutId: row.payout_id, state: row.status };
  } catch (e) {
    return refusal('engine_error', {
      operation: 'payout_transition',
      message: e instanceof Error ? e.message : 'unknown',
    });
  }
}
