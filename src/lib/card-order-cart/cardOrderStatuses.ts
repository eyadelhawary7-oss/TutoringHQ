/** Status buckets for “has physical card” checks (matches evolving card_orders.status). */
export const CARD_ORDER_DELIVERED_STATUSES = new Set([
  'delivered',
  'issued',
]);

export const CARD_ORDER_PENDING_CARD_STATUSES = new Set([
  'pending_payment',
  'pending',
  'paid',
  'vendor_assigned',
  'confirmed',
  'printing',
  'processing',
  'in_production',
  'dispatched',
  'in_transit',
  'ready_for_pickup',
  'shipped',
]);
