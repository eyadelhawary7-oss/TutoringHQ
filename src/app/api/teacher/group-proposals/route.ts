import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';
import {
  PROPOSAL_COLUMNS,
  buildProposalList,
  isValidEgp,
  resolveTargetGroupNames,
  type ProposalRow,
} from '@/lib/groupProposals';
import { ownerContactByCenterId, resolveOwnerWaPhoneCached } from '@/lib/ownerPhone';

const ROUTE_TAG = 'api/teacher/group-proposals';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * POST /api/teacher/group-proposals
 * A teacher proposes a new center group to a center they are an ACTIVE member
 * of, with an opening cut offer. FREE zone (requireTeacherAuth, no private
 * gate). Membership comes from auth.centerIds - never from the body alone.
 */
export async function POST(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    center_id?: unknown;
    subject?: unknown;
    grade_level?: unknown;
    fee_per_class?: unknown;
    opening_cut_egp?: unknown;
    opening_message?: unknown;
  };

  const centerId = typeof body.center_id === 'string' ? body.center_id.trim() : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const gradeLevel =
    typeof body.grade_level === 'string' && body.grade_level.trim()
      ? body.grade_level.trim().slice(0, 120)
      : null;
  const openingMessage =
    typeof body.opening_message === 'string' && body.opening_message.trim()
      ? body.opening_message.trim().slice(0, 500)
      : null;
  const fee = body.fee_per_class;
  const cut = body.opening_cut_egp;

  if (!centerId || subject.length < 1 || subject.length > 120) {
    return NextResponse.json(
      { error: 'Invalid input', code: 'INVALID_INPUT' },
      { status: 400 },
    );
  }
  if (!isValidEgp(fee, 0) || fee <= 0) {
    return NextResponse.json({ error: 'Invalid fee', code: 'INVALID_FEE' }, { status: 400 });
  }
  if (!isValidEgp(cut, 0)) {
    return NextResponse.json({ error: 'Invalid cut', code: 'INVALID_CUT' }, { status: 400 });
  }
  if (cut >= fee) {
    return NextResponse.json(
      { error: 'Cut must be less than the fee per class', code: 'CUT_NOT_LESS_THAN_FEE' },
      { status: 400 },
    );
  }

  // Active membership in the named center (auth.centerIds is the membership
  // list resolved server-side from teacher_center status='active').
  if (!auth.centerIds.includes(centerId)) {
    return NextResponse.json(
      { error: 'Not a member of this center', code: 'NOT_A_MEMBER' },
      { status: 403 },
    );
  }

  const { data: inserted, error: insErr } = await auth.supabaseAdmin
    .from('group_proposals')
    .insert({
      teacher_id: auth.userId,
      center_id: centerId,
      subject,
      grade_level: gradeLevel,
      fee_per_class: fee,
      opening_message: openingMessage,
      status: 'open',
    })
    .select('id')
    .single();
  if (insErr) {
    // Partial unique index (teacher, center, subject, grade) WHERE status='open'.
    if ((insErr as { code?: string }).code === '23505') {
      return NextResponse.json(
        { error: 'Proposal already open', code: 'PROPOSAL_ALREADY_OPEN' },
        { status: 409 },
      );
    }
    return fail('insert_proposal', insErr);
  }
  const proposalId = (inserted as { id: string }).id;

  // Opening offer (made_by='teacher'). The BEFORE INSERT guard re-checks the
  // proposal is open and cut <= fee. A failure here leaves a proposal with no
  // offers - nobody could ever respond to it - so clean it up best-effort.
  const { error: offerErr } = await auth.supabaseAdmin
    .from('group_proposal_offers')
    .insert({ proposal_id: proposalId, made_by: 'teacher', cut_egp: cut, note: null });
  if (offerErr) {
    await auth.supabaseAdmin.from('group_proposals').delete().eq('id', proposalId);
    return fail('insert_opening_offer', offerErr);
  }

  return NextResponse.json({ proposal_id: proposalId, status: 'open' }, { status: 201 });
}

/**
 * GET /api/teacher/group-proposals
 * The teacher's proposals with center name, offer history, latest offer and
 * whose turn it is. Proposals + offers are CORE (Rule 151: 500 on error, the
 * action buttons depend on them); center display names are best-effort.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabaseAdmin
    .from('group_proposals')
    .select(PROPOSAL_COLUMNS)
    .eq('teacher_id', auth.userId)
    .order('created_at', { ascending: false });
  if (error) return fail('list_proposals', error);
  const rows = (data ?? []) as unknown as ProposalRow[];

  const built = await buildProposalList(auth.supabaseAdmin, rows);
  if (built.error) return fail('list_offers', built.error);

  // BEST-EFFORT: center display name + the center's contact phone (so the
  // teacher can reach out about any request). Phone resolves via the canonical
  // owner-phone chain (auth-email digits -> users.phone -> centers.phone).
  const nameByCenter = new Map<string, string | null>();
  const phoneByCenter = new Map<string, string | null>();
  const centerIds = [...new Set(rows.map((r) => r.center_id))];
  if (centerIds.length > 0) {
    const { data: centerRows, error: centersErr } = await auth.supabaseAdmin
      .from('centers')
      .select('id, name, phone')
      .in('id', centerIds);
    if (centersErr) {
      Sentry.withScope((scope) => {
        scope.setTag('route', ROUTE_TAG);
        scope.setTag('step', 'center_names');
        Sentry.captureMessage(
          `group-proposals center-name lookup failed: ${centersErr.message}`,
          'warning',
        );
      });
    } else {
      const centerPhoneFallback = new Map<string, string | null>();
      for (const c of (centerRows ?? []) as { id: string; name: string | null; phone: string | null }[]) {
        nameByCenter.set(c.id, c.name);
        centerPhoneFallback.set(c.id, c.phone ?? null);
      }
      // Owner contact per center, then the WhatsApp-ready phone (best-effort).
      const ownerByCenter = await ownerContactByCenterId(auth.supabaseAdmin, centerIds);
      const phoneCache = new Map<string, string | null>();
      for (const cid of centerIds) {
        const owner = ownerByCenter.get(cid) ?? null;
        const phone = await resolveOwnerWaPhoneCached(
          auth.supabaseAdmin,
          owner?.authId ?? null,
          owner?.userPhone ?? null,
          centerPhoneFallback.get(cid) ?? null,
          phoneCache,
        );
        phoneByCenter.set(cid, phone);
      }
    }
  }

  // Attach proposals: label by the existing group's name (best-effort).
  const groupNameById = await resolveTargetGroupNames(auth.supabaseAdmin, built.items);

  return NextResponse.json({
    proposals: built.items.map((item) => ({
      ...item,
      centerName: nameByCenter.get(item.centerId) ?? null,
      centerPhone: phoneByCenter.get(item.centerId) ?? null,
      targetGroupName: item.targetGroupId ? groupNameById.get(item.targetGroupId) ?? null : null,
    })),
  });
}
