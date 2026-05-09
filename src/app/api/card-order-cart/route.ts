import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { buildCartPayload, fetchActorName, getCardOrderMinimumQty } from '@/lib/card-order-cart/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  const minQty = await getCardOrderMinimumQty(auth.supabaseAdmin);
  const payload = await buildCartPayload(auth.supabaseAdmin, auth.centerId, minQty);
  return NextResponse.json(payload);
}

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  const { supabaseAdmin, centerId, userId } = auth;

  const { data: existing } = await supabaseAdmin
    .from('card_order_carts')
    .select('id')
    .eq('center_id', centerId)
    .eq('status', 'open')
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'Open cart already exists' }, { status: 409 });
  }

  const actorName = await fetchActorName(supabaseAdmin, userId);

  const { data: inserted, error } = await supabaseAdmin
    .from('card_order_carts')
    .insert({
      center_id: centerId,
      status: 'open',
      last_modified_by: userId,
      last_modified_by_name: actorName,
    })
    .select('*')
    .single();

  if (error || !inserted) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create cart' }, { status: 500 });
  }

  const minQty = await getCardOrderMinimumQty(supabaseAdmin);
  const payload = await buildCartPayload(supabaseAdmin, centerId, minQty);
  return NextResponse.json(payload);
}

export async function DELETE(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  const { supabaseAdmin, centerId, userId } = auth;

  const { data: open } = await supabaseAdmin
    .from('card_order_carts')
    .select('id')
    .eq('center_id', centerId)
    .eq('status', 'open')
    .maybeSingle();

  if (!open) {
    const minQty = await getCardOrderMinimumQty(supabaseAdmin);
    const payload = await buildCartPayload(supabaseAdmin, centerId, minQty);
    return NextResponse.json(payload);
  }

  const actorName = await fetchActorName(supabaseAdmin, userId);

  const { error } = await supabaseAdmin
    .from('card_order_carts')
    .update({
      status: 'abandoned',
      abandoned_at: new Date().toISOString(),
      last_modified_by: userId,
      last_modified_by_name: actorName,
    })
    .eq('id', (open as { id: string }).id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const minQty = await getCardOrderMinimumQty(supabaseAdmin);
  const payload = await buildCartPayload(supabaseAdmin, centerId, minQty);
  return NextResponse.json(payload);
}
