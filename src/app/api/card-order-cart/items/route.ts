import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { parseBodyWithLimit } from '@/lib/validate';
import {
  buildCartPayload,
  fetchActorName,
  getCardOrderMinimumQty,
} from '@/lib/card-order-cart/server';

export const dynamic = 'force-dynamic';

type SingleBody = {
  kind: 'student' | 'blank';
  student_id?: string;
  quantity?: number;
};

type BatchBody = {
  items: SingleBody[];
};

async function ensureOpenCartId(
  admin: import('@supabase/supabase-js').SupabaseClient,
  centerId: string,
  userId: string,
): Promise<string> {
  const { data: open } = await admin
    .from('card_order_carts')
    .select('id')
    .eq('center_id', centerId)
    .eq('status', 'open')
    .maybeSingle();

  if (open && typeof (open as { id?: string }).id === 'string') {
    return (open as { id: string }).id;
  }

  const actorName = await fetchActorName(admin, userId);
  const { data: inserted, error } = await admin
    .from('card_order_carts')
    .insert({
      center_id: centerId,
      status: 'open',
      last_modified_by: userId,
      last_modified_by_name: actorName,
    })
    .select('id')
    .single();

  if (error || !inserted) {
    throw new Error(error?.message ?? 'Could not create cart');
  }
  return (inserted as { id: string }).id;
}

async function setCartActor(
  admin: import('@supabase/supabase-js').SupabaseClient,
  cartId: string,
  userId: string,
): Promise<void> {
  const actorName = await fetchActorName(admin, userId);
  await admin
    .from('card_order_carts')
    .update({
      last_modified_by: userId,
      last_modified_by_name: actorName,
    })
    .eq('id', cartId);
}

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rawItems: SingleBody[] =
    Array.isArray(body.items) && body.items.length > 0
      ? (body.items as SingleBody[])
      : body.kind === 'student' || body.kind === 'blank'
        ? [{ kind: body.kind as 'student' | 'blank', student_id: body.student_id as string | undefined, quantity: body.quantity as number | undefined }]
        : [];

  if (rawItems.length === 0) {
    return NextResponse.json({ error: 'No items' }, { status: 400 });
  }

  const { supabaseAdmin, centerId, userId } = auth;

  try {
    const cartId = await ensureOpenCartId(supabaseAdmin, centerId, userId);

    const batchStudentIds = new Set<string>();

    for (const item of rawItems) {
      if (item.kind === 'student') {
        const sid = typeof item.student_id === 'string' ? item.student_id.trim() : '';
        if (!sid) {
          return NextResponse.json({ error: 'student_id required for student items' }, { status: 400 });
        }

        if (batchStudentIds.has(sid)) {
          return NextResponse.json({ error: 'Duplicate student in batch' }, { status: 400 });
        }
        batchStudentIds.add(sid);

        const { data: st } = await supabaseAdmin
          .from('students')
          .select('id')
          .eq('id', sid)
          .eq('center_id', centerId)
          .maybeSingle();

        if (!st) {
          return NextResponse.json({ error: 'Student not found for this centre' }, { status: 400 });
        }

        const { data: dup } = await supabaseAdmin
          .from('card_order_cart_items')
          .select('id')
          .eq('cart_id', cartId)
          .eq('kind', 'student')
          .eq('student_id', sid)
          .maybeSingle();

        if (dup) {
          return NextResponse.json({ error: 'Student already in cart' }, { status: 409 });
        }

        const { error: insErr } = await supabaseAdmin.from('card_order_cart_items').insert({
          cart_id: cartId,
          kind: 'student',
          student_id: sid,
          quantity: 1,
          saved_for_later: false,
        });

        if (insErr) {
          return NextResponse.json({ error: insErr.message }, { status: 500 });
        }
      } else {
        const q = Math.round(Number(item.quantity ?? 1));
        if (!Number.isFinite(q) || q < 1) {
          return NextResponse.json({ error: 'Invalid blank quantity' }, { status: 400 });
        }

        const { data: blankRow } = await supabaseAdmin
          .from('card_order_cart_items')
          .select('id, quantity')
          .eq('cart_id', cartId)
          .eq('kind', 'blank')
          .maybeSingle();

        if (blankRow && typeof (blankRow as { id?: string }).id === 'string') {
          const prev = Math.round(Number((blankRow as { quantity?: number }).quantity ?? 1));
          const nextQty = prev + q;
          const { error: upErr } = await supabaseAdmin
            .from('card_order_cart_items')
            .update({ quantity: nextQty })
            .eq('id', (blankRow as { id: string }).id);
          if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
        } else {
          const { error: insErr } = await supabaseAdmin.from('card_order_cart_items').insert({
            cart_id: cartId,
            kind: 'blank',
            student_id: null,
            quantity: q,
            saved_for_later: false,
          });
          if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
        }
      }
    }

    await setCartActor(supabaseAdmin, cartId, userId);

    const minQty = await getCardOrderMinimumQty(supabaseAdmin);
    const payload = await buildCartPayload(supabaseAdmin, centerId, minQty);
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
