import type { CenterAuthContext } from './centerAuth';

export type CenterPermission =
  | 'can_record_payments'
  | 'can_view_payments'
  | 'can_manage_billing'
  | 'can_edit_center_profile'
  | 'can_delete_students'
  | 'can_manage_academic_calendar'
  | 'can_place_card_orders'
  | 'can_request_referral_payouts';

/**
 * Permissions that may authorise a centre to **REQUEST** money movement and may
 * **never** authorise its approval or release.
 *
 * PAYOUT-SYSTEM-SPEC.md §2.7 / Decision 1: `can_request_referral_payouts` is
 * request-only. Release authority is platform-side (`admin_users`) and is a
 * different, not-yet-built permission (`can_approve_payouts`, §7.1) which must
 * never live on `public.users` — the staff-permissions route
 * (`PATCH /api/settings/staff/[userId]/permissions`) is owner-gated with no
 * self-target check, so any release flag on `public.users` is self-grantable by
 * the payee.
 *
 * This list is the machine-readable form of that rule. `hasPermission` and
 * `requirePermission` THROW when handed a member of it, so the exact mistake the
 * spec warns about — a future release path reaching for the familiar
 * `requirePermission(auth, 'can_request_referral_payouts')` — fails loudly on the
 * first call in every environment instead of silently granting.
 */
export const REQUEST_ONLY_MONEY_PERMISSIONS = ['can_request_referral_payouts'] as const;

export type RequestOnlyMoneyPermission = (typeof REQUEST_ONLY_MONEY_PERMISSIONS)[number];

/**
 * Every permission that is NOT request-only. A release/approval path typed
 * against this cannot even be handed a request-only permission — it is a
 * compile-time error, backed by the runtime throw below for JS callers and
 * `as any` escapes.
 */
export type ReleaseAuthorityPermission = Exclude<CenterPermission, RequestOnlyMoneyPermission>;

export function isRequestOnlyMoneyPermission(
  permission: string,
): permission is RequestOnlyMoneyPermission {
  return (REQUEST_ONLY_MONEY_PERMISSIONS as readonly string[]).includes(permission);
}

/**
 * Hard assertion: the given permission may not be used to authorise the
 * approval/release side of a money movement. Call this at the top of any future
 * payout approval / release / disbursement path.
 *
 * This is deliberately a throw and not a 403: reaching it means a code path was
 * wired to the wrong authority source, which is a programming error, not a user
 * error. Fail closed and loud.
 */
export function assertNotReleaseAuthority(permission: string): void {
  if (isRequestOnlyMoneyPermission(permission)) {
    throw new Error(
      `[centerPermissions] '${permission}' is REQUEST-ONLY and can never authorise ` +
        'payout approval or release (PAYOUT-SYSTEM-SPEC.md §2.7, Decision 1). ' +
        'Release authority is platform-side (admin_users), never public.users.',
    );
  }
}

/**
 * Centre-bound staff roles that can legitimately hold a delegated permission.
 *
 * Verified against the live catalog on 2026-08-04 — `public.users_center_check`:
 *   CHECK ((role = ANY ('{owner,admin,assistant}') AND center_id IS NOT NULL)
 *       OR (role = ANY ('{super_admin,teacher}')  AND center_id IS NULL))
 *
 * So `teacher` and `super_admin` rows are centre-LESS by database constraint and
 * are therefore never centre staff, however they reached a centre context
 * (a teacher reaches one via `?center_id=` + `teacher_center` membership).
 * `owner` is handled by its own arm below.
 */
const DELEGABLE_CENTER_STAFF_ROLES: readonly string[] = ['admin', 'assistant'];

/**
 * Returns true when the authenticated user holds the given permission.
 *
 * Owners and super-admins always pass regardless of individual flag values
 * (defense-in-depth - even if a flag was somehow set false on an owner, the
 * route still works). Assistants pass only when the specific flag is TRUE.
 *
 * Super-admin is tested via the strict `auth.isSuperAdmin` flag (admin_users +
 * `SUPER_ADMIN_PHONES`), NOT via `auth.role === 'super_admin'` - `auth.role`
 * carries `public.users.role`, which is centre-tenant-writable and was the
 * source of a prior privilege-escalation P0.
 *
 * NOT for money-movement requests. Use `requireMoneyRequestPermission` for
 * those; this function throws on a request-only money permission.
 */
export function hasPermission(
  auth: CenterAuthContext,
  permission: CenterPermission,
): boolean {
  assertNotReleaseAuthority(permission);
  if (auth.isSuperAdmin) return true;
  if (auth.role === 'owner') return true;
  return auth.permissions[permission] === true;
}

/**
 * Returns null when the user is permitted, or a 403 JSON Response otherwise.
 * Designed to be used as an early-return guard at the top of a route handler:
 *
 *   const denied = requirePermission(auth, 'can_manage_billing');
 *   if (denied) return denied;
 */
export function requirePermission(
  auth: CenterAuthContext,
  permission: CenterPermission,
): Response | null {
  if (hasPermission(auth, permission)) return null;
  return permissionDenied(permission);
}

function permissionDenied(permission: string): Response {
  return Response.json(
    {
      error: 'permission_required',
      permission,
      message: `Missing permission: ${permission}`,
    },
    { status: 403 },
  );
}

/**
 * Authorization gate for a route that INITIATES money leaving a centre.
 *
 * PAYOUT-SYSTEM-SPEC.md §2.7. The two payout-initiating routes were asymmetric:
 * `POST /api/billing/withdrawal` is owner-only (`auth.role !== 'owner'` → 403),
 * while `POST /api/referrals/payout` gated on the delegable staff permission
 * alone via `requirePermission`, which also passes on `auth.isSuperAdmin`.
 *
 * Eyad has NOT decided the unification (Decision 1), so the pipelines stay
 * separate. What this gate does is make the weaker route no weaker than the
 * stronger one, which needs no decision because it only ever removes access:
 *
 *   pass  ⇔  role === 'owner'                                  (the owner arm —
 *                                                               identical to the
 *                                                               withdrawal route)
 *         ∨  (role ∈ {admin, assistant} ∧ flag === true)       (explicit, live,
 *                                                               owner-granted
 *                                                               delegation)
 *
 * Three arms that `requirePermission` allowed are closed here:
 *
 *  1. **`isSuperAdmin` alone.** A platform super-admin with no `public.users`
 *     row has ZERO_PERMISSIONS and is not an owner, yet short-circuited every
 *     gate. `/api/billing/withdrawal` already rejects them (their `auth.role` is
 *     `'super_admin'`, not `'owner'`). Verified live 2026-08-04: 2 `admin_users`
 *     rows exist and 0 of them have a `public.users` row, and no admin/CEO
 *     surface calls this route — the only caller in `src/` is the centre-side
 *     `ReferralWithdrawalPanel.tsx`. §7.5: an entry in `SUPER_ADMIN_PHONES` mints
 *     a super-admin with no database row at all, so this arm was a forensically
 *     anonymous path to initiating a payout.
 *  2. **Centre-less roles holding the flag.** `teacher` and `super_admin` rows
 *     have `center_id IS NULL` by the live `users_center_check` constraint, so
 *     they are never centre staff and a flag on such a row is not a delegation.
 *  3. **An owner-role flag standing in for the owner arm.** Not a widening, but
 *     the arms are now explicit so the log of who may request is readable.
 *
 * Behaviour for the one live holder is preserved exactly: verified live
 * 2026-08-04, `can_request_referral_payouts = true` on exactly 1 of 4
 * `public.users` rows, and that row's role is `owner`, so it passes on the owner
 * arm with or without this change.
 */
export function hasMoneyRequestAuthority(
  auth: CenterAuthContext,
  permission: RequestOnlyMoneyPermission,
): boolean {
  if (auth.role === 'owner') return true;
  if (!DELEGABLE_CENTER_STAFF_ROLES.includes(auth.role)) return false;
  return auth.permissions[permission] === true;
}

/**
 * Early-return guard form of `hasMoneyRequestAuthority`. Returns null when the
 * caller may initiate the payout request, or a 403 JSON Response otherwise.
 */
export function requireMoneyRequestPermission(
  auth: CenterAuthContext,
  permission: RequestOnlyMoneyPermission,
): Response | null {
  if (hasMoneyRequestAuthority(auth, permission)) return null;
  return permissionDenied(permission);
}
