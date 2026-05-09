import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { applyCardOrderTransition, IllegalCardOrderTransitionError } from '@/lib/cardOrderState';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Only the centre owner can mark cards as issued' }, { status: 403 });
  }

  const { orderId } = await ctx.params;
  const id = typeof orderId === 'string' ? orderId.trim() : '';
  if (!id) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const { data: row, error } = await auth.supabaseAdmin
    .from('card_orders')
    .select('id')
    .eq('id', id)
    .eq('center_id', auth.centerId)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    await applyCardOrderTransition(auth.supabaseAdmin, id, 'centre_confirmed_issued', {
      actorUserId: auth.userId,
      actorRole: auth.role,
    });
  } catch (e) {
    const msg = e instanceof IllegalCardOrderTransitionError ? e.message : String(e);
    const code = e instanceof IllegalCardOrderTransitionError ? e.code : 'transition_failed';
    const http = code === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: msg, code }, { status: http });
  }

  return NextResponse.json({ success: true });
}
