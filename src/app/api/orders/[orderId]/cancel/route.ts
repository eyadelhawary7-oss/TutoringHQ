import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCenterAuth } from '@/lib/centerAuth';
import { parseBodyWithLimit } from '@/lib/validate';
import {
  applyCardOrderTransition,
  IllegalCardOrderTransitionError,
  type CardOrderLifecycleEvent,
} from '@/lib/cardOrderState';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    reason_code: z.enum(['wrong_quantity', 'wrong_students', 'no_longer_needed', 'other']),
    reason_detail: z.string().max(500).optional(),
  })
  .strict();

function buildCancellationReason(code: z.infer<typeof bodySchema>['reason_code'], detail?: string): string {
  if (code === 'other') return (detail ?? '').trim();
  return code;
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Only the centre owner can cancel card orders' }, { status: 403 });
  }

  const { orderId } = await ctx.params;
  const id = typeof orderId === 'string' ? orderId.trim() : '';
  if (!id) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  let raw: unknown;
  try {
    raw = await parseBodyWithLimit(request, 65536);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.reason_code === 'other') {
    const d = (parsed.data.reason_detail ?? '').trim();
    if (d.length < 10 || d.length > 500) {
      return NextResponse.json({ error: 'reason_detail must be 10–500 characters when reason is other' }, { status: 400 });
    }
  }

  const reason = buildCancellationReason(parsed.data.reason_code, parsed.data.reason_detail);

  const { data: row, error: fetchErr } = await auth.supabaseAdmin
    .from('card_orders')
    .select('id, status')
    .eq('id', id)
    .eq('center_id', auth.centerId)
    .maybeSingle();

  if (fetchErr || !row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const st = String((row as { status?: string }).status ?? '');
  if (!['pending_payment', 'paid', 'vendor_assigned'].includes(st)) {
    return NextResponse.json({ error: 'Order cannot be cancelled at this stage' }, { status: 409 });
  }

  let event: CardOrderLifecycleEvent;
  if (st === 'pending_payment') {
    event = 'cancelled_before_payment';
  } else {
    event = 'cancelled_after_payment';
  }

  try {
    await applyCardOrderTransition(auth.supabaseAdmin, id, event, {
      actorUserId: auth.userId,
      actorRole: auth.role,
      reason,
      metadata: { reason_code: parsed.data.reason_code },
    });
  } catch (e) {
    const msg = e instanceof IllegalCardOrderTransitionError ? e.message : String(e);
    const code = e instanceof IllegalCardOrderTransitionError ? e.code : 'transition_failed';
    const http = code === 'not_found' ? 404 : code === 'reason_required' ? 400 : 409;
    return NextResponse.json({ error: msg, code }, { status: http });
  }

  const refundExpected = event === 'cancelled_after_payment';

  return NextResponse.json({
    success: true,
    refundExpected,
    refundEta: refundExpected ? '7-14 business days' : null,
  });
}
