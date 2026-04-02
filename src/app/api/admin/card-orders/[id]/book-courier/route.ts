import { requireSuperAdminApi } from '@/lib/admin-auth';
import { createBostaDelivery } from '@/lib/bosta';
import { NextResponse } from 'next/server';

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const auth = await requireSuperAdminApi(req);
  if (!auth.ok) {
    return auth.response;
  }

  const { supabaseAdmin } = auth;

  const { data: order } = await supabaseAdmin
    .from('card_orders')
    .select(
      `
      id,
      quantity,
      notes,
      delivery_address,
      status,
      bosta_order_id,
      centers ( phone, governorate )
    `,
    )
    .eq('id', id)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const o = order as { bosta_order_id?: string | null };
  if (o.bosta_order_id) {
    return NextResponse.json({ error: 'already_booked' }, { status: 400 });
  }

  const { data: vendor } = await supabaseAdmin
    .from('vendors')
    .select('whatsapp_number, pickup_address, city')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (!vendor) {
    return NextResponse.json({ error: 'no_active_vendor' }, { status: 400 });
  }

  const center = order.centers as { phone?: string | null; governorate?: string | null } | null;
  const prefix = (process.env.BOSTA_BUSINESS_PREFIX ?? 'CHQ').replace(/[^A-Za-z0-9]/g, '') || 'CHQ';
  const ref = `${prefix}-${String(order.id).substring(0, 8).toUpperCase()}`;

  const v = vendor as {
    whatsapp_number: string;
    pickup_address: string;
    city: string | null;
  };

  const result = await createBostaDelivery({
    centerPhone: center?.phone ?? '',
    centerAddress: String(order.delivery_address ?? ''),
    centerCity: center?.governorate ?? 'Cairo',
    vendorPhone: v.whatsapp_number,
    vendorAddress: v.pickup_address,
    vendorCity: v.city ?? 'Cairo',
    quantity: Number(order.quantity ?? 0),
    reference: ref,
    notes: order.notes != null ? String(order.notes) : '',
  });

  if (!result.success) {
    return NextResponse.json(
      { error: 'bosta_failed', detail: result.error },
      { status: 502 },
    );
  }

  const shippedAt = new Date().toISOString();
  const { error: upErr } = await supabaseAdmin
    .from('card_orders')
    .update({
      bosta_order_id: result.bostaOrderId ?? null,
      tracking_number: result.trackingNumber ?? null,
      status: 'shipped',
      shipped_at: shippedAt,
    })
    .eq('id', id);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    trackingNumber: result.trackingNumber,
    bostaOrderId: result.bostaOrderId,
  });
}
