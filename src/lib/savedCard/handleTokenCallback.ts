/**
 * Phase 2 (2f) — route a Paymob TOKEN callback into the Phase 1 save path.
 *
 * After a customer's first payment requests tokenization, Paymob sends a separate
 * callback carrying the saved-card token. We resolve which owner the originating
 * order belongs to, parse the token (never the PAN), and save it via
 * `saveCardFromFirstPayment` — which enforces the consent gate and runs the
 * validity check. With no consent recorded, nothing is stored.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { parsePaymobTokenCallback, saveCardFromFirstPayment } from './saveCard';
import { createSupabaseSavedCardStore } from './store';
import { paymobRecurringClient } from './paymobRecurring';
import type { OwnerRef } from './types';

/** True when the webhook payload is a Paymob card-token callback (not a transaction). */
export function isPaymobTokenCallback(payload: Record<string, unknown>): boolean {
  const type = typeof payload.type === 'string' ? payload.type.toUpperCase() : '';
  if (type === 'TOKEN' || type === 'CARD_TOKEN') return true;
  const obj = payload.obj as Record<string, unknown> | undefined;
  return (
    !!obj &&
    typeof obj.token === 'string' &&
    obj.token.length > 0 &&
    (typeof obj.masked_pan === 'string' || typeof obj.masked_card === 'string')
  );
}

async function resolveOwnerForOrder(
  supabase: SupabaseClient,
  orderId: string,
): Promise<OwnerRef | null> {
  if (!orderId) return null;
  const { data: inv } = await supabase
    .from('invoices')
    .select('center_id')
    .eq('paymob_order_id', orderId)
    .maybeSingle();
  const invCenter = (inv as { center_id?: string } | null)?.center_id;
  if (invCenter) return { ownerType: 'center', ownerId: String(invCenter) };

  const { data: sess } = await supabase
    .from('combined_payment_sessions')
    .select('center_id')
    .eq('paymob_order_id', orderId)
    .maybeSingle();
  const sessCenter = (sess as { center_id?: string } | null)?.center_id;
  if (sessCenter) return { ownerType: 'center', ownerId: String(sessCenter) };

  return null;
}

export async function handlePaymobTokenCallback(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<{ saved: boolean; reason?: string }> {
  const obj = (payload.obj && typeof payload.obj === 'object'
    ? (payload.obj as Record<string, unknown>)
    : payload) as Record<string, unknown>;

  const card = parsePaymobTokenCallback(obj);
  if (!card) return { saved: false, reason: 'no_token' };

  const order = obj.order as { id?: unknown } | null | undefined;
  const orderId =
    order?.id != null ? String(order.id) : obj.order_id != null ? String(obj.order_id) : '';

  const owner = await resolveOwnerForOrder(supabase, orderId);
  if (!owner) return { saved: false, reason: 'owner_unresolved' };

  const store = createSupabaseSavedCardStore(supabase);
  const res = await saveCardFromFirstPayment(
    { owner, card },
    { store, paymob: paymobRecurringClient },
  );
  return res.ok ? { saved: true } : { saved: false, reason: res.reason };
}
