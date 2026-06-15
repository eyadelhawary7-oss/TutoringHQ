import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireCenterAuth } from '@/lib/centerAuth';
import { ensureCanManageProposals } from '@/lib/groupProposals';

const ROUTE_TAG = 'api/center/teachers';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * GET /api/center/teachers
 * Active teachers linked to the caller's center, for the owner-initiated group
 * proposal picker. Membership lives in teacher_center (teacher_id = user id);
 * display name + subject are joined from teacher_profiles (best-effort, name
 * falls back to users.name). Gated like a proposal mutation - only those who
 * can start a proposal need this list.
 */
export async function GET(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  const denied = await ensureCanManageProposals(auth, ROUTE_TAG);
  if (denied) return denied;

  const { data: memberships, error: membersErr } = await auth.supabaseAdmin
    .from('teacher_center')
    .select('teacher_id')
    .eq('center_id', auth.centerId)
    .eq('status', 'active');
  if (membersErr) return fail('membership_lookup', membersErr);

  const teacherIds = Array.from(
    new Set(((memberships ?? []) as { teacher_id: string }[]).map((m) => m.teacher_id)),
  );
  if (teacherIds.length === 0) {
    return NextResponse.json({ teachers: [] });
  }

  // Display name + subject (best-effort): teacher_profiles.display_name, then
  // users.name as a fallback.
  const nameById = new Map<string, string | null>();
  const subjectById = new Map<string, string | null>();
  const [profilesRes, usersRes] = await Promise.all([
    auth.supabaseAdmin
      .from('teacher_profiles')
      .select('user_id, display_name, subject')
      .in('user_id', teacherIds),
    auth.supabaseAdmin.from('users').select('id, name').in('id', teacherIds),
  ]);
  if (profilesRes.error || usersRes.error) {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'teacher_display');
      Sentry.captureMessage(
        `center teachers display lookup failed: ${
          (profilesRes.error ?? usersRes.error)?.message
        }`,
        'warning',
      );
    });
  }
  for (const u of (usersRes.data ?? []) as { id: string; name: string | null }[]) {
    nameById.set(u.id, u.name);
  }
  for (const p of (profilesRes.data ?? []) as {
    user_id: string;
    display_name: string | null;
    subject: string | null;
  }[]) {
    if (p.display_name && p.display_name.trim()) nameById.set(p.user_id, p.display_name);
    subjectById.set(p.user_id, p.subject);
  }

  const teachers = teacherIds
    .map((id) => ({
      id,
      name: nameById.get(id) ?? null,
      subject: subjectById.get(id) ?? null,
    }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  return NextResponse.json({ teachers });
}
