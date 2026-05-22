/**
 * Columns on `users` that confer authority (centre role + per-permission flags)
 * and must not be writable by centre callers via the legacy /api/db proxy.
 *
 * `role` in particular: prior P0 chain — a centre owner PATCH'd their own
 * users.role = 'super_admin' via this proxy, then centerAuth elevated them and
 * `planScope` granted cross-tenant bypass. Even after centerAuth/planScope stop
 * trusting `users.role`, blocking this write removes the storage path entirely.
 * Role/permission mutations go through dedicated routes (`/api/permissions`,
 * invite acceptance, admin staff endpoints).
 */
export const USERS_PROTECTED_COLUMNS: ReadonlySet<string> = new Set([
  'role',
  'can_record_payments',
  'can_view_payments',
  'can_manage_billing',
  'can_edit_center_profile',
  'can_delete_students',
  'can_manage_academic_calendar',
  'can_place_card_orders',
  'can_request_referral_payouts',
]);

/**
 * Returns the first protected column found in `data` (object or array of objects),
 * or null if none are present.
 */
export function findProtectedUsersWrite(data: unknown): string | null {
  if (data == null) return null;
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const key of Object.keys(row as Record<string, unknown>)) {
      if (USERS_PROTECTED_COLUMNS.has(key)) return key;
    }
  }
  return null;
}
