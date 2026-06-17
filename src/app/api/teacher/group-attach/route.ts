import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';
import { isValidEgp, prepareTeacherByCodeLink, resolveCenterByCode } from '@/lib/groupProposals';

const ROUTE_TAG = 'api/teacher/group-attach';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * POST /api/teacher/group-attach
 * Flip one of the teacher's OWN solo (private) groups to center-attached: the
 * teacher proposes a center + opening cut for a group they already run. This is
 * a teacher-initiated group_proposal targeting the teacher's own private group
 * (target_group_id). On center accept, respond_group_proposal flips the group
 * (center_id + cut + kind->'center'); the roster never moves and past billing is
 * untouched (future-only).
 *
 * Linked-first: the teacher must already be an ACTIVE member of the target
 * center (auth.centerIds). To bring a group to a NEW center, join it by code
 * first (the center approves), then attach. FREE zone (requireTeacherAuth) - the
 * group is the teacher's; the center side gates its own acceptance.
 */
export async function POST(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    group_id?: unknown;
    center_id?: unknown;
    center_code?: unknown;
    opening_cut_egp?: unknown;
    opening_message?: unknown;
  };

  const groupId = typeof body.group_id === 'string' ? body.group_id.trim() : '';
  const centerCode = typeof body.center_code === 'string' ? body.center_code.trim() : '';
  const openingMessage =
    typeof body.opening_message === 'string' && body.opening_message.trim()
      ? body.opening_message.trim().slice(0, 500)
      : null;
  const cut = body.opening_cut_egp;

  if (!groupId) {
    return NextResponse.json({ error: 'Invalid input', code: 'INVALID_INPUT' }, { status: 400 });
  }
  if (!isValidEgp(cut, 0)) {
    return NextResponse.json({ error: 'Invalid cut', code: 'INVALID_CUT' }, { status: 400 });
  }

  // Resolve the target center. By-code (Ref 2 & 3): reach a center the teacher is
  // NOT yet a member of by its code; a pending link is prepared and the center's
  // accept commits the membership AND flips the group atomically. Member path:
  // the teacher must already be an active member (auth.centerIds).
  let centerId: string;
  let carriesLink = false;
  if (centerCode) {
    const center = await resolveCenterByCode(auth.supabaseAdmin, centerCode);
    if (!center) {
      return NextResponse.json(
        { error: 'No center has that code', code: 'CENTER_CODE_NOT_FOUND' },
        { status: 404 },
      );
    }
    centerId = center.id;
    const prepared = await prepareTeacherByCodeLink(
      auth.supabaseAdmin,
      auth.userId,
      centerId,
      auth.userId,
      ROUTE_TAG,
    );
    carriesLink = prepared.carriesLink;
  } else {
    centerId = typeof body.center_id === 'string' ? body.center_id.trim() : '';
    if (!centerId) {
      return NextResponse.json({ error: 'Invalid input', code: 'INVALID_INPUT' }, { status: 400 });
    }
    // Active membership in the target center (resolved server-side). Without it the
    // teacher must reach the center by code instead.
    if (!auth.centerIds.includes(centerId)) {
      return NextResponse.json(
        { error: 'Not a member of this center', code: 'NOT_A_MEMBER' },
        { status: 403 },
      );
    }
  }

  // The group must be the caller's OWN solo private group. A foreign or unknown
  // group is indistinguishable on purpose (404, no existence oracle).
  const { data: groupRow, error: groupErr } = await auth.supabaseAdmin
    .from('student_groups')
    .select('id, teacher_id, kind, center_id, subject, fee_per_class')
    .eq('id', groupId)
    .maybeSingle();
  if (groupErr) return fail('group_lookup', groupErr);
  const group = groupRow as
    | {
        id: string;
        teacher_id: string | null;
        kind: string | null;
        center_id: string | null;
        subject: string | null;
        fee_per_class: number | string | null;
      }
    | null;
  if (!group || group.teacher_id !== auth.userId) {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
  }
  if (group.kind !== 'private' || group.center_id !== null) {
    return NextResponse.json(
      { error: 'That group is not a solo group', code: 'GROUP_NOT_SOLO' },
      { status: 409 },
    );
  }
  const fee = group.fee_per_class == null ? NaN : Number(group.fee_per_class);
  if (!Number.isFinite(fee) || fee <= 0) {
    return NextResponse.json(
      { error: 'That group has no per-class fee set', code: 'GROUP_NO_FEE' },
      { status: 409 },
    );
  }
  // Same cut bound the rest of the negotiation enforces: 0 <= cut < fee.
  if (cut >= fee) {
    return NextResponse.json(
      { error: 'Cut must be less than the fee per class', code: 'CUT_NOT_LESS_THAN_FEE' },
      { status: 400 },
    );
  }

  const subject = (group.subject ?? '').trim().slice(0, 120) || '—';

  const { data: inserted, error: insErr } = await auth.supabaseAdmin
    .from('group_proposals')
    .insert({
      teacher_id: auth.userId,
      center_id: centerId,
      subject,
      grade_level: null,
      fee_per_class: fee,
      opening_message: openingMessage,
      target_group_id: groupId,
      carries_link: carriesLink,
      status: 'open',
    })
    .select('id')
    .single();
  if (insErr) {
    // Partial unique index on target_group_id WHERE status='open' - one live
    // attach negotiation per group regardless of who started it.
    if ((insErr as { code?: string }).code === '23505') {
      return NextResponse.json(
        { error: 'Proposal already open', code: 'PROPOSAL_ALREADY_OPEN' },
        { status: 409 },
      );
    }
    return fail('insert_proposal', insErr);
  }
  const proposalId = (inserted as { id: string }).id;

  // Opening offer (made_by='teacher'). A proposal with no offers can never be
  // responded to, so clean it up best-effort if this insert fails.
  const { error: offerErr } = await auth.supabaseAdmin
    .from('group_proposal_offers')
    .insert({ proposal_id: proposalId, made_by: 'teacher', cut_egp: cut, note: null });
  if (offerErr) {
    await auth.supabaseAdmin.from('group_proposals').delete().eq('id', proposalId);
    return fail('insert_opening_offer', offerErr);
  }

  return NextResponse.json({ proposal_id: proposalId, status: 'open' }, { status: 201 });
}
