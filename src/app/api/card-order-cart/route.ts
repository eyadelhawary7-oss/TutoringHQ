import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCenterAuth } from '@/lib/centerAuth';
import { parseBodyWithLimit } from '@/lib/validate';
import { cardOrdersDisabledResponse } from '@/lib/card-order-cart/cardOrdersGate';
import { normalizePhone, isValidEgyptianMobileE164 } from '@/lib/utils/phone';
import { buildCartPayload, fetchActorName, getCardOrderMinimumQty, purgeStaleCartItemsForCart } from '@/lib/card-order-cart/server';

export const dynamic = 'force-dynamic';

const patchCartSchema = z
  .object({
    delivery_governorate: z.string().min(1).optional().nullable(),
    delivery_address: z.string().min(5).max(200).optional().nullable(),
    delivery_phone: z.string().optional().nullable(),
    notes: z.string().max(200).optional().nullable(),
    vendor_notes: z.string().max(200).optional().nullable(),
    card_style: z.enum(['dark', 'light']).optional().nullable(),
    save_delivery_defaults: z.boolean().optional(),
    remember_card_style: z.boolean().optional(),
  })
  .strict();

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
  const disabled = await cardOrdersDisabledResponse(auth.supabaseAdmin, auth.centerId);
  if (disabled) return disabled;

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

export async function PATCH(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  const disabled = await cardOrdersDisabledResponse(auth.supabaseAdmin, auth.centerId);
  if (disabled) return disabled;

  const { supabaseAdmin, centerId, userId } = auth;

  let body: unknown;
  try {
    body = await parseBodyWithLimit(request, 65536);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = patchCartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.flatten() }, { status: 400 });
  }

  const patch = parsed.data;

  let phoneForDb: string | null | undefined = undefined;
  if (patch.delivery_phone !== undefined) {
    if (patch.delivery_phone === null || String(patch.delivery_phone).trim() === '') {
      phoneForDb = null;
    } else {
      const norm = normalizePhone(String(patch.delivery_phone));
      if (!isValidEgyptianMobileE164(norm)) {
        return NextResponse.json({ error: 'Invalid phone', code: 'invalid_phone' }, { status: 400 });
      }
      phoneForDb = norm;
    }
  }

  const { data: open } = await supabaseAdmin
    .from('card_order_carts')
    .select('id')
    .eq('center_id', centerId)
    .eq('status', 'open')
    .maybeSingle();

  if (!open) {
    return NextResponse.json({ error: 'No open cart', code: 'no_open_cart' }, { status: 409 });
  }

  const cartId = (open as { id: string }).id;
  await purgeStaleCartItemsForCart(supabaseAdmin, cartId, centerId);

  const actorName = await fetchActorName(supabaseAdmin, userId);

  const { data: verRow } = await supabaseAdmin.from('card_order_carts').select('version').eq('id', cartId).maybeSingle();
  const nextVersion = ((verRow as { version?: number } | null)?.version ?? 0) + 1;

  const dbPatch: Record<string, unknown> = {
    last_modified_by: userId,
    last_modified_by_name: actorName,
    updated_at: new Date().toISOString(),
    version: nextVersion,
  };

  if (patch.delivery_governorate !== undefined) dbPatch.delivery_governorate = patch.delivery_governorate;
  if (patch.delivery_address !== undefined) dbPatch.delivery_address = patch.delivery_address;
  if (patch.notes !== undefined) dbPatch.notes = patch.notes;
  if (patch.vendor_notes !== undefined) dbPatch.vendor_notes = patch.vendor_notes;
  if (patch.card_style !== undefined) dbPatch.card_style = patch.card_style;
  if (patch.delivery_phone !== undefined) dbPatch.delivery_phone = phoneForDb;

  const { error: upErr } = await supabaseAdmin.from('card_order_carts').update(dbPatch).eq('id', cartId);
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  if (
    patch.save_delivery_defaults &&
    patch.delivery_governorate &&
    patch.delivery_address &&
    phoneForDb
  ) {
    const { data: centerCur } = await supabaseAdmin.from('centers').select('delivery_address').eq('id', centerId).maybeSingle();
    const prev = (centerCur as { delivery_address?: Record<string, unknown> | null } | null)?.delivery_address;
    const merged = { ...(typeof prev === 'object' && prev ? prev : {}) };
    merged.street = patch.delivery_address;
    merged.governorate = patch.delivery_governorate;
    merged.phone = phoneForDb;
    await supabaseAdmin
      .from('centers')
      .update({
        governorate: patch.delivery_governorate,
        phone: phoneForDb,
        delivery_address: merged,
      })
      .eq('id', centerId);
  }

  if (patch.remember_card_style && patch.card_style) {
    await supabaseAdmin.from('centers').update({ last_card_style: patch.card_style }).eq('id', centerId);
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
