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
 * Teacher-initiated, two flavours, both with an opening cut offer:
 *  - NEW group: propose a brand-new group to a center (subject/grade/fee in the
 *    body).
 *  - EXISTING group (target_group_id): ask to RUN an existing teacher-less
 *    center group; subject + fee are read FROM the group (never trusted from the
 *    body), and the proposal targets it (target_group_id).
 *
 * FREE zone (requireTeacherAuth, no private gate). Linked-first (Phase 2): the
 * teacher must already be an ACTIVE member of the center - membership comes from
 * auth.centerIds, never the body. initiated_by defaults to 'teacher' and
 * carries_link stays false (no link is ever carried on the teacher side). The
 * opening offer is bound to 0 <= cut < fee exactly as the center-initiated path,
 * and the center accepts/counters/declines it through the same direction-agnostic
 * respond_group_proposal machinery.
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
    target_group_id?: unknown;
  };

  const targetGroupId =
    typeof body.target_group_id === 'string' && body.target_group_id.trim()
      ? body.target_group_id.trim()
      : null;
  const openingMessage =
    typeof body.opening_message === 'string' && body.opening_message.trim()
      ? body.opening_message.trim().slice(0, 500)
      : null;
  const cut = body.opening_cut_egp;

  // The cut is validated up front for BOTH flavours - the lower bound and the
  // numeric shape never depend on which path we take (the fee-relative upper
  // bound is checked once the fee is known below).
  if (!isValidEgp(cut, 0)) {
    return NextResponse.json({ error: 'Invalid cut', code: 'INVALID_CUT' }, { status: 400 });
  }

  // center_id / subject / grade / fee come from the body for a NEW-group
  // proposal, or are derived from the existing group for an ATTACH request (the
  // group is the source of truth - never trusted from the body in that case).
  let centerId: string;
  let subject: string;
  let gradeLevel: string | null;
  let fee: number;

  if (targetGroupId) {
    // Attach-to-existing: the target must be a plain center group with no teacher
    // yet, and the teacher must be an active member of THAT group's center. Final
    // eligibility is re-checked under a row lock in the accept RPC; this is the
    // early, friendly rejection.
    const { data: groupRow, error: groupErr } = await auth.supabaseAdmin
      .from('student_groups')
      .select('id, center_id, kind, teacher_id, subject, fee_per_class')
      .eq('id', targetGroupId)
      .maybeSingle();
    if (groupErr) return fail('target_group_lookup', groupErr);
    const group = groupRow as
      | {
          id: string;
          center_id: string;
          kind: string | null;
          teacher_id: string | null;
          subject: string | null;
          fee_per_class: number | string | null;
        }
      | null;
    if (!group) {
      return NextResponse.json({ error: 'Group not found', code: 'GROUP_NOT_FOUND' }, { status: 404 });
    }
    // Membership decides visibility AND eligibility - an unknown-to-this-teacher
    // group is a 403, the same answer a foreign center would get.
    if (!auth.centerIds.includes(group.center_id)) {
      return NextResponse.json(
        { error: 'Not a member of this center', code: 'NOT_A_MEMBER' },
        { status: 403 },
      );
    }
    if (group.kind !== 'center') {
      return NextResponse.json(
        { error: 'Only center groups can be attached', code: 'GROUP_NOT_ELIGIBLE' },
        { status: 409 },
      );
    }
    if (group.teacher_id) {
      return NextResponse.json(
        { error: 'That group already has a teacher', code: 'GROUP_HAS_TEACHER' },
        { status: 409 },
      );
    }
    const groupFee = group.fee_per_class == null ? NaN : Number(group.fee_per_class);
    if (!Number.isFinite(groupFee) || groupFee <= 0) {
      return NextResponse.json(
        { error: 'That group has no per-class fee set', code: 'GROUP_NO_FEE' },
        { status: 409 },
      );
    }
    centerId = group.center_id;
    subject = (group.subject ?? '').trim().slice(0, 120) || '—';
    gradeLevel = null;
    fee = groupFee;
  } else {
    centerId = typeof body.center_id === 'string' ? body.center_id.trim() : '';
    subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    gradeLevel =
      typeof body.grade_level === 'string' && body.grade_level.trim()
        ? body.grade_level.trim().slice(0, 120)
        : null;
    fee = typeof body.fee_per_class === 'number' ? body.fee_per_class : NaN;
    if (!centerId || subject.length < 1 || subject.length > 120) {
      return NextResponse.json({ error: 'Invalid input', code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (!isValidEgp(fee, 0) || fee <= 0) {
      return NextResponse.json({ error: 'Invalid fee', code: 'INVALID_FEE' }, { status: 400 });
    }
    // Active membership in the named center (auth.centerIds is the membership
    // list resolved server-side from teacher_center status='active').
    if (!auth.centerIds.includes(centerId)) {
      return NextResponse.json(
        { error: 'Not a member of this center', code: 'NOT_A_MEMBER' },
        { status: 403 },
      );
    }
  }

  // Same fee-relative bound the center-initiated path enforces - the teacher path
  // never bypasses it.
  if (cut >= fee) {
    return NextResponse.json(
      { error: 'Cut must be less than the fee per class', code: 'CUT_NOT_LESS_THAN_FEE' },
      { status: 400 },
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
      target_group_id: targetGroupId,
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

  // Student count for the info page: how many students are in the target group.
  // Counted from student_group_members - the SAME source the Groups page uses,
  // so the numbers agree. A privacy choice: the teacher sees the COUNT only,
  // never the roster. New-group proposals have no group yet, so they count 0.
  const countByGroup = new Map<string, number>();
  const attachGroupIds = [
    ...new Set(built.items.map((i) => i.targetGroupId).filter((x): x is string => !!x)),
  ];
  if (attachGroupIds.length > 0) {
    const { data: memberRows, error: membersErr } = await auth.supabaseAdmin
      .from('student_group_members')
      .select('group_id')
      .in('group_id', attachGroupIds);
    if (membersErr) {
      Sentry.withScope((scope) => {
        scope.setTag('route', ROUTE_TAG);
        scope.setTag('step', 'student_count');
        Sentry.captureMessage(`group-proposals student-count failed: ${membersErr.message}`, 'warning');
      });
    } else {
      for (const m of (memberRows ?? []) as { group_id: string }[]) {
        countByGroup.set(m.group_id, (countByGroup.get(m.group_id) ?? 0) + 1);
      }
    }
  }

  return NextResponse.json({
    proposals: built.items.map((item) => ({
      ...item,
      centerName: nameByCenter.get(item.centerId) ?? null,
      centerPhone: phoneByCenter.get(item.centerId) ?? null,
      targetGroupName: item.targetGroupId ? groupNameById.get(item.targetGroupId) ?? null : null,
      studentCount: item.targetGroupId ? countByGroup.get(item.targetGroupId) ?? 0 : 0,
    })),
  });
}
