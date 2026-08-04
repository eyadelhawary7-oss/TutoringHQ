// src/lib/collectionPayout/payoutCaps.ts
//
// Approval authority and the delegate caps. PURE — the enforcement point is the
// `payout_approve` SECURITY DEFINER RPC in the migration proposal, which
// re-evaluates all of this in-transaction under the per-centre advisory lock.
// This module exists so the same rules can be unit-tested and so the API can
// give a legible answer BEFORE attempting the RPC.
//
// ── THE DECIDED MODEL (PAYOUT-SYSTEM-SPEC.md §7, revised 3 August 2026) ──────
//
//   - The CEO approves any amount. Always final. No second approver, ever.
//   - The CEO may optionally grant a named manager the right to approve BELOW a
//     config-driven cap. Off by default, granted explicitly per person.
//   - A manager cannot approve at or above the cap. No override, no exception.
//   - The permission is CEO-grantable and CEO-revocable only.
//   - Every payout is logged immutably regardless of amount or approver.
//
// ── THE DISJOINT-DOMAIN INVARIANT (§7.1) ─────────────────────────────────────
//
// The approver identity domain (`admin_users`) and the payee identity domain
// (`public.users`) are DISJOINT BY CONSTRUCTION. No `public.users` row may ever
// hold payout approval authority.
//
// Why this is decisive and not stylistic: `PATCH /api/settings/staff/[userId]/
// permissions` is gated only on `auth.role === 'owner'` and has NO SELF-TARGET
// CHECK. So a `can_approve_payouts` COLUMN on `public.users` would be
// self-grantable by the centre owner — who is the payee. The payee would be
// granting themselves release authority over their own money, in one request,
// with the CEO never in the loop.
//
// LIVE FACT, verified 2026-08-04 (project lczmjpnbuhnsislcvzar): the
// `permissions` table has `FOREIGN KEY (user_id) REFERENCES admin_users(id) ON
// DELETE CASCADE` and `UNIQUE (user_id, permission)`. It CANNOT reference
// `public.users` at all. The invariant is therefore structurally available
// today, with 0 rows in the table.
//
// ── AUTHORITY SOURCE (§7.5, S10) ─────────────────────────────────────────────
//
// Appending a phone to `SUPER_ADMIN_PHONES` mints a CEO with NO DATABASE ROW,
// and the supposedly independent second check (`requireSuperAdminRow`) calls
// `isSuperAdminPhone` too — so both gates read the same env var. That path is
// forensically anonymous. Decided: payout approval requires a real
// `admin_users.role = 'super_admin'` ROW and MUST NOT accept env-phone alone,
// and the log records the authority source as a NOT NULL column so the
// distinction is provable after the fact rather than inferred.
//
// `resolveApproverTier` below implements exactly that: `envPhoneSuperAdmin` is
// accepted as an INPUT and then explicitly refused.

export type ApproverTier = 'ceo' | 'delegate' | 'none';

/** Recorded on every approval, NOT NULL. §7.5. */
export type AuthoritySource = 'db_row' | 'env_phone';

export const CAN_APPROVE_PAYOUTS = 'can_approve_payouts';

export interface ApproverFacts {
  /** admin_users.id. Never a public.users id — see the disjoint-domain note. */
  adminUserId: string | null;
  /** admin_users.role, read live. */
  adminRole: string | null;
  /** Enabled grants from public.permissions for this admin_users.id. */
  permissionKeys: string[];
  /**
   * Whether the session matched SUPER_ADMIN_PHONES. Passed in so the refusal is
   * explicit and logged, rather than the caller quietly not asking.
   */
  envPhoneSuperAdmin: boolean;
}

export type ApproverResolution =
  | { tier: 'ceo'; adminUserId: string; authoritySource: 'db_row' }
  | { tier: 'delegate'; adminUserId: string; authoritySource: 'db_row' }
  | { tier: 'none'; cause: ApproverRefusalCause; messageKey: string };

export type ApproverRefusalCause =
  | 'no_admin_user_row'
  | 'env_phone_authority_refused'
  | 'not_an_approver';

/**
 * Resolve an approver's tier from live facts.
 *
 * Refuses env-phone-only authority EXPLICITLY, with its own cause, so the log
 * shows that someone tried rather than showing a generic 403.
 */
export function resolveApproverTier(facts: ApproverFacts): ApproverResolution {
  if (!facts.adminUserId || !facts.adminRole) {
    // No admin_users row. If the session nevertheless looks like a super-admin,
    // that is the S10 env-phone path and it is named as such.
    if (facts.envPhoneSuperAdmin) {
      return {
        tier: 'none',
        cause: 'env_phone_authority_refused',
        messageKey: 'collectionPayout.approver.envPhoneRefused',
      };
    }
    return {
      tier: 'none',
      cause: 'no_admin_user_row',
      messageKey: 'collectionPayout.approver.noAdminRow',
    };
  }
  if (facts.adminRole === 'super_admin') {
    return { tier: 'ceo', adminUserId: facts.adminUserId, authoritySource: 'db_row' };
  }
  if (facts.permissionKeys.includes(CAN_APPROVE_PAYOUTS)) {
    return { tier: 'delegate', adminUserId: facts.adminUserId, authoritySource: 'db_row' };
  }
  return {
    tier: 'none',
    cause: 'not_an_approver',
    messageKey: 'collectionPayout.approver.notAnApprover',
  };
}

// ── The caps ────────────────────────────────────────────────────────────────

export interface CapInputs {
  tier: ApproverTier;
  /**
   * The REQUESTED GROSS in piastres, before any fee, VAT or credit-conversion
   * arithmetic. §7.2, decided: "the cap is compared against the requested gross"
   * — the permissive `net_minor` reading would have let a gross of 10,546.31
   * through a 10,000 cap.
   */
  requestedGrossMinor: number;
  /** Per-payout cap in PIASTRES. Unit is in the name. §11 implementation trap. */
  perPayoutCapMinor: number;
  /** Rolling-7-day per-centre cap in PIASTRES. */
  windowCapMinor: number;
  /**
   * Sum of approvals for THIS CENTRE inside the rolling 7-day window, in
   * piastres, EXCLUDING the payout being approved.
   *
   * "Rolling 7 days" is a MOVING WINDOW — `approved_at > now() - interval
   * '7 days'` — not `date_trunc('week', …)`. A calendar week resets at a known
   * instant and hands back a fresh cap every Monday, which is the same
   * splitting hole with a longer period.
   *
   * The window sums APPROVALS, not settlements. A payout approved and later
   * failed or returned still consumed window capacity — otherwise a delegate
   * can approve, induce a failure, and re-approve. Safe default, recorded.
   */
  windowApprovedMinor: number;
  /** True when this approval authorises a RESEND of an indeterminate payout. */
  isResend: boolean;
}

export type CapDecision =
  | { permitted: true; tier: ApproverTier; amountComparedMinor: number }
  | {
      permitted: false;
      cause: CapRefusalCause;
      messageKey: string;
      amountComparedMinor: number;
      /** What the CEO would have to do. There is no other path. §7.5. */
      escalation: 'ceo_only';
    };

export type CapRefusalCause =
  | 'not_an_approver'
  | 'over_per_payout_cap'
  | 'over_rolling_window_cap'
  | 'resend_requires_ceo';

/**
 * Evaluate both caps.
 *
 * §7.2: "The check must include the payout being approved, i.e.
 * SUM(existing in window) + this_amount > cap → deny, not SUM(existing) > cap.
 * The off-by-one here permits 19,999."
 */
export function evaluateCaps(input: CapInputs): CapDecision {
  const amountComparedMinor = input.requestedGrossMinor;

  if (input.tier === 'none') {
    return {
      permitted: false,
      cause: 'not_an_approver',
      messageKey: 'collectionPayout.cap.notAnApprover',
      amountComparedMinor,
      escalation: 'ceo_only',
    };
  }

  // A resend requires reading ambiguous provider evidence against an irrevocable
  // rail with no idempotency key. CEO-only, at any amount. §7.2 requirement 5.
  if (input.isResend && input.tier !== 'ceo') {
    return {
      permitted: false,
      cause: 'resend_requires_ceo',
      messageKey: 'collectionPayout.cap.resendRequiresCeo',
      amountComparedMinor,
      escalation: 'ceo_only',
    };
  }

  // The CEO approves any amount and is always final. The caps bound delegates.
  if (input.tier === 'ceo') {
    return { permitted: true, tier: 'ceo', amountComparedMinor };
  }

  if (amountComparedMinor >= input.perPayoutCapMinor) {
    return {
      permitted: false,
      cause: 'over_per_payout_cap',
      messageKey: 'collectionPayout.cap.overPerPayout',
      amountComparedMinor,
      escalation: 'ceo_only',
    };
  }

  if (input.windowApprovedMinor + amountComparedMinor > input.windowCapMinor) {
    return {
      permitted: false,
      cause: 'over_rolling_window_cap',
      messageKey: 'collectionPayout.cap.overRollingWindow',
      amountComparedMinor,
      escalation: 'ceo_only',
    };
  }

  return { permitted: true, tier: 'delegate', amountComparedMinor };
}

/**
 * The rolling window boundary. UTC-relative on purpose.
 *
 * §7.2: "Cairo-time boundaries are irrelevant here … the window is relative to
 * each approval, not to a day boundary." Cairo time IS used for every
 * user-visible billing/calendar window (see payoutAging.ts and
 * cairoBillingCalendar.ts); it is deliberately NOT used here.
 */
export const ROLLING_WINDOW_DAYS = 7;

export function rollingWindowStart(now: Date): Date {
  return new Date(now.getTime() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * ── RESIDUAL, RECORDED NOT REOPENED (§7.2) ───────────────────────────────────
 * Both caps are scoped PER CENTRE, so they bound each relationship but not the
 * delegate's aggregate: a manager may approve up to the cap for centre A, again
 * for centre B, and so on. With 10 active centres that is 100,000 EGP per 7 days
 * across the estate, all compliant. A per-approver ceiling would be a third
 * check of the same shape and costs nothing extra to add later; it was not
 * decided, so it is not built.
 */
export const PER_APPROVER_AGGREGATE_CAP_NOT_DECIDED = true as const;
