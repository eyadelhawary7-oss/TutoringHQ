import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';

const ROUTE_TAG = 'api/teacher/center-requests/[requestId]';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * POST /api/teacher/center-requests/[requestId]
 * The teacher accepts or declines a CENTER-INITIATED link request (the owner
 * added them by code; this is the teacher's confirmation that keeps linking
 * two-sided). Only the named teacher may respond, only while pending, and only
 * for initiated_by='center' rows (a teacher never "accepts" their own
 * teacher-initiated request - the center does that). On accept the active
 * teacher_center membership is created (idempotent on the unique pairing).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  const { requestId } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  const action = body.action === 'accept' || body.action === 'decline' ? body.action : null;
  if (!action) {
    return NextResponse.json({ error: 'Invalid action', code: 'INVALID_ACTION' }, { status: 400 });
  }

  const { data: reqRow, error: readErr } = await auth.supabaseAdmin
    .from('teacher_center_requests')
    .select('id, teacher_id, center_id, status, initiated_by')
    .eq('id', requestId)
    .maybeSingle();
  if (readErr) return fail('read_request', readErr);

  const row = reqRow as
    | { id: string; teacher_id: string; center_id: string; status: string; initiated_by: string }
    | null;
  // Wrong owner, missing, or not a center-initiated request reads as 404 - the
  // teacher only ever acts on requests addressed to them by a center.
  if (!row || row.teacher_id !== auth.userId || row.initiated_by !== 'center') {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
  }
  if (row.status !== 'pending') {
    return NextResponse.json({ error: 'Not pending', code: 'NOT_PENDING' }, { status: 409 });
  }

  const now = new Date().toISOString();

  if (action === 'decline') {
    const { error: declineErr } = await auth.supabaseAdmin
      .from('teacher_center_requests')
      .update({ status: 'declined', responded_at: now, responded_by: auth.userId })
      .eq('id', requestId);
    if (declineErr) return fail('decline_update', declineErr);
    return NextResponse.json({ action: 'decline' });
  }

  // accept: mark accepted, then create the active membership. A duplicate
  // (already a member) is success - the pairing is what matters.
  const { error: acceptErr } = await auth.supabaseAdmin
    .from('teacher_center_requests')
    .update({ status: 'accepted', responded_at: now, responded_by: auth.userId })
    .eq('id', requestId);
  if (acceptErr) return fail('accept_update', acceptErr);

  const { error: memberErr } = await auth.supabaseAdmin.from('teacher_center').insert({
    teacher_id: row.teacher_id,
    center_id: row.center_id,
    status: 'active',
    accepted_at: now,
  });
  if (memberErr && (memberErr as { code?: string }).code !== '23505') {
    return fail('membership_insert', memberErr);
  }

  return NextResponse.json({ action: 'accept' });
}

/**
 * DELETE /api/teacher/center-requests/[requestId]
 * Withdraw a still-pending request. Only the owning teacher may withdraw, and
 * only while the request is pending.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  const { requestId } = await params;

  const { data: reqRow, error: readErr } = await auth.supabaseAdmin
    .from('teacher_center_requests')
    .select('id, teacher_id, status')
    .eq('id', requestId)
    .maybeSingle();
  if (readErr) return fail('read_request', readErr);

  const row = reqRow as { id: string; teacher_id: string; status: string } | null;
  // Wrong owner (or missing) reads as 404 -- never reveal another teacher's request.
  if (!row || row.teacher_id !== auth.userId) {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
  }
  if (row.status !== 'pending') {
    return NextResponse.json(
      { error: 'Cannot withdraw', code: 'CANNOT_WITHDRAW' },
      { status: 409 },
    );
  }

  const { error: updErr } = await auth.supabaseAdmin
    .from('teacher_center_requests')
    .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
    .eq('id', requestId);
  if (updErr) return fail('withdraw_update', updErr);

  return NextResponse.json({ ok: true });
}
