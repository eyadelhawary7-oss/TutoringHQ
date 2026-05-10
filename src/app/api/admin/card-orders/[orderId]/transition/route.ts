import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { parseBodyWithLimit } from '@/lib/validate';
import {
  applyCardOrderTransition,
  IllegalCardOrderTransitionError,
  type CardOrderLifecycleEvent,
} from '@/lib/cardOrderState';
import {
  assertAdminCardOrderTransitionEventAllowed,
  AdminCardOrderTransitionNotAllowedError,
} from '@/lib/adminCardOrderTransition';

const CARD_ORDER_TRANSITION_INVALID = 'CARD_ORDER_TRANSITION_INVALID';

export async function POST(request: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const adminCtx = await getAdminContext(request);
  if (!adminCtx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (adminCtx.internalRole === 'internal_viewer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { orderId } = await ctx.params;
  const id = typeof orderId === 'string' ? orderId.trim() : '';
  if (!id) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  let body: unknown;
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const b = body as { event?: unknown; reason?: unknown };
  const eventRaw = typeof b.event === 'string' ? b.event.trim() : '';
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';

  if (!eventRaw || reason.length < 10 || reason.length > 500) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  try {
    assertAdminCardOrderTransitionEventAllowed(eventRaw);
  } catch (e) {
    if (e instanceof AdminCardOrderTransitionNotAllowedError) {
      return NextResponse.json({ error: 'event_not_admin_allowed' }, { status: 400 });
    }
    throw e;
  }

  const event = eventRaw as CardOrderLifecycleEvent;

  try {
    const result = await applyCardOrderTransition(adminCtx.supabaseAdmin, id, event, {
      actorUserId: adminCtx.userId,
      actorRole: adminCtx.internalRole,
      reason,
    });
    return NextResponse.json({
      success: true,
      status: result.status,
      payment_status: result.payment_status,
      refund_status: result.refund_status,
    });
  } catch (e) {
    if (e instanceof IllegalCardOrderTransitionError) {
      return NextResponse.json(
        { error: CARD_ORDER_TRANSITION_INVALID, message: e.message },
        { status: 409 },
      );
    }
    console.error('[POST /api/admin/card-orders/transition]', e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
