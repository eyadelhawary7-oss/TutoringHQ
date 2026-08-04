/**
 * PAYOUT-SYSTEM-SPEC.md §2.2 — credit-withdrawal approval, decision logic.
 *
 * The transaction itself lives in the `process_withdrawal_request` SECURITY
 * DEFINER RPC (supabase/migrations/20260804160000_withdrawal_process_atomic_rpc.sql,
 * NOT APPLIED — Eyad applies it by hand). This module is the pure half: how to
 * read what the RPC returned, what HTTP status that maps to, and — the part
 * that actually stops the double-send — whether *this* caller is the one that
 * performed the transition and may therefore notify the owner.
 *
 * There is deliberately NO fallback to the old multi-round-trip path. If the
 * RPC is absent the route fails visibly with `withdrawal_rpc_missing`. A
 * fallback would silently re-open the race this exists to close.
 */

/** Name of the RPC. Must match the function created by the migration. */
export const WITHDRAWAL_PROCESS_RPC = 'process_withdrawal_request';

export type WithdrawalAction = 'mark_paid' | 'reject';

export type WithdrawalOutcome =
  /** This call performed the state change. The only outcome that may notify. */
  | 'transitioned'
  /** Already in the status this action would produce. Idempotent re-call. */
  | 'already_applied'
  /** Terminal in the *other* status. Asked to pay something already rejected. */
  | 'conflict'
  /** No such withdrawal row. */
  | 'not_found';

export interface WithdrawalRpcResult {
  outcome: WithdrawalOutcome;
  /** Status the row is in after this call. Absent for `not_found`. */
  status: string | null;
  centerId: string | null;
  creditsDeducted: number;
  cashAmount: number;
  instapayNumber: string;
  notes: string | null;
}

export class WithdrawalRpcContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WithdrawalRpcContractError';
  }
}

export function isWithdrawalAction(value: unknown): value is WithdrawalAction {
  return value === 'mark_paid' || value === 'reject';
}

const OUTCOMES: ReadonlySet<string> = new Set([
  'transitioned',
  'already_applied',
  'conflict',
  'not_found',
]);

function numberOrZero(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * Parse the jsonb the RPC returns. Throws {@link WithdrawalRpcContractError}
 * rather than guessing, because every field here feeds either a money decision
 * or a WhatsApp message: a silently-defaulted `outcome` would be a double-send.
 */
export function interpretWithdrawalRpcResult(raw: unknown): WithdrawalRpcResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new WithdrawalRpcContractError(
      `${WITHDRAWAL_PROCESS_RPC} returned a non-object result`,
    );
  }
  const r = raw as Record<string, unknown>;
  const outcome = r.outcome;
  if (typeof outcome !== 'string' || !OUTCOMES.has(outcome)) {
    throw new WithdrawalRpcContractError(
      `${WITHDRAWAL_PROCESS_RPC} returned unknown outcome ${JSON.stringify(outcome)}`,
    );
  }
  return {
    outcome: outcome as WithdrawalOutcome,
    status: stringOrNull(r.status),
    centerId: stringOrNull(r.center_id),
    creditsDeducted: numberOrZero(r.credits_deducted),
    cashAmount: numberOrZero(r.cash_amount),
    instapayNumber: typeof r.instapay_number === 'string' ? r.instapay_number.trim() : '',
    notes: stringOrNull(r.notes),
  };
}

/**
 * True when the Postgres/PostgREST error means the function does not exist —
 * i.e. the migration has not been applied yet.
 *
 * PostgREST answers `PGRST202` ("Could not find the function ... in the schema
 * cache"); a stale-cache-the-other-way call surfaces the raw Postgres
 * `42883` undefined_function. Both mean the same thing operationally.
 */
export function isMissingWithdrawalRpc(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  if (code === 'PGRST202' || code === '42883') return true;
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  if (!message) return false;
  return (
    message.includes(WITHDRAWAL_PROCESS_RPC) &&
    (message.includes('could not find the function') ||
      message.includes('does not exist') ||
      message.includes('schema cache'))
  );
}

/**
 * Only the caller that actually performed the transition sends WhatsApp.
 * The loser of a double-click gets `already_applied` and stays silent.
 */
export function shouldNotifyOwner(outcome: WithdrawalOutcome): boolean {
  return outcome === 'transitioned';
}

export interface WithdrawalHttpResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

/**
 * HTTP mapping. Note `already_applied` is a 200 with `applied:false` — the
 * work is done, the client should just refresh — while `conflict` is a 409,
 * because "pay this" against a rejected row is an operator error, not a retry.
 */
export function withdrawalHttpResult(result: WithdrawalRpcResult): WithdrawalHttpResult {
  switch (result.outcome) {
    case 'transitioned':
      return {
        httpStatus: 200,
        body: { success: true, applied: true, status: result.status },
      };
    case 'already_applied':
      return {
        httpStatus: 200,
        body: {
          success: true,
          applied: false,
          status: result.status,
          reason: 'already_processed',
        },
      };
    case 'conflict':
      return {
        httpStatus: 409,
        body: {
          error: 'Request is not pending',
          applied: false,
          status: result.status,
        },
      };
    case 'not_found':
      return {
        httpStatus: 404,
        body: { error: 'Withdrawal not found' },
      };
  }
}

/** The Arabic decision word the WhatsApp template takes as parameter 2. */
export function whatsappDecisionWord(action: WithdrawalAction): string {
  return action === 'mark_paid' ? 'قبول' : 'رفض';
}

/**
 * Which figure the owner is told about. On approval it is the cash they
 * receive; on rejection it is the credits handed back to the balance. This
 * matches what the route sent before and must not silently change — the
 * template renders it as a bare number.
 */
export function whatsappAmount(
  action: WithdrawalAction,
  result: Pick<WithdrawalRpcResult, 'cashAmount' | 'creditsDeducted'>,
): number {
  return action === 'mark_paid' ? result.cashAmount : result.creditsDeducted;
}
