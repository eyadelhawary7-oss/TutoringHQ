import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { parseBodyWithLimit } from '@/lib/validate';
import { cardOrdersDisabledResponse } from '@/lib/card-order-cart/cardOrdersGate';
import {
  buildCartPayload,
  fetchActorName,
  getCardOrderMinimumQty,
} from '@/lib/card-order-cart/server';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  const disabled = await cardOrdersDisabledResponse(auth.supabaseAdmin, auth.centerId);
  if (disabled) return disabled;

  const { itemId } = await params;
  if (!itemId) return NextResponse.json({ error: 'Missing item id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { supabaseAdmin, centerId, userId } = auth;

  const { data: row } = await supabaseAdmin
    .from('card_order_cart_items')
    .select('id, cart_id, kind, quantity, saved_for_later')
    .eq('id', itemId)
    .maybeSingle();

  const item = row as {
    id: string;
    cart_id: string;
    kind: string;
    quantity: number;
    saved_for_later: boolean;
  } | null;

  if (!item) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: cartRow } = await supabaseAdmin
    .from('card_order_carts')
    .select('center_id, status')
    .eq('id', item.cart_id)
    .maybeSingle();

  const cart = cartRow as { center_id: string; status: string } | null;
  if (!cart || cart.center_id !== centerId || cart.status !== 'open') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const patch: Record<string, unknown> = {};

  if ('saved_for_later' in body) {
    patch.saved_for_later = Boolean(body.saved_for_later);
  }

  if ('quantity' in body) {
    if (item.kind !== 'blank') {
      return NextResponse.json({ error: 'Quantity can only be changed for blank items' }, { status: 400 });
    }
    const q = Math.round(Number(body.quantity));
    if (!Number.isFinite(q) || q < 1) {
      return NextResponse.json({ error: 'Invalid quantity' }, { status: 400 });
    }
    patch.quantity = q;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('card_order_cart_items').update(patch).eq('id', itemId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const actorName = await fetchActorName(supabaseAdmin, userId);
  await supabaseAdmin
    .from('card_order_carts')
    .update({
      last_modified_by: userId,
      last_modified_by_name: actorName,
    })
    .eq('id', item.cart_id);

  const minQty = await getCardOrderMinimumQty(supabaseAdmin);
  const payload = await buildCartPayload(supabaseAdmin, centerId, minQty);
  return NextResponse.json(payload);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  const { itemId } = await params;
  if (!itemId) return NextResponse.json({ error: 'Missing item id' }, { status: 400 });

  const { supabaseAdmin, centerId, userId } = auth;

  const { data: row } = await supabaseAdmin.from('card_order_cart_items').select('id, cart_id').eq('id', itemId).maybeSingle();

  const item = row as { cart_id: string } | null;

  if (!item) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: cartRow } = await supabaseAdmin
    .from('card_order_carts')
    .select('center_id, status')
    .eq('id', item.cart_id)
    .maybeSingle();

  const cart = cartRow as { center_id: string; status: string } | null;
  if (!cart || cart.center_id !== centerId || cart.status !== 'open') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { error } = await supabaseAdmin.from('card_order_cart_items').delete().eq('id', itemId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const actorName = await fetchActorName(supabaseAdmin, userId);
  await supabaseAdmin
    .from('card_order_carts')
    .update({
      last_modified_by: userId,
      last_modified_by_name: actorName,
    })
    .eq('id', item.cart_id);

  const minQty = await getCardOrderMinimumQty(supabaseAdmin);
  const payload = await buildCartPayload(supabaseAdmin, centerId, minQty);
  return NextResponse.json(payload);
}
