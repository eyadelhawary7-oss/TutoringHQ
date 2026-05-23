/**
 * Columns on `users` that confer authority (centre role + per-permission flags
 * + auth identity) and must not be writable by centre callers via the legacy
 * /api/db proxy.
 *
 * `role`: prior P0 chain , a centre owner PATCH'd their own users.role =
 * 'super_admin' via this proxy, then centerAuth elevated them and planScope
 * granted cross-tenant bypass. Even after centerAuth/planScope stop trusting
 * users.role, blocking this write removes the storage path entirely.
 *
 * `phone`: same class. isSuperAdminPhone() historically read public.users.phone,
 * which is centre-tenant-writable. A centre owner could PATCH their own
 * users.phone to a value in SUPER_ADMIN_PHONES and become super-admin on the
 * next request. Phone is also the auth identity under phone+PIN login; the
 * legitimate change path is Supabase Auth (OTP-verified) plus a dedicated
 * identity-re-verifying route, not the bulk proxy.
 *
 * Role/permission/phone mutations go through dedicated routes (/api/permissions,
 * invite acceptance, admin staff endpoints, auth OTP flows).
 */
export const USERS_PROTECTED_COLUMNS: ReadonlySet<string> = new Set([
  'role',
  'phone',
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
  return findProtectedWrite(data, USERS_PROTECTED_COLUMNS);
}

/**
 * Columns on `card_orders` that drive payment + fulfillment lifecycle and
 * cost, and must not be writable by centre callers via the legacy /api/db
 * proxy.
 *
 * The cardOrderState state machine (src/lib/cardOrderState.ts) is advisory:
 * `card_orders` is a direct TABLE_SCOPE entry, so a centre owner could PATCH
 *   - status='paid' / payment_status='paid' (skip the machine, free fulfillment)
 *   - quantity / students (10-card paid order , 100-card print run)
 *   - price_per_card / total_amount / delivery_fee (post-payment money drift)
 *   - delivery_address / delivery_phone / delivery_governorate (redirect goods)
 * directly via /api/db. These columns are only legitimately written by:
 *   - the checkout route (service-role, /api/card-order-cart/checkout)
 *   - the Paymob webhook (service-role, /api/paymob/webhook)
 *   - the card-order admin transition route (admin-gated, /api/admin/card-orders/[orderId]/transition)
 *   - the Bosta webhook (service-role, /api/bosta/webhook)
 * never by a centre request through the proxy. Grep confirms no centre code
 * uses dbInsert/dbUpdate/dbDelete on card_orders, so the gate has no false
 * positives.
 *
 * Both INSERT and UPDATE writes that touch any of these columns are rejected
 * for non-super-admin callers.
 */
export const CARD_ORDERS_PROTECTED_COLUMNS: ReadonlySet<string> = new Set([
  // Workflow state
  'status',
  'payment_status',
  'refund_status',
  // Lifecycle timestamps / reasons set by the state machine
  'cancelled_at',
  'cancellation_reason',
  // Order contents (gates how much the vendor prints)
  'quantity',
  'students',
  // Money (gates how much the centre paid)
  'price_per_card',
  'total_amount',
  'delivery_fee',
  // Fulfillment / shipping (gates where the cards go and how they're printed)
  'shipping_zone',
  'card_style',
  'delivery_address',
  'delivery_phone',
  'delivery_governorate',
  // Paymob linkage (set by the Paymob webhook only)
  'paymob_order_id',
  'paymob_transaction_id',
  // Bosta linkage (set by the Bosta webhook / admin booking route only)
  'bosta_order_id',
  'bosta_status',
  'bosta_shipment_id',
  'bosta_updated_at',
  'bosta_notes',
]);

/**
 * Returns the first protected card_orders column found in `data`, or null.
 */
export function findProtectedCardOrdersWrite(data: unknown): string | null {
  return findProtectedWrite(data, CARD_ORDERS_PROTECTED_COLUMNS);
}

function findProtectedWrite(data: unknown, protectedSet: ReadonlySet<string>): string | null {
  if (data == null) return null;
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const key of Object.keys(row as Record<string, unknown>)) {
      if (protectedSet.has(key)) return key;
    }
  }
  return null;
}
