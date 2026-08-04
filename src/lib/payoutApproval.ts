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

/**
 * Longest rejection reason we store.
 *
 * Over-length is REFUSED with 400. It is never truncated. A rejection reason is
 * the only free-text record of why a money request was denied, and the RPC
 * writes it into `audit_log.details.reason` in the same transaction as the
 * state change. Silently keeping the first 500 characters would put a sentence
 * that stops mid-clause into the permanent record while reporting success to
 * the operator who wrote it — the audit trail would be wrong and nobody would
 * know. Making the operator shorten it themselves is the cheaper failure.
 */
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

export type RejectionReasonResult =
  /** Usable as-is. `reason` is null when nothing meaningful was supplied. */
  | { ok: true; reason: string | null }
  /** Longer than we will store. The caller must 400; see the constant above. */
  | { ok: false; code: 'reason_too_long'; length: number; max: number };

/**
 * Trim, treat blank as absent, and refuse anything still longer than
 * `PAYOUT_REJECTION_REASON_MAX`. Length is measured on the trimmed string,
 * because that is the string that would be stored.
 */
export function normalizeRejectionReason(value: unknown): RejectionReasonResult {
  if (typeof value !== 'string') return { ok: true, reason: null };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, reason: null };
  if (trimmed.length > PAYOUT_REJECTION_REASON_MAX) {
    return {
      ok: false,
      code: 'reason_too_long',
      length: trimmed.length,
      max: PAYOUT_REJECTION_REASON_MAX,
    };
  }
  return { ok: true, reason: trimmed };
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
 * THIS PREDICATE IS DELIBERATELY NARROW, and the narrowing matters more than
 * the recognition. Once the migration IS applied, `transition_payout_request`
 * has a body that reads five tables. Unrelated schema drift inside that body —
 * a renamed `referral_reward_records.reward_amount`, say — also raises bare
 * 42703. An earlier version returned true on the SQLSTATE alone, so that fault
 * would have surfaced as a 503 telling the operator to apply a migration
 * already sitting in the catalog. They would have applied it (a no-op),
 * retried, got the same 503, and never seen the real breakage — in a path that
 * releases money. A wrong 500 is noisy; a wrong 503 is a false explanation.
 *
 * The rule:
 *   PGRST202 alone is enough. It means PostgREST looked for the function we
 *     named and did not find it in its schema cache. It cannot be raised from
 *     inside a function body, because at that point there is no body.
 *   42883 / 42703 / PGRST204 and the no-code message form all require
 *     corroboration: ONE field of the error must both name
 *     `transition_payout_request` and say that it, specifically, is absent.
 *     Per-field matters. Concatenating message + details + hint first would
 *     let the name in a PL/pgSQL CONTEXT line corroborate a "does not exist"
 *     that was actually about a column, which is precisely the fault we are
 *     trying not to mislabel.
 *   A PL/pgSQL CONTEXT line naming the RPC is a hard VETO: it proves the
 *     function exists and was executing. Whatever broke, it is not this.
 *   Everything else is somebody else's problem, and the route returns 500.
 *
 * Note on partial applies: the migration is one BEGIN/COMMIT, so it either
 * lands whole or not at all. "Function present, decision column missing" is
 * not a state it can leave behind, which is why dropping bare 42703 costs
 * nothing real.
 */
const RPC_NAME_LOWER = PAYOUT_TRANSITION_RPC.toLowerCase();
/** "Could not find the function public.transition_payout_request(...)". */
const RPC_NOT_FOUND_RE = new RegExp(`could not find[^\\n]{0,120}${RPC_NAME_LOWER}`);
/** "function public.transition_payout_request(uuid, …) does not exist". */
const RPC_ABSENT_RE = new RegExp(`${RPC_NAME_LOWER}[^\\n]{0,120}(does not exist|not found)`);
/** The PL/pgSQL CONTEXT line, which proves the function is present and ran. */
const RPC_CONTEXT_RE = new RegExp(`pl/pgsql function[^\\n]{0,40}${RPC_NAME_LOWER}`);

export function isPayoutApprovalMigrationMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as PostgrestLikeError;
  const code = typeof e.code === 'string' ? e.code.toUpperCase() : '';

  const fields = [e.message, e.details, e.hint]
    .map((f) => (typeof f === 'string' ? f.toLowerCase() : ''))
    .filter((f) => f.trim() !== '');

  // Veto first: if the function was running, it is not missing.
  if (fields.some((f) => RPC_CONTEXT_RE.test(f))) return false;

  if (code === 'PGRST202') return true;

  // One field must say that THIS function is absent — not merely mention it
  // somewhere while a different clause says something else does not exist.
  const saysThisRpcIsAbsent = fields.some(
    (f) => RPC_NOT_FOUND_RE.test(f) || RPC_ABSENT_RE.test(f),
  );
  if (!saysThisRpcIsAbsent) return false;

  return code === '' || code === 'PGRST204' || code === '42883' || code === '42703';
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
    // The centre is already committed, across its 'approved' AND 'paid'
    // requests, for at least as much as its available referral rewards. 409:
    // the request is well-formed and the actor is authorised — the state of
    // the world refuses it.
    case 'insufficient_reward_coverage':
      return 409;
    default:
      return 500;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}
