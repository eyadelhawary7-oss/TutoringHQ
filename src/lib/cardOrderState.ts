import type { SupabaseClient } from '@supabase/supabase-js';

export type CardOrderLifecycleEvent =
  | 'cart_submitted'
  | 'paymob_succeeded'
  | 'paymob_failed'
  | 'vendor_assigned'
  | 'production_started'
  | 'ready_for_pickup'
  | 'bosta_picked_up'
  | 'bosta_delivered'
  | 'centre_confirmed_issued'
  | 'cancelled_before_payment'
  | 'cancelled_after_payment'
  | 'refund_approved'
  | 'refund_paid'
  | 'refund_rejected';

export interface ApplyTransitionContext {
  actorUserId?: string;
  actorRole?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export type ApplyCardOrderTransitionOptions = ApplyTransitionContext & {
  /** Merged into the same UPDATE as lifecycle columns (e.g. bosta_order_id). */
  extraColumns?: Record<string, unknown>;
};

export type CardOrderStateSnapshot = {
  id: string;
  status: string;
  payment_status: string;
  refund_status: string | null;
};

export class IllegalCardOrderTransitionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'IllegalCardOrderTransitionError';
  }
}

type TransitionPatch = Record<string, unknown>;

const stamp = () => new Date().toISOString();

function norm(s: string | null | undefined): string {
  return String(s ?? '').trim().toLowerCase();
}

/**
 * Pure transition builder for tests and applyCardOrderTransition.
 */
export function buildCardOrderTransitionPatch(
  row: CardOrderStateSnapshot,
  event: CardOrderLifecycleEvent,
  ctx: ApplyTransitionContext = {},
): TransitionPatch {
  const s = norm(row.status);
  const p = norm(row.payment_status);
  const r = row.refund_status != null ? norm(row.refund_status) : null;

  const reason = ctx.reason?.trim() || null;

  switch (event) {
    case 'cart_submitted':
      throw new IllegalCardOrderTransitionError(
        'Use INSERT at checkout for cart_submitted; do not call applyCardOrderTransition',
        'use_insert',
      );

    case 'paymob_succeeded': {
      if (s === 'paid' && p === 'paid') {
        return {};
      }
      /* Legacy rows: payment cleared but status still `pending` (pre — state-machine). */
      if (p === 'paid' && s === 'pending') {
        return { status: 'paid', payment_status: 'paid', refund_status: null };
      }
      if (s !== 'pending_payment') {
        throw new IllegalCardOrderTransitionError('paymob_succeeded requires pending_payment', 'bad_status');
      }
      if (p !== 'unpaid' && p !== 'pending_payment') {
        throw new IllegalCardOrderTransitionError('paymob_succeeded requires unpaid payment_status', 'bad_payment');
      }
      return {
        status: 'paid',
        payment_status: 'paid',
        refund_status: null,
      };
    }

    case 'paymob_failed': {
      if (s === 'failed' && p === 'failed') return {};
      if (s !== 'pending_payment') {
        throw new IllegalCardOrderTransitionError('paymob_failed requires pending_payment', 'bad_status');
      }
      return {
        status: 'failed',
        payment_status: 'failed',
        refund_status: null,
      };
    }

    case 'vendor_assigned': {
      if (s === 'vendor_assigned') return {};
      if (s !== 'paid') {
        throw new IllegalCardOrderTransitionError('vendor_assigned requires paid', 'bad_status');
      }
      return {
        status: 'vendor_assigned',
        payment_status: 'paid',
        refund_status: null,
      };
    }

    case 'production_started': {
      if (s === 'in_production') return {};
      if (s !== 'vendor_assigned') {
        throw new IllegalCardOrderTransitionError('production_started requires vendor_assigned', 'bad_status');
      }
      return {
        status: 'in_production',
        payment_status: 'paid',
        refund_status: null,
      };
    }

    case 'ready_for_pickup': {
      if (s === 'ready_for_pickup') return {};
      if (s !== 'in_production' && s !== 'vendor_assigned') {
        throw new IllegalCardOrderTransitionError(
          'ready_for_pickup requires in_production or vendor_assigned',
          'bad_status',
        );
      }
      return {
        status: 'ready_for_pickup',
        payment_status: 'paid',
        refund_status: null,
      };
    }

    case 'bosta_picked_up': {
      if (s === 'in_transit') return {};
      if (s !== 'ready_for_pickup' && s !== 'shipped') {
        throw new IllegalCardOrderTransitionError(
          'bosta_picked_up requires ready_for_pickup or legacy shipped',
          'bad_status',
        );
      }
      return {
        status: 'in_transit',
        payment_status: 'paid',
        refund_status: null,
      };
    }

    case 'bosta_delivered': {
      if (s === 'delivered') return {};
      if (s !== 'in_transit' && s !== 'shipped') {
        throw new IllegalCardOrderTransitionError('bosta_delivered requires in_transit or legacy shipped', 'bad_status');
      }
      return {
        status: 'delivered',
        payment_status: 'paid',
        refund_status: null,
      };
    }

    case 'centre_confirmed_issued': {
      if (s === 'issued') return {};
      if (s !== 'delivered') {
        throw new IllegalCardOrderTransitionError('centre_confirmed_issued requires delivered', 'bad_status');
      }
      return {
        status: 'issued',
        payment_status: 'paid',
        refund_status: null,
      };
    }

    case 'cancelled_before_payment': {
      if (s === 'cancelled' && (r == null || r === '')) return {};
      if (s !== 'pending_payment') {
        throw new IllegalCardOrderTransitionError('cancelled_before_payment requires pending_payment', 'bad_status');
      }
      if (!reason) {
        throw new IllegalCardOrderTransitionError('Cancellation reason required', 'reason_required');
      }
      return {
        status: 'cancelled',
        payment_status: 'unpaid',
        refund_status: null,
        cancelled_at: stamp(),
        cancellation_reason: reason,
      };
    }

    case 'cancelled_after_payment': {
      if (s === 'cancelled' && r === 'pending') return {};
      if (s !== 'paid' && s !== 'vendor_assigned') {
        throw new IllegalCardOrderTransitionError(
          'cancelled_after_payment requires paid or vendor_assigned',
          'bad_status',
        );
      }
      if (!reason) {
        throw new IllegalCardOrderTransitionError('Cancellation reason required', 'reason_required');
      }
      return {
        status: 'cancelled',
        payment_status: 'paid',
        refund_status: 'pending',
        cancelled_at: stamp(),
        refund_requested_at: stamp(),
        cancellation_reason: reason,
      };
    }

    case 'refund_approved': {
      if (r === 'approved') return {};
      if (s !== 'cancelled' || r !== 'pending') {
        throw new IllegalCardOrderTransitionError('refund_approved requires cancelled + refund pending', 'bad_refund');
      }
      return {
        status: 'cancelled',
        payment_status: 'paid',
        refund_status: 'approved',
      };
    }

    case 'refund_paid': {
      if (s === 'refunded' && r === 'paid') return {};
      if (s !== 'cancelled' || r !== 'approved') {
        throw new IllegalCardOrderTransitionError('refund_paid requires cancelled + refund approved', 'bad_refund');
      }
      return {
        status: 'refunded',
        payment_status: 'paid',
        refund_status: 'paid',
        refund_paid_at: stamp(),
      };
    }

    case 'refund_rejected': {
      if (r === 'rejected') return {};
      if (s !== 'cancelled' || r !== 'pending') {
        throw new IllegalCardOrderTransitionError('refund_rejected requires cancelled + refund pending', 'bad_refund');
      }
      return {
        status: 'cancelled',
        payment_status: 'paid',
        refund_status: 'rejected',
      };
    }

    default: {
      const _exhaustive: never = event;
      throw new IllegalCardOrderTransitionError(`Unknown event ${_exhaustive}`, 'unknown_event');
    }
  }
}

async function enrichLatestTransitionRow(
  supabase: SupabaseClient,
  orderId: string,
  ctx: ApplyTransitionContext,
): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('card_order_status_transitions')
      .select('id')
      .eq('card_order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return;

    await supabase
      .from('card_order_status_transitions')
      .update({
        transitioned_by: ctx.actorUserId ?? null,
        transitioned_by_role: ctx.actorRole ?? null,
        reason: ctx.reason ?? null,
        metadata: ctx.metadata ?? null,
      })
      .eq('id', (data as { id: string }).id);
  } catch {
    /* optional table */
  }
}

export async function applyCardOrderTransition(
  supabase: SupabaseClient,
  orderId: string,
  event: CardOrderLifecycleEvent,
  options: ApplyCardOrderTransitionOptions = {},
): Promise<{ status: string; payment_status: string; refund_status: string | null }> {
  const { data: row, error: fetchErr } = await supabase
    .from('card_orders')
    .select('id, status, payment_status, refund_status')
    .eq('id', orderId)
    .maybeSingle();

  if (fetchErr || !row) {
    throw new IllegalCardOrderTransitionError('Order not found', 'not_found');
  }

  const snapshot = row as CardOrderStateSnapshot;
  const lifecyclePatch = buildCardOrderTransitionPatch(snapshot, event, options);
  const merged: Record<string, unknown> = {
    ...lifecyclePatch,
    ...(options.extraColumns ?? {}),
    updated_at: stamp(),
  };

  if (Object.keys(lifecyclePatch).length === 0 && Object.keys(options.extraColumns ?? {}).length === 0) {
    return {
      status: String(snapshot.status),
      payment_status: String(snapshot.payment_status),
      refund_status: snapshot.refund_status,
    };
  }

  const { error: upErr } = await supabase.from('card_orders').update(merged).eq('id', orderId);
  if (upErr) {
    throw new IllegalCardOrderTransitionError(upErr.message, 'update_failed');
  }

  await enrichLatestTransitionRow(supabase, orderId, options);

  if (lifecyclePatch.status !== undefined) {
    const prev = String(snapshot.status);
    const next = String(lifecyclePatch.status);
    if (prev.toLowerCase() !== next.toLowerCase()) {
      void import('@/lib/cardOrderNotifications')
        .then(({ sendCardOrderStatusUpdate }) =>
          sendCardOrderStatusUpdate(orderId, prev, next).catch((e) =>
            console.error('[cardOrderState] sendCardOrderStatusUpdate', e),
          ),
        )
        .catch((e) => console.error('[cardOrderState] notify import', e));
    }
  }

  const nextStatus = (lifecyclePatch.status as string | undefined) ?? snapshot.status;
  const nextPay = (lifecyclePatch.payment_status as string | undefined) ?? snapshot.payment_status;
  const nextRef =
    lifecyclePatch.refund_status !== undefined
      ? (lifecyclePatch.refund_status as string | null)
      : snapshot.refund_status;

  return {
    status: String(nextStatus),
    payment_status: String(nextPay),
    refund_status: nextRef ?? null,
  };
}

/** Maps legacy admin fulfillment labels to lifecycle events. */
export function legacyAdminStatusToEvent(target: string): CardOrderLifecycleEvent | null {
  const t = norm(target);
  switch (t) {
    case 'vendor_assigned':
      return 'vendor_assigned';
    case 'printing':
    case 'in_production':
      return 'production_started';
    case 'ready_for_pickup':
      return 'ready_for_pickup';
    case 'shipped':
      return 'bosta_picked_up';
    case 'delivered':
      return 'bosta_delivered';
    case 'confirmed':
      return 'centre_confirmed_issued';
    case 'paid':
      return 'paymob_succeeded';
    default:
      return null;
  }
}
