import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { parseBodyWithLimit } from '@/lib/validate';
import {
  buildCartPayload,
  getCardOrderMinimumQty,
  purgeStaleCartItemsForCart,
} from '@/lib/card-order-cart/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown> = {};
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const cartIdRaw = typeof body.cart_id === 'string' ? body.cart_id.trim() : '';

  const { supabaseAdmin, centerId } = auth;

  const { data: open } = await supabaseAdmin
    .from('card_order_carts')
    .select('id')
    .eq('center_id', centerId)
    .eq('status', 'open')
    .maybeSingle();

  const openId = open && typeof (open as { id?: string }).id === 'string' ? (open as { id: string }).id : null;

  const targetId =
    cartIdRaw && openId === cartIdRaw ? cartIdRaw : openId;

  if (targetId) {
    await purgeStaleCartItemsForCart(supabaseAdmin, targetId, centerId);
  }

  const minQty = await getCardOrderMinimumQty(supabaseAdmin);
  const payload = await buildCartPayload(supabaseAdmin, centerId, minQty);
  return NextResponse.json(payload);
}
