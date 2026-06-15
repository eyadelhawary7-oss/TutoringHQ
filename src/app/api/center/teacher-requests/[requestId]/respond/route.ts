import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireOwnerAdminCenter } from '@/lib/requireOwnerAdminCenter';
import { validateCSRFRequest } from '@/lib/csrf';

const ROUTE_TAG = 'api/center/teacher-requests/[requestId]/respond';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * POST /api/center/teacher-requests/[requestId]/respond
 * Owner/admin accepts or declines a pending teacher join request.
 *
 * On accept: mark accepted -> create the teacher_center membership (active) ->
 * optionally assign the teacher to a centre group. A teacher is linked to a
 * centre group via student_groups.teacher_id (center groups carry kind='center'
 * and a single teacher_id), so assignment is an UPDATE of that column.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const ctx = await requireOwnerAdminCenter(request);
  if (ctx instanceof NextResponse) return ctx;

  if (!validateCSRFRequest(request, ctx.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  const { requestId } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; groupId?: unknown };
  const action = body.action === 'accept' || body.action === 'decline' ? body.action : null;
  const groupId = typeof body.groupId === 'string' && body.groupId.trim() ? body.groupId.trim() : null;
  if (!action) {
    return NextResponse.json({ error: 'Invalid action', code: 'INVALID_ACTION' }, { status: 400 });
  }

  // Load the request and confirm it belongs to this centre and is still pending.
  const { data: reqRow, error: readErr } = await ctx.supabaseAdmin
    .from('teacher_center_requests')
    .select('id, teacher_id, center_id, status, initiated_by')
    .eq('id', requestId)
    .maybeSingle();
  if (readErr) return fail('read_request', readErr);

  const row = reqRow as
    | { id: string; teacher_id: string; center_id: string; status: string; initiated_by: string }
    | null;
  // The center only responds to teacher-initiated (incoming) requests. A
  // center-initiated (outgoing) request is the teacher's to accept/decline; the
  // owner withdraws it via /api/center/teacher-links/[requestId].
  if (!row || row.center_id !== ctx.centerId || row.initiated_by !== 'teacher') {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
  }
  if (row.status !== 'pending') {
    return NextResponse.json({ error: 'Not pending', code: 'NOT_PENDING' }, { status: 409 });
  }

  const now = new Date().toISOString();

  // Display names for the response (best-effort; never block the action on these).
  const { data: centerRow } = await ctx.supabaseAdmin
    .from('centers')
    .select('name')
    .eq('id', ctx.centerId)
    .maybeSingle();
  const { data: profileRow } = await ctx.supabaseAdmin
    .from('teacher_profiles')
    .select('display_name')
    .eq('user_id', row.teacher_id)
    .maybeSingle();
  const centerName = (centerRow as { name: string | null } | null)?.name ?? null;
  const teacherName = (profileRow as { display_name: string | null } | null)?.display_name ?? null;

  if (action === 'decline') {
    const { error: declineErr } = await ctx.supabaseAdmin
      .from('teacher_center_requests')
      .update({ status: 'declined', responded_at: now, responded_by: ctx.userId })
      .eq('id', requestId);
    if (declineErr) return fail('decline_update', declineErr);
    return NextResponse.json({ action: 'decline', teacherName, centerName });
  }

  // action === 'accept'
  const { error: acceptErr } = await ctx.supabaseAdmin
    .from('teacher_center_requests')
    .update({ status: 'accepted', responded_at: now, responded_by: ctx.userId })
    .eq('id', requestId);
  if (acceptErr) return fail('accept_update', acceptErr);

  // Create the active membership. A duplicate (already a member) is success.
  const { error: memberErr } = await ctx.supabaseAdmin.from('teacher_center').insert({
    teacher_id: row.teacher_id,
    center_id: ctx.centerId,
    status: 'active',
    invited_by: ctx.userId,
  });
  if (memberErr && (memberErr as { code?: string }).code !== '23505') {
    return fail('membership_insert', memberErr);
  }

  // Optional group assignment. Verify the group belongs to this centre first.
  if (groupId) {
    const { data: groupRow, error: groupErr } = await ctx.supabaseAdmin
      .from('student_groups')
      .select('id, center_id')
      .eq('id', groupId)
      .maybeSingle();
    if (groupErr) return fail('group_lookup', groupErr);
    const group = groupRow as { id: string; center_id: string } | null;
    if (group && group.center_id === ctx.centerId) {
      const { error: assignErr } = await ctx.supabaseAdmin
        .from('student_groups')
        .update({ teacher_id: row.teacher_id })
        .eq('id', groupId)
        .eq('center_id', ctx.centerId);
      if (assignErr) return fail('group_assign', assignErr);
    }
    // A group that does not belong to the centre is silently skipped: the
    // membership still succeeded, which is the primary outcome of accept.
  }

  return NextResponse.json({ action: 'accept', teacherName, centerName });
}
