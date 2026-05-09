import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  const { orderId } = await ctx.params;
  const id = typeof orderId === 'string' ? orderId.trim() : '';
  if (!id) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const { data: row, error } = await auth.supabaseAdmin
    .from('card_orders')
    .select(
      'id, status, payment_status, total_amount, quantity, delivery_address, delivery_governorate, delivery_phone, notes, card_style, created_at',
    )
    .eq('id', id)
    .eq('center_id', auth.centerId)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(row);
}
