import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireCenterAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';
import { ensureCanManageProposals, isValidEgp, mapRespondRpcError } from '@/lib/groupProposals';

const ROUTE_TAG = 'api/center/group-proposals/[proposalId]/respond';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

const CENTER_ACTIONS = new Set(['accept', 'counter', 'decline', 'withdraw']);

/**
 * POST /api/center/group-proposals/[proposalId]/respond
 * Body: { action: 'accept'|'counter'|'decline'|'withdraw', cut_egp?, note? }.
 * Withdraw pulls the center's OWN standing offer (the DB function enforces that
 * the latest offer is the center's); decline rejects the teacher's standing
 * offer. Both directions share this route now that the owner can initiate.
 *
 * Gate: owner/admin (or super-admin), else users.can_manage_students - shared
 * with the create route via ensureCanManageProposals (fails CLOSED, Rule 149).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ proposalId: string }> },
) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  const denied = await ensureCanManageProposals(auth, ROUTE_TAG);
  if (denied) return denied;

  const { proposalId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    action?: unknown;
    cut_egp?: unknown;
    note?: unknown;
  };
  const action = typeof body.action === 'string' && CENTER_ACTIONS.has(body.action)
    ? (body.action as 'accept' | 'counter' | 'decline' | 'withdraw')
    : null;
  const note =
    typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  if (!action) {
    return NextResponse.json({ error: 'Invalid action', code: 'INVALID_ACTION' }, { status: 400 });
  }

  // The proposal must belong to this center (404, no existence oracle).
  const { data: propRow, error: propErr } = await auth.supabaseAdmin
    .from('group_proposals')
    .select('id, center_id, fee_per_class, status')
    .eq('id', proposalId)
    .maybeSingle();
  if (propErr) return fail('proposal_lookup', propErr);
  const prop = propRow as
    | { id: string; center_id: string; fee_per_class: number | string; status: string }
    | null;
  if (!prop || prop.center_id !== auth.centerId) {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
  }
  if (prop.status !== 'open') {
    return NextResponse.json(
      { error: 'Proposal is not open', code: 'NOT_OPEN' },
      { status: 409 },
    );
  }

  let cut: number | null = null;
  if (action === 'counter') {
    if (!isValidEgp(body.cut_egp, 0)) {
      return NextResponse.json({ error: 'Invalid cut', code: 'INVALID_CUT' }, { status: 400 });
    }
    if (body.cut_egp >= Number(prop.fee_per_class)) {
      return NextResponse.json(
        { error: 'Cut must be less than the fee per class', code: 'CUT_NOT_LESS_THAN_FEE' },
        { status: 400 },
      );
    }
    cut = body.cut_egp;
  }

  const { data: rpcData, error: rpcErr } = await auth.supabaseAdmin.rpc(
    'respond_group_proposal',
    {
      p_proposal_id: proposalId,
      p_actor_user_id: auth.userId,
      p_side: 'center',
      p_action: action,
      p_cut_egp: cut,
      p_note: note,
    },
  );
  if (rpcErr) {
    const mapped = mapRespondRpcError(rpcErr as { code?: string; message?: string });
    if (mapped) return mapped;
    return fail('respond_rpc', rpcErr);
  }

  const result = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
    | { proposal_status: string; group_id: string | null }
    | undefined;
  if (!result) {
    return fail('respond_shape', { message: 'respond_group_proposal returned no row' });
  }

  if (action === 'accept') {
    return NextResponse.json({ status: 'accepted', group_id: result.group_id });
  }
  if (action === 'counter') {
    const { data: offerRow } = await auth.supabaseAdmin
      .from('group_proposal_offers')
      .select('id')
      .eq('proposal_id', proposalId)
      .eq('made_by', 'center')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return NextResponse.json({
      status: 'open',
      offer_id: (offerRow as { id: string } | null)?.id ?? null,
    });
  }
  return NextResponse.json({ status: result.proposal_status });
}
