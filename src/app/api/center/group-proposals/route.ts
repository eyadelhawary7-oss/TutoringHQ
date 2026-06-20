import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireCenterAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';
import {
  PROPOSAL_COLUMNS,
  buildProposalList,
  ensureCanManageProposals,
  isValidEgp,
  resolveTargetGroupNames,
  type ProposalRow,
} from '@/lib/groupProposals';
import { resolveTeacherReferralCode } from '@/lib/teacherReferral';

const ROUTE_TAG = 'api/center/group-proposals';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * POST /api/center/group-proposals
 * The OWNER adds a teacher to a group in ONE combined request: pick a group
 * (NEW or an existing plain center group), name the teacher (by their dedicated
 * code OR by picking an already-linked teacher), and set an opening center-cut
 * offer. initiated_by='center', opening offer made_by='center'. The group stays
 * dormant (no student_groups row created/attached) until the teacher accepts;
 * ADR 033 - the cut is only an offer until accepted.
 *
 * Phase 1 - combined link + proposal: if the named teacher is NOT yet an active
 * member of this center, the request ALSO carries the teacher<->center link.
 * We create a pending teacher_center row and mark the proposal carries_link, so
 * the teacher's single accept/counter commits the link atomically
 * (respond_center_group_proposal). An already-active teacher behaves exactly as
 * before (carries_link=false, plain proposal).
 *
 * Gate: owner/admin (or super-admin), else can_manage_students (shared with
 * respond via ensureCanManageProposals). Teacher identity is resolved
 * server-side (code -> teacher_profiles.user_id), never trusted from the body
 * for membership.
 */
export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  const denied = await ensureCanManageProposals(auth, ROUTE_TAG);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    teacher_id?: unknown;
    teacher_code?: unknown;
    subject?: unknown;
    grade_level?: unknown;
    fee_per_class?: unknown;
    opening_cut_egp?: unknown;
    opening_message?: unknown;
    target_group_id?: unknown;
  };

  // Teacher identity: an explicit linked-teacher id, or a dedicated code that we
  // resolve to the teacher's user id. The code path is how the owner adds a
  // teacher the center is NOT yet linked with (the combined link + proposal).
  const teacherCode = typeof body.teacher_code === 'string' ? body.teacher_code.trim() : '';
  let teacherId = typeof body.teacher_id === 'string' ? body.teacher_id.trim() : '';
  if (!teacherId && teacherCode) {
    const resolved = await resolveTeacherReferralCode(auth.supabaseAdmin, teacherCode);
    if (!resolved) {
      return NextResponse.json(
        { error: 'No teacher has that code', code: 'TEACHER_CODE_NOT_FOUND' },
        { status: 404 },
      );
    }
    teacherId = resolved;
  }
  const targetGroupId =
    typeof body.target_group_id === 'string' && body.target_group_id.trim()
      ? body.target_group_id.trim()
      : null;
  const openingMessage =
    typeof body.opening_message === 'string' && body.opening_message.trim()
      ? body.opening_message.trim().slice(0, 500)
      : null;
  const cut = body.opening_cut_egp;

  if (!teacherId) {
    return NextResponse.json({ error: 'Invalid input', code: 'INVALID_INPUT' }, { status: 400 });
  }
  if (!isValidEgp(cut, 0)) {
    return NextResponse.json({ error: 'Invalid cut', code: 'INVALID_CUT' }, { status: 400 });
  }

  // Subject / grade / fee come from the body for a NEW-group proposal, or are
  // derived from the existing group for an ATTACH proposal (never trusted from
  // the body in that case - the group is the source of truth).
  let subject: string;
  let gradeLevel: string | null;
  let fee: number;

  if (targetGroupId) {
    // Attach-to-existing: the target must be a plain center group of THIS center
    // with no teacher yet. fee_per_class and subject are read from the group so
    // the cut validation and the proposal row match what will actually be
    // attached. Final eligibility is re-checked under a row lock in the accept
    // RPC; this is the early, friendly rejection.
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
    if (!group || group.center_id !== auth.centerId) {
      return NextResponse.json({ error: 'Group not found', code: 'GROUP_NOT_FOUND' }, { status: 404 });
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
    subject = (group.subject ?? '').trim().slice(0, 120);
    gradeLevel = null;
    fee = groupFee;
  } else {
    subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    gradeLevel =
      typeof body.grade_level === 'string' && body.grade_level.trim()
        ? body.grade_level.trim().slice(0, 120)
        : null;
    fee = typeof body.fee_per_class === 'number' ? body.fee_per_class : NaN;
    if (subject.length < 1 || subject.length > 120) {
      return NextResponse.json({ error: 'Invalid input', code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (!isValidEgp(fee, 0) || fee <= 0) {
      return NextResponse.json({ error: 'Invalid fee', code: 'INVALID_FEE' }, { status: 400 });
    }
  }

  if (cut >= fee) {
    return NextResponse.json(
      { error: 'Cut must be less than the fee per class', code: 'CUT_NOT_LESS_THAN_FEE' },
      { status: 400 },
    );
  }

  // Membership decides whether this is a plain proposal (teacher already active)
  // or a COMBINED link + proposal (teacher not yet linked). Any existing row is
  // read regardless of status so we can reactivate an inactive/pending one.
  const { data: membership, error: membershipErr } = await auth.supabaseAdmin
    .from('teacher_center')
    .select('id, status')
    .eq('teacher_id', teacherId)
    .eq('center_id', auth.centerId)
    .maybeSingle();
  if (membershipErr) return fail('membership_lookup', membershipErr);
  const membershipRow = membership as { id: string; status: string } | null;
  const alreadyActive = membershipRow?.status === 'active';

  // carries_link is the authoritative flag the teacher's combined accept reads.
  // When the teacher is NOT active-linked, mark it and best-effort create/refresh
  // a PENDING teacher_center row for visibility - but the flag, not the row, is
  // the source of truth: respond_center_group_proposal commits an active
  // membership on accept even if the pending row is missing, so a failed link
  // write here can never strand a group without its teacher's membership.
  const carriesLink = !alreadyActive;
  if (carriesLink) {
    if (membershipRow) {
      const { error: linkErr } = await auth.supabaseAdmin
        .from('teacher_center')
        .update({ status: 'pending', invited_by: auth.userId })
        .eq('id', membershipRow.id);
      if (linkErr) {
        Sentry.withScope((scope) => {
          scope.setTag('route', ROUTE_TAG);
          scope.setTag('step', 'pending_link_update');
          Sentry.captureMessage(`combined link reactivate failed: ${linkErr.message}`, 'warning');
        });
      }
    } else {
      const { error: linkErr } = await auth.supabaseAdmin
        .from('teacher_center')
        .insert({
          teacher_id: teacherId,
          center_id: auth.centerId,
          status: 'pending',
          invited_by: auth.userId,
        });
      // 23505 = a row appeared concurrently; harmless, accept still resolves it.
      if (linkErr && (linkErr as { code?: string }).code !== '23505') {
        Sentry.withScope((scope) => {
          scope.setTag('route', ROUTE_TAG);
          scope.setTag('step', 'pending_link_insert');
          Sentry.captureMessage(`combined link create failed: ${linkErr.message}`, 'warning');
        });
      }
    }
  }

  const { data: inserted, error: insErr } = await auth.supabaseAdmin
    .from('group_proposals')
    .insert({
      teacher_id: teacherId,
      center_id: auth.centerId,
      subject,
      grade_level: gradeLevel,
      fee_per_class: fee,
      opening_message: openingMessage,
      initiated_by: 'center',
      target_group_id: targetGroupId,
      carries_link: carriesLink,
      status: 'open',
    })
    .select('id')
    .single();
  if (insErr) {
    // Partial unique index (teacher, center, subject, grade) WHERE status='open'
    // - one live negotiation per pairing regardless of who started it.
    if ((insErr as { code?: string }).code === '23505') {
      return NextResponse.json(
        { error: 'Proposal already open', code: 'PROPOSAL_ALREADY_OPEN' },
        { status: 409 },
      );
    }
    return fail('insert_proposal', insErr);
  }
  const proposalId = (inserted as { id: string }).id;

  // Opening offer (made_by='center'). A proposal with no offers can never be
  // responded to, so clean it up best-effort if this insert fails.
  const { error: offerErr } = await auth.supabaseAdmin
    .from('group_proposal_offers')
    .insert({ proposal_id: proposalId, made_by: 'center', cut_egp: cut, note: null });
  if (offerErr) {
    await auth.supabaseAdmin.from('group_proposals').delete().eq('id', proposalId);
    return fail('insert_opening_offer', offerErr);
  }

  return NextResponse.json({ proposal_id: proposalId, status: 'open' }, { status: 201 });
}

/**
 * GET /api/center/group-proposals
 * Incoming teacher proposals for the caller's center, with teacher name and
 * phone for the negotiation UI. Proposals + offers are CORE (Rule 151);
 * teacher display info is best-effort.
 */
export async function GET(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabaseAdmin
    .from('group_proposals')
    .select(PROPOSAL_COLUMNS)
    .eq('center_id', auth.centerId)
    .order('created_at', { ascending: false });
  if (error) return fail('list_proposals', error);
  const rows = (data ?? []) as unknown as ProposalRow[];

  const built = await buildProposalList(auth.supabaseAdmin, rows);
  if (built.error) return fail('list_offers', built.error);

  // BEST-EFFORT: teacher display name (teacher_profiles, falling back to
  // users.name) and phone.
  const teacherIds = [...new Set(rows.map((r) => r.teacher_id))];
  const nameByTeacher = new Map<string, string | null>();
  const phoneByTeacher = new Map<string, string | null>();
  if (teacherIds.length > 0) {
    const [profilesRes, usersRes] = await Promise.all([
      auth.supabaseAdmin
        .from('teacher_profiles')
        .select('user_id, display_name')
        .in('user_id', teacherIds),
      auth.supabaseAdmin.from('users').select('id, name, phone').in('id', teacherIds),
    ]);
    if (profilesRes.error || usersRes.error) {
      Sentry.withScope((scope) => {
        scope.setTag('route', ROUTE_TAG);
        scope.setTag('step', 'teacher_display');
        Sentry.captureMessage(
          `group-proposals teacher-display lookup failed: ${
            (profilesRes.error ?? usersRes.error)?.message
          }`,
          'warning',
        );
      });
    }
    for (const u of (usersRes.data ?? []) as { id: string; name: string | null; phone: string | null }[]) {
      nameByTeacher.set(u.id, u.name);
      phoneByTeacher.set(u.id, u.phone);
    }
    for (const p of (profilesRes.data ?? []) as { user_id: string; display_name: string | null }[]) {
      if (p.display_name && p.display_name.trim()) {
        nameByTeacher.set(p.user_id, p.display_name);
      }
    }
  }

  // Attach proposals carry a target_group_id; surface the existing group's name
  // so the negotiation card can label it (best-effort).
  const groupNameById = await resolveTargetGroupNames(auth.supabaseAdmin, built.items);

  // Student count for attach proposals (count-only, never the roster) - the same
  // student_group_members source the Groups page uses, so the numbers agree. The
  // center needs this to weigh an incoming teacher request against the group's
  // size. New-group proposals have no group yet, so they count 0.
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

  const teacherById = new Map(rows.map((r) => [r.id, r.teacher_id]));
  return NextResponse.json({
    proposals: built.items.map((item) => {
      const teacherId = teacherById.get(item.id) ?? '';
      return {
        ...item,
        teacherName: nameByTeacher.get(teacherId) ?? null,
        teacherPhone: phoneByTeacher.get(teacherId) ?? null,
        targetGroupName: item.targetGroupId ? groupNameById.get(item.targetGroupId) ?? null : null,
        studentCount: item.targetGroupId ? countByGroup.get(item.targetGroupId) ?? 0 : 0,
      };
    }),
  });
}
