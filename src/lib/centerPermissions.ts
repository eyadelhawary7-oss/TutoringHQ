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
 */
export function hasPermission(
  auth: CenterAuthContext,
  permission: CenterPermission,
): boolean {
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
  return Response.json(
    {
      error: 'permission_required',
      permission,
      message: `Missing permission: ${permission}`,
    },
    { status: 403 },
  );
}
