import { requireSuperAdminApi } from '@/lib/admin-auth';
import { autoBookBosta } from '@/lib/autoBookBosta';
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
    .select('id, bosta_order_id')
    .eq('id', id)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const o = order as { bosta_order_id?: string | null };
  if (o.bosta_order_id) {
    return NextResponse.json({ error: 'already_booked' }, { status: 400 });
  }

  const result = await autoBookBosta(id, supabaseAdmin);

  if (!result.success) {
    if (result.error === 'no_active_vendor') {
      return NextResponse.json({ error: 'no_active_vendor' }, { status: 400 });
    }
    if (result.error === 'order_not_found') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'bosta_failed', detail: result.error },
      { status: 502 },
    );
  }

  return NextResponse.json({
    success: true,
    trackingNumber: result.trackingNumber,
    bostaOrderId: result.bostaOrderId,
  });
}
