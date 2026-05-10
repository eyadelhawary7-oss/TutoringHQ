/** Admin-only manual lifecycle events (POST /api/admin/card-orders/[id]/transition). */
export const ADMIN_ALLOWED_CARD_ORDER_EVENTS = [
  'vendor_assigned',
  'production_started',
  'ready_for_pickup',
  'bosta_picked_up',
  'bosta_delivered',
  'centre_confirmed_issued',
] as const;

export type AdminAllowedCardOrderEvent = (typeof ADMIN_ALLOWED_CARD_ORDER_EVENTS)[number];

export class AdminCardOrderTransitionNotAllowedError extends Error {
  readonly code = 'event_not_admin_allowed';

  constructor(public readonly event: string) {
    super(`event_not_admin_allowed:${event}`);
    this.name = 'AdminCardOrderTransitionNotAllowedError';
  }
}

export function assertAdminCardOrderTransitionEventAllowed(event: string): asserts event is AdminAllowedCardOrderEvent {
  if (!(ADMIN_ALLOWED_CARD_ORDER_EVENTS as readonly string[]).includes(event)) {
    throw new AdminCardOrderTransitionNotAllowedError(event);
  }
}
