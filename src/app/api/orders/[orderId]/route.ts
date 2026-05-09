import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { loadCardOrderDetailForCenter } from '@/lib/loadCardOrderDetail';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  const { orderId } = await ctx.params;
  const id = typeof orderId === 'string' ? orderId.trim() : '';
  if (!id) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const loaded = await loadCardOrderDetailForCenter(auth.supabaseAdmin, auth.centerId, id);
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.message }, { status: loaded.status });
  }

  return NextResponse.json(loaded.payload);
}
