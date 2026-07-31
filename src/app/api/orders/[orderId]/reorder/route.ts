import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { requirePermission } from '@/lib/centerPermissions';
import { cardOrdersDisabledResponse } from '@/lib/card-order-cart/cardOrdersGate';
import { ensureOpenCartId, setCartActor, getCardOrderMinimumQty, buildCartPayload } from '@/lib/card-order-cart/server';
import { CARD_ORDER_REORDER_BLOCK_STATUSES } from '@/lib/card-order-cart/cardOrderStatuses';
import { studentIdsFromOrderStudents } from '@/lib/card-order-cart/studentIdsFromOrder';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  // Card ordering is opt-in per center (off by default) — same defense-in-depth gate
  // checkout/route.ts and create-payment-key/route.ts already apply.
  const disabled = await cardOrdersDisabledResponse(auth.supabaseAdmin, auth.centerId);
  if (disabled) return disabled;
  const permErr = requirePermission(auth, 'can_place_card_orders');
  if (permErr) return permErr;

  const { orderId } = await ctx.params;
  const id = typeof orderId === 'string' ? orderId.trim() : '';
  if (!id) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const { supabaseAdmin, centerId, userId } = auth;

  const { data: order, error: ordErr } = await supabaseAdmin
    .from('card_orders')
    .select('id, center_id, students, quantity')
    .eq('id', id)
    .eq('center_id', centerId)
    .maybeSingle();

  if (ordErr || !order) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: itemRows } = await supabaseAdmin
    .from('card_order_items')
    .select('student_id, kind, quantity')
    .eq('card_order_id', id);

  let studentIds: string[] = [];
  let blankQty = 0;

  if (itemRows?.length) {
    for (const row of itemRows as { student_id?: string | null; kind?: string; quantity?: number }[]) {
      if (row.kind === 'student' && row.student_id) studentIds.push(row.student_id);
      if (row.kind === 'blank') blankQty += Math.max(1, Math.round(Number(row.quantity ?? 1)));
    }
  } else {
    studentIds = studentIdsFromOrderStudents((order as { students?: unknown }).students);
    const q = Math.round(Number((order as { quantity?: number }).quantity ?? 0));
    blankQty = Math.max(0, q - studentIds.length);
  }

  const blockingList = [...CARD_ORDER_REORDER_BLOCK_STATUSES];
  const { data: blockingOrders } = await supabaseAdmin
    .from('card_orders')
    .select('id')
    .eq('center_id', centerId)
    .in('status', blockingList);

  const blockingOrderIds = (blockingOrders ?? []).map((r) => (r as { id: string }).id).filter((oid) => oid !== id);

  const blockedStudentReason = new Map<string, string>();
  if (blockingOrderIds.length) {
    const { data: lines } = await supabaseAdmin
      .from('card_order_items')
      .select('student_id')
      .in('card_order_id', blockingOrderIds)
      .eq('kind', 'student')
      .not('student_id', 'is', null);

    for (const ln of lines ?? []) {
      const sid = String((ln as { student_id?: string }).student_id ?? '');
      if (sid && !blockedStudentReason.has(sid)) blockedStudentReason.set(sid, 'alreadyHasCard');
    }
  }

  const skippedReasons: { student_id: string; reason: string }[] = [];
  const toAddStudents: string[] = [];

  for (const sid of studentIds) {
    const blockedReason = blockedStudentReason.get(sid);
    if (blockedReason) {
      skippedReasons.push({ student_id: sid, reason: blockedReason });
      continue;
    }

    const { data: st } = await supabaseAdmin
      .from('students')
      .select('id, center_id, is_active')
      .eq('id', sid)
      .maybeSingle();

    const row = st as { center_id?: string | null; is_active?: boolean | null } | null;
    if (!row || row.center_id !== centerId) {
      skippedReasons.push({ student_id: sid, reason: 'transferredOut' });
      continue;
    }
    if (row.is_active === false) {
      skippedReasons.push({ student_id: sid, reason: 'inactive' });
      continue;
    }

    toAddStudents.push(sid);
  }

  try {
    const cartId = await ensureOpenCartId(supabaseAdmin, centerId, userId);

    const { data: existingCartItems } = await supabaseAdmin
      .from('card_order_cart_items')
      .select('student_id, kind')
      .eq('cart_id', cartId);

    const existingStudentIds = new Set<string>();
    for (const it of existingCartItems ?? []) {
      const r = it as { kind?: string; student_id?: string | null };
      if (r.kind === 'student' && r.student_id) existingStudentIds.add(r.student_id);
    }

    let addedCount = 0;
    let blanksAdded = 0;

    for (const sid of toAddStudents) {
      if (existingStudentIds.has(sid)) {
        skippedReasons.push({ student_id: sid, reason: 'alreadyInCart' });
        continue;
      }

      const { error: insErr } = await supabaseAdmin.from('card_order_cart_items').insert({
        cart_id: cartId,
        kind: 'student',
        student_id: sid,
        quantity: 1,
        saved_for_later: false,
      });
      if (!insErr) {
        addedCount += 1;
        existingStudentIds.add(sid);
      }
    }

    if (blankQty > 0) {
      const { data: blankRow } = await supabaseAdmin
        .from('card_order_cart_items')
        .select('id, quantity')
        .eq('cart_id', cartId)
        .eq('kind', 'blank')
        .maybeSingle();

      if (blankRow && typeof (blankRow as { id?: string }).id === 'string') {
        const prev = Math.round(Number((blankRow as { quantity?: number }).quantity ?? 1));
        await supabaseAdmin
          .from('card_order_cart_items')
          .update({ quantity: prev + blankQty })
          .eq('id', (blankRow as { id: string }).id);
      } else {
        await supabaseAdmin.from('card_order_cart_items').insert({
          cart_id: cartId,
          kind: 'blank',
          student_id: null,
          quantity: blankQty,
          saved_for_later: false,
        });
      }
      blanksAdded += blankQty;
    }

    await setCartActor(supabaseAdmin, cartId, userId);

    const minQty = await getCardOrderMinimumQty(supabaseAdmin);
    await buildCartPayload(supabaseAdmin, centerId, minQty);

    return NextResponse.json({
      cart_id: cartId,
      addedCount,
      blanksAdded,
      skippedCount: skippedReasons.length,
      skippedReasons,
    });
  } catch (e) {
    console.error('[reorder]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Reorder failed' }, { status: 500 });
  }
}
