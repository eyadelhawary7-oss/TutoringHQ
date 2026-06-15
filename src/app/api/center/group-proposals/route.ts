import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireCenterAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';
import {
  PROPOSAL_COLUMNS,
  buildProposalList,
  ensureCanManageProposals,
  isValidEgp,
  type ProposalRow,
} from '@/lib/groupProposals';

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
 * The OWNER starts a group negotiation: pick a linked-active teacher, set the
 * student fee and an opening center-cut offer. Mirrors the teacher-proposes
 * create exactly, just from the center side - initiated_by='center' and the
 * opening offer is made_by='center'. The group stays dormant (no
 * student_groups row) until the teacher accepts; ADR 033 - the cut is only an
 * offer until accepted.
 *
 * Gate: owner/admin (or super-admin), else can_manage_students (shared with
 * respond via ensureCanManageProposals). The target teacher MUST be an active
 * member of this center (teacher_center status='active'); membership comes from
 * the server, never the body alone.
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
    subject?: unknown;
    grade_level?: unknown;
    fee_per_class?: unknown;
    opening_cut_egp?: unknown;
    opening_message?: unknown;
  };

  const teacherId = typeof body.teacher_id === 'string' ? body.teacher_id.trim() : '';
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

  if (!teacherId || subject.length < 1 || subject.length > 120) {
    return NextResponse.json({ error: 'Invalid input', code: 'INVALID_INPUT' }, { status: 400 });
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

  // The teacher must be an ACTIVE member of this center. Owner-initiated
  // proposals only go to teachers the center is already linked with.
  const { data: membership, error: membershipErr } = await auth.supabaseAdmin
    .from('teacher_center')
    .select('teacher_id')
    .eq('teacher_id', teacherId)
    .eq('center_id', auth.centerId)
    .eq('status', 'active')
    .maybeSingle();
  if (membershipErr) return fail('membership_lookup', membershipErr);
  if (!membership) {
    return NextResponse.json(
      { error: 'Teacher is not an active member of this center', code: 'TEACHER_NOT_LINKED' },
      { status: 403 },
    );
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

  const teacherById = new Map(rows.map((r) => [r.id, r.teacher_id]));
  return NextResponse.json({
    proposals: built.items.map((item) => {
      const teacherId = teacherById.get(item.id) ?? '';
      return {
        ...item,
        teacherName: nameByTeacher.get(teacherId) ?? null,
        teacherPhone: phoneByTeacher.get(teacherId) ?? null,
      };
    }),
  });
}
