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
 * Owners and super_admins always pass regardless of individual flag values
 * (defense-in-depth — even if a flag was somehow set false on an owner, the
 * route still works). Assistants pass only when the specific flag is TRUE.
 */
export function hasPermission(
  auth: CenterAuthContext,
  permission: CenterPermission,
): boolean {
  if (auth.role === 'owner' || auth.role === 'super_admin') return true;
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
