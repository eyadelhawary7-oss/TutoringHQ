import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireInternalAdminApi, requireSuperAdminApi } from '@/lib/admin-auth';
import { parseBodyWithLimit } from '@/lib/validate';
import {
  applyCardOrderTransition,
  IllegalCardOrderTransitionError,
  type CardOrderLifecycleEvent,
} from '@/lib/cardOrderState';

export const dynamic = 'force-dynamic';

const postSchema = z
  .object({
    orderId: z.string().uuid(),
    action: z.enum(['approve', 'reject', 'mark_paid']),
    reason: z.string().max(500).optional(),
  })
  .strict();

export async function GET(request: NextRequest) {
  const auth = await requireInternalAdminApi(request);
  if (!auth.ok) return auth.response;

  const { data: rows, error } = await auth.supabaseAdmin
    .from('card_orders')
    .select(
      'id, center_id, quantity, total_amount, status, payment_status, refund_status, cancellation_reason, cancelled_at, refund_requested_at, created_at, tracking_number',
    )
    .eq('refund_status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ orders: rows ?? [] });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await parseBodyWithLimit(request, 65536);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 });
  }

  const { orderId, action, reason } = parsed.data;

  let event: CardOrderLifecycleEvent;
  let authHandler: typeof requireSuperAdminApi | typeof requireInternalAdminApi;

  if (action === 'approve') {
    event = 'refund_approved';
    authHandler = requireSuperAdminApi;
  } else if (action === 'reject') {
    event = 'refund_rejected';
    authHandler = requireSuperAdminApi;
    if (!(reason ?? '').trim()) {
      return NextResponse.json({ error: 'reason required for reject' }, { status: 400 });
    }
  } else {
    event = 'refund_paid';
    authHandler = requireInternalAdminApi;
  }

  const auth = await authHandler(request);
  if (!auth.ok) return auth.response;

  try {
    await applyCardOrderTransition(auth.supabaseAdmin, orderId, event, {
      actorUserId: auth.userId,
      actorRole: 'admin',
      reason: reason?.trim() ? reason : undefined,
      metadata: { admin_action: action },
    });
  } catch (e) {
    const msg = e instanceof IllegalCardOrderTransitionError ? e.message : String(e);
    const code = e instanceof IllegalCardOrderTransitionError ? e.code : 'transition_failed';
    const http = code === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: msg, code }, { status: http });
  }

  return NextResponse.json({ success: true });
}
