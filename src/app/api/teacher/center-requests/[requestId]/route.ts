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
