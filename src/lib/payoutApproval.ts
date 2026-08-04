/**
 * Approval path for `payout_requests` — PAYOUT-SYSTEM-SPEC.md §2.1.
 *
 * The defect this closes: `payout_requests` had NO approval path whatsoever.
 * Six files referenced the table and none of them could move `status`, so a
 * referral payout request could never leave 'pending' through any code path.
 *
 * This module holds the pure, testable half of the fix: which transitions are
 * legal, which re-calls are idempotent, and how to recognise the one runtime
 * condition that must fail loudly — the migration not being applied yet.
 *
 * The impure half is `transition_payout_request()`, a SECURITY DEFINER RPC
 * proposed in
 *   supabase/migrations/20260804170000_payout_requests_approval_path.sql
 * which is the SOLE writer of approval state. The transition table below is
 * mirrored there; both are the same rules, and the RPC is authoritative because
 * it is the one holding the row lock.
 */

/**
 * Verified live in `payout_requests_status_check` on 4 August 2026:
 *   CHECK (status = ANY (ARRAY['pending','approved','paid','rejected']))
 */
export const PAYOUT_REQUEST_STATUSES = ['pending', 'approved', 'paid', 'rejected'] as const;
export type PayoutRequestStatus = (typeof PAYOUT_REQUEST_STATUSES)[number];

export const PAYOUT_APPROVAL_ACTIONS = ['approve', 'reject', 'mark_paid'] as const;
export type PayoutApprovalAction = (typeof PAYOUT_APPROVAL_ACTIONS)[number];

/** Name of the RPC proposed by the migration. The route calls nothing else. */
export const PAYOUT_TRANSITION_RPC = 'transition_payout_request';

/** Named so the 503 body can tell the operator exactly what to apply. */
export const PAYOUT_APPROVAL_MIGRATION_FILE =
  'supabase/migrations/20260804170000_payout_requests_approval_path.sql';

/** Longest rejection reason we store. Trimmed, never truncated silently. */
export const PAYOUT_REJECTION_REASON_MAX = 500;

export function isPayoutRequestStatus(value: unknown): value is PayoutRequestStatus {
  return (
    typeof value === 'string' &&
    (PAYOUT_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

export function parsePayoutApprovalAction(value: unknown): PayoutApprovalAction | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return (PAYOUT_APPROVAL_ACTIONS as readonly string[]).includes(v)
    ? (v as PayoutApprovalAction)
    : null;
}

export type PayoutTransitionPlan =
  /** A real state change: the RPC will write it under the row lock. */
  | { outcome: 'apply'; nextStatus: PayoutRequestStatus }
  /** Already in the target state — re-call is a no-op success, not an error. */
  | { outcome: 'idempotent'; status: PayoutRequestStatus }
  /** Illegal for this current status. */
  | { outcome: 'conflict'; status: PayoutRequestStatus };

/**
 * The legal transition table.
 *
 *   approve   : pending             -> approved
 *   reject    : pending | approved  -> rejected
 *   mark_paid : approved            -> paid
 *
 * `mark_paid` from 'pending' is deliberately ILLEGAL. The whole point of §2.1
 * is that a human authorises the release before it is recorded as sent; letting
 * an operator jump straight to 'paid' would re-create the missing approval step
 * with extra clicks. 'paid' is terminal in both directions — a paid referral
 * payout has left the platform on an irrevocable rail (§5) and nothing in the
 * application may quietly un-pay it.
 */
export function planPayoutTransition(
  currentStatus: string | null | undefined,
  action: PayoutApprovalAction,
): PayoutTransitionPlan {
  const status = isPayoutRequestStatus(currentStatus) ? currentStatus : null;
  if (status === null) {
    // An unrecognised status is never treated as safe to move. Defaulting to
    // "conflict" means a state added later blocks rather than falls through.
    return { outcome: 'conflict', status: 'pending' };
  }

  if (
    (action === 'approve' && status === 'approved') ||
    (action === 'reject' && status === 'rejected') ||
    (action === 'mark_paid' && status === 'paid')
  ) {
    return { outcome: 'idempotent', status };
  }

  if (action === 'approve' && status === 'pending') {
    return { outcome: 'apply', nextStatus: 'approved' };
  }
  if (action === 'reject' && (status === 'pending' || status === 'approved')) {
    return { outcome: 'apply', nextStatus: 'rejected' };
  }
  if (action === 'mark_paid' && status === 'approved') {
    return { outcome: 'apply', nextStatus: 'paid' };
  }

  return { outcome: 'conflict', status };
}

export function normalizeRejectionReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, PAYOUT_REJECTION_REASON_MAX);
}

type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

/**
 * True when the failure is "the migration has not been applied yet".
 *
 * CI has no live database, so a missing function or column passes every gate
 * (CLAUDE.md rule 2 / F26). The route therefore has to recognise this at
 * runtime and say so, rather than surfacing a generic 500 that reads like a
 * transient outage — or, worse, falling back to a non-atomic UPDATE.
 *
 * Recognised:
 *   PGRST202 — PostgREST: function not found in the schema cache (the usual one)
 *   42883    — Postgres: undefined_function
 *   42703    — Postgres: undefined_column (a partially applied migration)
 *   PGRST204 — PostgREST: column not found in the schema cache
 * plus the message forms PostgREST uses when it does not set a code.
 */
export function isPayoutApprovalMigrationMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as PostgrestLikeError;
  const code = typeof e.code === 'string' ? e.code.toUpperCase() : '';
  if (code === 'PGRST202' || code === 'PGRST204' || code === '42883' || code === '42703') {
    return true;
  }
  const haystack = `${e.message ?? ''} ${e.details ?? ''} ${e.hint ?? ''}`.toLowerCase();
  if (!haystack.trim()) return false;
  if (haystack.includes(PAYOUT_TRANSITION_RPC.toLowerCase())) {
    return (
      haystack.includes('could not find') ||
      haystack.includes('does not exist') ||
      haystack.includes('not found')
    );
  }
  return false;
}

export type PayoutTransitionRpcResult = {
  ok: boolean;
  code?: string;
  id?: string;
  status?: string;
  previous_status?: string;
  idempotent?: boolean;
  decided_at?: string;
};

export function parsePayoutTransitionRpcResult(data: unknown): PayoutTransitionRpcResult | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.ok !== 'boolean') return null;
  return {
    ok: d.ok,
    code: typeof d.code === 'string' ? d.code : undefined,
    id: typeof d.id === 'string' ? d.id : undefined,
    status: typeof d.status === 'string' ? d.status : undefined,
    previous_status: typeof d.previous_status === 'string' ? d.previous_status : undefined,
    idempotent: typeof d.idempotent === 'boolean' ? d.idempotent : undefined,
    decided_at: typeof d.decided_at === 'string' ? d.decided_at : undefined,
  };
}

/**
 * HTTP status for each refusal code the RPC can return. Anything unrecognised
 * is 500, never 200 — an unclassified response must not read as success.
 */
export function httpStatusForPayoutRefusal(code: string | undefined): number {
  switch (code) {
    case 'not_found':
      return 404;
    case 'invalid_action':
      return 400;
    case 'forbidden_actor':
      return 403;
    case 'invalid_transition':
    case 'conflict':
    case 'center_has_open_approval':
      return 409;
    default:
      return 500;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}
