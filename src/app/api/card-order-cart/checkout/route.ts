import '@/lib/paymobProductionGuard';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import QRCode from 'qrcode';
import { requireCenterAuth } from '@/lib/centerAuth';
import { requirePermission } from '@/lib/centerPermissions';
import { cardOrdersDisabledResponse } from '@/lib/card-order-cart/cardOrdersGate';
import { parseBodyWithLimit } from '@/lib/validate';
import { normalizePhone, isValidEgyptianMobileE164 } from '@/lib/utils/phone';
import {
  buildCartPayload,
  fetchActorName,
  getCardOrderMinimumQty,
  purgeStaleCartItemsForCart,
  type HydratedCartItem,
} from '@/lib/card-order-cart/server';
import { activeCardCountFromItems } from '@/lib/card-order-cart/totals';
import { cardOrderProductInclusiveFromQty } from '@/lib/pricing/taxMath';
import { getShippingFee, getShippingZone } from '@/lib/bostaShipping';
import { loadBostaShippingRates } from '@/lib/loadBostaShippingRates';
import { issueCardOrderIframePayment } from '@/lib/paymob/issueCardOrderIframe';

export const dynamic = 'force-dynamic';

const checkoutBodySchema = z
  .object({
    terms_accepted: z.literal(true),
  })
  .strict();

function eligibleCartItems(items: HydratedCartItem[]): HydratedCartItem[] {
  return items.filter((i) => !i.saved_for_later && !i.stale);
}

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  // Card ordering is opt-in per center (off by default) — defense-in-depth gate
  // so a direct POST can't bypass the hidden UI on the service-role client.
  const disabled = await cardOrdersDisabledResponse(auth.supabaseAdmin, auth.centerId);
  if (disabled) return disabled;
  // Permission gate added May 12 per docs/AUDIT_center_role_gating.md
  const permErr = requirePermission(auth, 'can_place_card_orders');
  if (permErr) return permErr;

  let body: unknown;
  try {
    body = await parseBodyWithLimit(request, 65536);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'bad_json' }, { status: 400 });
  }

  const parsed = checkoutBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Terms required', code: 'terms_required' }, { status: 400 });
  }

  const { supabaseAdmin, centerId, userId } = auth;
  const minQty = await getCardOrderMinimumQty(supabaseAdmin);

  let payload = await buildCartPayload(supabaseAdmin, centerId, minQty);
  const cartFirst = payload.cart;
  if (!cartFirst || cartFirst.status !== 'open') {
    return NextResponse.json({ error: 'No open cart', code: 'cart_empty' }, { status: 400 });
  }

  await purgeStaleCartItemsForCart(supabaseAdmin, cartFirst.id, centerId);
  payload = await buildCartPayload(supabaseAdmin, centerId, minQty);
  const cart = payload.cart;
  if (!cart || cart.status !== 'open') {
    return NextResponse.json({ error: 'No open cart', code: 'cart_empty' }, { status: 400 });
  }

  const cartRowId = cart.id;

  const items = eligibleCartItems(payload.items);

  const totalsLike = items.map((i) => ({
    kind: i.kind,
    quantity: i.quantity,
    saved_for_later: false,
  }));
  const qty = activeCardCountFromItems(totalsLike);
  if (qty < minQty) {
    return NextResponse.json({ error: 'Below minimum quantity', code: 'below_minimum' }, { status: 400 });
  }

  if (!cart.delivery_governorate?.trim() || !cart.delivery_address?.trim() || !cart.delivery_phone?.trim()) {
    return NextResponse.json({ error: 'Missing delivery details', code: 'missing_delivery' }, { status: 400 });
  }

  const phoneNorm = normalizePhone(cart.delivery_phone);
  if (!isValidEgyptianMobileE164(phoneNorm)) {
    return NextResponse.json({ error: 'Invalid delivery phone on cart', code: 'invalid_phone' }, { status: 400 });
  }

  if (!cart.card_style || (cart.card_style !== 'dark' && cart.card_style !== 'light')) {
    return NextResponse.json({ error: 'Card style required', code: 'missing_card_style' }, { status: 400 });
  }

  const rates = await loadBostaShippingRates();
  const gov = cart.delivery_governorate.trim();
  const deliveryFee = getShippingFee(gov, rates);
  const shippingZone = getShippingZone(gov, rates);

  const productInclusive = cardOrderProductInclusiveFromQty(qty);
  const payTotal = Math.round((productInclusive + deliveryFee) * 100) / 100;
  const perCardInclusive = cardOrderProductInclusiveFromQty(1);

  const studentLines = items.filter((i) => i.kind === 'student' && i.student_id);
  const studentIds = studentLines.map((i) => i.student_id as string);

  const studentsById: Record<string, { name: string; student_number: string | null; qr_code: string | null }> = {};
  if (studentIds.length) {
    const { data: studs } = await supabaseAdmin
      .from('students')
      .select('id, name, student_number, qr_code, center_id')
      .in('id', studentIds);
    for (const s of studs ?? []) {
      const row = s as {
        id: string;
        name: string | null;
        student_number: string | null;
        qr_code: string | null;
        center_id: string | null;
      };
      if (row.center_id !== centerId) {
        return NextResponse.json({ error: 'Student no longer at centre', code: 'student_mismatch' }, { status: 409 });
      }
      studentsById[row.id] = {
        name: row.name ?? '',
        student_number: row.student_number,
        qr_code: row.qr_code,
      };
    }
  }

  const studentsPayload: { id: string; name: string; student_number: string; qr_code: string }[] = [];
  for (const line of studentLines) {
    const sid = line.student_id as string;
    const st = studentsById[sid];
    if (!st) {
      return NextResponse.json({ error: 'Student not found', code: 'student_not_found' }, { status: 400 });
    }
    let qr = st.qr_code?.trim() || '';
    if (!qr) {
      try {
        qr = await QRCode.toDataURL(sid, { width: 300, margin: 2 });
      } catch {
        qr = '';
      }
    }
    studentsPayload.push({
      id: sid,
      name: st.name,
      student_number: st.student_number ?? '',
      qr_code: qr,
    });
  }

  const noteParts = [cart.notes?.trim(), cart.vendor_notes?.trim()].filter(Boolean);
  const notesForOrder = noteParts.length ? noteParts.join('\n\n') : null;

  const { data: centerRow } = await supabaseAdmin.from('centers').select('name, phone').eq('id', centerId).maybeSingle();
  const centerName = String((centerRow as { name?: string | null } | null)?.name ?? '').trim();

  const actorName = await fetchActorName(supabaseAdmin, userId);

  const insertOrder = {
    center_id: centerId,
    created_by: userId,
    students: studentsPayload,
    quantity: qty,
    price_per_card: perCardInclusive,
    delivery_fee: deliveryFee,
    shipping_zone: shippingZone,
    total_amount: payTotal,
    status: 'pending_payment',
    payment_status: 'unpaid',
    delivery_address: cart.delivery_address.trim(),
    delivery_governorate: gov,
    delivery_phone: phoneNorm,
    notes: notesForOrder,
    card_style: cart.card_style,
  };

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('card_orders')
    .insert(insertOrder)
    .select('id')
    .single();

  if (insErr || !inserted) {
    console.error('[checkout] card_orders insert', insErr);
    return NextResponse.json({ error: insErr?.message ?? 'Insert failed', code: 'insert_failed' }, { status: 500 });
  }

  const orderId = (inserted as { id: string }).id;

  const itemRows: { card_order_id: string; student_id: string | null; kind: string; quantity: number }[] = [];
  for (const line of items) {
    if (line.kind === 'student' && line.student_id) {
      itemRows.push({ card_order_id: orderId, student_id: line.student_id, kind: 'student', quantity: 1 });
    } else if (line.kind === 'blank') {
      itemRows.push({
        card_order_id: orderId,
        student_id: null,
        kind: 'blank',
        quantity: Math.max(1, line.quantity),
      });
    }
  }

  if (itemRows.length) {
    const { error: itemsErr } = await supabaseAdmin.from('card_order_items').insert(itemRows);
    if (itemsErr) {
      console.error('[checkout] card_order_items', itemsErr);
      await supabaseAdmin.from('card_orders').delete().eq('id', orderId);
      return NextResponse.json({ error: itemsErr.message, code: 'items_failed' }, { status: 500 });
    }
  }

  const billingDigits = phoneNorm.replace(/\D/g, '');
  const paymob = await issueCardOrderIframePayment({
    supabaseAdmin,
    centerId,
    cardOrderId: orderId,
    amountEgp: payTotal,
    centerName,
    billingPhoneDigits: billingDigits,
  });

  if ('error' in paymob) {
    await supabaseAdmin.from('card_orders').delete().eq('id', orderId);
    return NextResponse.json(
      { error: paymob.error, code: 'paymob_failed' },
      { status: paymob.status >= 500 ? 502 : paymob.status },
    );
  }

  const { error: cartErr } = await supabaseAdmin
    .from('card_order_carts')
    .update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      card_order_id: orderId,
      last_modified_by: userId,
      last_modified_by_name: actorName,
      version: cart.version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', cartRowId)
    .eq('center_id', centerId)
    .eq('status', 'open');

  if (cartErr) {
    console.error('[checkout] cart submit failed', cartErr);
  }

  return NextResponse.json({
    orderId,
    paymentUrl: paymob.iframeUrl,
    paymobOrderId: paymob.paymobOrderId,
  });
}
