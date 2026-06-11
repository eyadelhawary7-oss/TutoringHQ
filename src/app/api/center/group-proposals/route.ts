import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireCenterAuth } from '@/lib/centerAuth';
import { PROPOSAL_COLUMNS, buildProposalList, type ProposalRow } from '@/lib/groupProposals';

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
