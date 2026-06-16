import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireCenterAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';
import { ensureCanManageProposals } from '@/lib/groupProposals';
import { mapSlotRpcError } from '@/lib/groupSlots';

const ROUTE_TAG = 'api/center/group-slots/[slotProposalId]/respond';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

const ACTIONS = new Set(['confirm', 'decline']);

/**
 * POST /api/center/group-slots/[slotProposalId]/respond
 * Body: { action: 'confirm'|'decline', room_id? }.
 * confirm -> confirm_group_slot books a schedule_slots row to the group (with the
 * room/teacher conflict guard); decline -> decline_group_slot frees it. Center
 * scoping + conflict guard live in the RPCs; this route does authn, CSRF, gate.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slotProposalId: string }> },
) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  const denied = await ensureCanManageProposals(auth, ROUTE_TAG);
  if (denied) return denied;

  const { slotProposalId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    action?: unknown;
    room_id?: unknown;
  };
  const action = typeof body.action === 'string' && ACTIONS.has(body.action) ? body.action : null;
  const roomId = typeof body.room_id === 'string' && body.room_id ? body.room_id : null;
  if (!action) {
    return NextResponse.json({ error: 'Invalid action', code: 'INVALID_ACTION' }, { status: 400 });
  }

  if (action === 'confirm') {
    const { data, error } = await auth.supabaseAdmin.rpc('confirm_group_slot', {
      p_slot_proposal_id: slotProposalId,
      p_center_id: auth.centerId,
      p_actor_user_id: auth.userId,
      p_room_id: roomId,
    });
    if (error) {
      const mapped = mapSlotRpcError(error as { code?: string; message?: string });
      if (mapped) return mapped;
      return fail('confirm_rpc', error);
    }
    const slot = (Array.isArray(data) ? data[0] : data) as { id: string } | undefined;
    return NextResponse.json({ status: 'confirmed', slot_id: slot?.id ?? null });
  }

  // decline
  const { error } = await auth.supabaseAdmin.rpc('decline_group_slot', {
    p_slot_proposal_id: slotProposalId,
    p_center_id: auth.centerId,
    p_actor_user_id: auth.userId,
  });
  if (error) {
    const mapped = mapSlotRpcError(error as { code?: string; message?: string });
    if (mapped) return mapped;
    return fail('decline_rpc', error);
  }
  return NextResponse.json({ status: 'declined' });
}
