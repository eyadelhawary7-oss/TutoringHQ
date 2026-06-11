import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';
import { isValidEgp, mapRespondRpcError } from '@/lib/groupProposals';

const ROUTE_TAG = 'api/teacher/group-proposals/[proposalId]/respond';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

const TEACHER_ACTIONS = new Set(['accept', 'counter', 'decline', 'withdraw']);

/**
 * POST /api/teacher/group-proposals/[proposalId]/respond
 * Body: { action: 'accept'|'counter'|'decline'|'withdraw', cut_egp?, note? }.
 *
 * The negotiation state machine is respond_group_proposal in the DB: turn
 * order (accept/counter/decline only when the latest offer is the center's),
 * withdraw-any-time-while-open, accepted_offer_id snapping and the
 * student_groups creation on accept all happen there atomically. This route
 * does authn (requireTeacherAuth), ownership, and input validation.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ proposalId: string }> },
) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  const { proposalId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    action?: unknown;
    cut_egp?: unknown;
    note?: unknown;
  };
  const action = typeof body.action === 'string' && TEACHER_ACTIONS.has(body.action)
    ? (body.action as 'accept' | 'counter' | 'decline' | 'withdraw')
    : null;
  const note =
    typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  if (!action) {
    return NextResponse.json({ error: 'Invalid action', code: 'INVALID_ACTION' }, { status: 400 });
  }

  // Ownership: the proposal must be the caller's. A foreign or unknown id is
  // indistinguishable on purpose (404, no existence oracle).
  const { data: propRow, error: propErr } = await auth.supabaseAdmin
    .from('group_proposals')
    .select('id, teacher_id, fee_per_class, status')
    .eq('id', proposalId)
    .maybeSingle();
  if (propErr) return fail('proposal_lookup', propErr);
  const prop = propRow as
    | { id: string; teacher_id: string; fee_per_class: number | string; status: string }
    | null;
  if (!prop || prop.teacher_id !== auth.userId) {
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
      p_side: 'teacher',
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
    // Display data: the id of the offer just inserted (latest own offer).
    const { data: offerRow } = await auth.supabaseAdmin
      .from('group_proposal_offers')
      .select('id')
      .eq('proposal_id', proposalId)
      .eq('made_by', 'teacher')
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
