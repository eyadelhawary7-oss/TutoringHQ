import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireOwnerAdminCenter } from '@/lib/requireOwnerAdminCenter';
import { validateCSRFRequest } from '@/lib/csrf';
import { resolveTeacherReferralCode } from '@/lib/teacherReferral';

const ROUTE_TAG = 'api/center/teacher-links';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * POST /api/center/teacher-links
 * Owner-initiated "add a teacher by their code". The owner types the teacher's
 * dedicated code (teacher_profiles.referral_code); we resolve it to the teacher
 * and open a PENDING teacher_center_requests row with initiated_by='center'.
 * Linking stays TWO-SIDED: no membership is created here - the teacher must
 * accept (POST /api/teacher/center-requests/[requestId]) before the
 * teacher_center row exists. Owner/admin only.
 */
export async function POST(request: NextRequest) {
  const ctx = await requireOwnerAdminCenter(request);
  if (ctx instanceof NextResponse) return ctx;

  if (!validateCSRFRequest(request, ctx.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { code?: unknown; message?: unknown };
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const message =
    typeof body.message === 'string' && body.message.trim().length > 0
      ? body.message.trim().slice(0, 500)
      : null;
  if (!code) {
    return NextResponse.json({ error: 'Teacher code required', code: 'INVALID_INPUT' }, { status: 400 });
  }

  // Resolve the teacher's dedicated code -> user id (trim/uppercase handled in
  // the resolver; an unknown code returns null, never throws).
  const teacherId = await resolveTeacherReferralCode(ctx.supabaseAdmin, code);
  if (!teacherId) {
    return NextResponse.json(
      { error: 'No teacher with that code', code: 'TEACHER_CODE_NOT_FOUND' },
      { status: 404 },
    );
  }

  // Already an active member? Nothing to request.
  const { data: membership, error: memErr } = await ctx.supabaseAdmin
    .from('teacher_center')
    .select('teacher_id')
    .eq('teacher_id', teacherId)
    .eq('center_id', ctx.centerId)
    .eq('status', 'active')
    .maybeSingle();
  if (memErr) return fail('membership_check', memErr);
  if (membership) {
    return NextResponse.json({ error: 'Already a member', code: 'ALREADY_A_MEMBER' }, { status: 409 });
  }

  // Open the pending, center-initiated request. The partial unique index
  // (teacher_id, center_id) WHERE status='pending' surfaces duplicates as 23505
  // regardless of which side opened the pending request.
  const { data: inserted, error: insErr } = await ctx.supabaseAdmin
    .from('teacher_center_requests')
    .insert({
      teacher_id: teacherId,
      center_id: ctx.centerId,
      status: 'pending',
      initiated_by: 'center',
      message,
    })
    .select('id')
    .single();
  if (insErr) {
    if ((insErr as { code?: string }).code === '23505') {
      return NextResponse.json(
        { error: 'Request already pending', code: 'REQUEST_ALREADY_PENDING' },
        { status: 409 },
      );
    }
    return fail('insert_request', insErr);
  }

  // Teacher display name for the confirmation (best-effort).
  const { data: profile } = await ctx.supabaseAdmin
    .from('teacher_profiles')
    .select('display_name')
    .eq('user_id', teacherId)
    .maybeSingle();
  const teacherName = (profile as { display_name: string | null } | null)?.display_name ?? null;

  return NextResponse.json(
    { requestId: (inserted as { id: string }).id, teacherName },
    { status: 201 },
  );
}

/**
 * GET /api/center/teacher-links
 * Outgoing center-initiated link requests for this center (so the owner sees
 * who they've invited and whether it's still pending). Owner/admin only.
 */
export async function GET(request: NextRequest) {
  const ctx = await requireOwnerAdminCenter(request);
  if (ctx instanceof NextResponse) return ctx;

  const { data, error } = await ctx.supabaseAdmin
    .from('teacher_center_requests')
    .select('id, status, message, created_at, responded_at, teacher_id')
    .eq('center_id', ctx.centerId)
    .eq('initiated_by', 'center')
    .order('created_at', { ascending: false });
  if (error) return fail('list_outgoing', error);

  type Row = {
    id: string;
    status: string;
    message: string | null;
    created_at: string;
    responded_at: string | null;
    teacher_id: string;
  };
  const rows = (data ?? []) as Row[];
  const teacherIds = Array.from(new Set(rows.map((r) => r.teacher_id)));

  const nameById = new Map<string, string | null>();
  if (teacherIds.length > 0) {
    const { data: profiles } = await ctx.supabaseAdmin
      .from('teacher_profiles')
      .select('user_id, display_name')
      .in('user_id', teacherIds);
    for (const p of (profiles ?? []) as { user_id: string; display_name: string | null }[]) {
      nameById.set(p.user_id, p.display_name);
    }
  }

  const requests = rows.map((r) => ({
    id: r.id,
    status: r.status,
    message: r.message,
    createdAt: r.created_at,
    respondedAt: r.responded_at,
    teacherName: nameById.get(r.teacher_id) ?? null,
  }));

  return NextResponse.json({ requests });
}
