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

const SORT_COLUMNS = new Set(['refund_requested_at', 'total_amount', 'created_at', 'quantity']);

const postSchema = z
  .object({
    orderId: z.string().uuid(),
    action: z.enum(['approve', 'reject', 'mark_paid']),
    reason: z.string().max(500).optional(),
    external_reference: z.string().max(200).optional(),
  })
  .strict();

export async function GET(request: NextRequest) {
  const auth = await requireInternalAdminApi(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status') ?? 'all';
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '20') || 20));
  const rawSort = url.searchParams.get('sort') ?? 'refund_requested_at';
  const sortCol = SORT_COLUMNS.has(rawSort) ? rawSort : 'refund_requested_at';
  const dirAsc = url.searchParams.get('dir') === 'asc';

  let listQuery = auth.supabaseAdmin
    .from('card_orders')
    .select(
      `
      id,
      center_id,
      quantity,
      total_amount,
      status,
      refund_status,
      refund_requested_at,
      created_at,
      centers ( name ),
      card_order_items ( count )
    `,
      { count: 'exact' },
    )
    .not('refund_status', 'is', null);

  if (statusFilter !== 'all') {
    listQuery = listQuery.eq('refund_status', statusFilter);
  }

  listQuery = listQuery.order(sortCol, {
    ascending: dirAsc,
    nullsFirst: dirAsc,
  });

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  listQuery = listQuery.range(from, to);

  const [{ data: rows, error, count }, pendingHead] = await Promise.all([
    listQuery,
    auth.supabaseAdmin
      .from('card_orders')
      .select('id', { count: 'exact', head: true })
      .eq('refund_status', 'pending'),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    orders: rows ?? [],
    total: count ?? 0,
    page,
    pageSize,
    pendingCount: pendingHead.count ?? 0,
  });
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

  const { orderId, action, reason, external_reference } = parsed.data;

  let event: CardOrderLifecycleEvent;
  let authHandler: typeof requireSuperAdminApi | typeof requireInternalAdminApi;

  if (action === 'approve') {
    event = 'refund_approved';
    authHandler = requireSuperAdminApi;
  } else if (action === 'reject') {
    event = 'refund_rejected';
    authHandler = requireSuperAdminApi;
    const r = (reason ?? '').trim();
    if (r.length < 10 || r.length > 500) {
      return NextResponse.json({ error: 'reason must be 10–500 characters' }, { status: 400 });
    }
  } else {
    event = 'refund_paid';
    authHandler = requireInternalAdminApi;
    const ref = (external_reference ?? '').trim();
    if (!ref.length) {
      return NextResponse.json({ error: 'external_reference required for mark_paid' }, { status: 400 });
    }
  }

  const auth = await authHandler(request);
  if (!auth.ok) return auth.response;

  const trimmedReason = reason?.trim();
  const trimmedExt = external_reference?.trim();

  try {
    await applyCardOrderTransition(auth.supabaseAdmin, orderId, event, {
      actorUserId: auth.userId,
      actorRole: 'admin',
      reason: action === 'reject' && trimmedReason ? trimmedReason : undefined,
      metadata: {
        admin_action: action,
        ...(action === 'mark_paid' && trimmedExt ? { paymob_refund_id: trimmedExt } : {}),
      },
    });
  } catch (e) {
    const msg = e instanceof IllegalCardOrderTransitionError ? e.message : String(e);
    const code = e instanceof IllegalCardOrderTransitionError ? e.code : 'transition_failed';
    const http = code === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: msg, code }, { status: http });
  }

  return NextResponse.json({ success: true });
}
