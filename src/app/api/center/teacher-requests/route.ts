import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireOwnerAdminCenter } from '@/lib/requireOwnerAdminCenter';

const ROUTE_TAG = 'api/center/teacher-requests';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * GET /api/center/teacher-requests
 * Pending teacher join requests for the caller's centre (owner/admin only).
 * teacher_center_requests.teacher_id references auth.users, which PostgREST
 * cannot embed against, so the teacher display name + subject are joined in a
 * second lookup against teacher_profiles (user_id -> teacher_id).
 */
export async function GET(request: NextRequest) {
  const ctx = await requireOwnerAdminCenter(request);
  if (ctx instanceof NextResponse) return ctx;

  const { data, error } = await ctx.supabaseAdmin
    .from('teacher_center_requests')
    .select('id, message, created_at, teacher_id')
    .eq('center_id', ctx.centerId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) return fail('list_pending', error);

  type Row = { id: string; message: string | null; created_at: string; teacher_id: string };
  const rows = (data ?? []) as Row[];
  const teacherIds = Array.from(new Set(rows.map((r) => r.teacher_id)));

  const profileMap = new Map<string, { display_name: string | null; subject: string | null }>();
  if (teacherIds.length > 0) {
    const { data: profiles, error: profErr } = await ctx.supabaseAdmin
      .from('teacher_profiles')
      .select('user_id, display_name, subject')
      .in('user_id', teacherIds);
    if (profErr) return fail('teacher_profiles', profErr);
    for (const p of (profiles ?? []) as {
      user_id: string;
      display_name: string | null;
      subject: string | null;
    }[]) {
      profileMap.set(p.user_id, { display_name: p.display_name, subject: p.subject });
    }
  }

  const requests = rows.map((r) => {
    const profile = profileMap.get(r.teacher_id);
    return {
      id: r.id,
      teacherName: profile?.display_name ?? null,
      subject: profile?.subject ?? null,
      message: r.message,
      createdAt: r.created_at,
    };
  });

  // Centre groups for the accept-modal dropdown (assign teacher to a group).
  const { data: groupRows, error: groupsErr } = await ctx.supabaseAdmin
    .from('student_groups')
    .select('id, name')
    .eq('center_id', ctx.centerId)
    .eq('kind', 'center')
    .order('name', { ascending: true });
  if (groupsErr) return fail('groups_list', groupsErr);
  const groups = ((groupRows ?? []) as { id: string; name: string | null }[]).map((g) => ({
    id: g.id,
    name: g.name,
  }));

  return NextResponse.json({ requests, groups });
}
