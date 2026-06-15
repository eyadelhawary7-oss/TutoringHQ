import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireOwnerAdminCenter } from '@/lib/requireOwnerAdminCenter';
import { validateCSRFRequest } from '@/lib/csrf';

const ROUTE_TAG = 'api/center/teacher-links/[requestId]';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * DELETE /api/center/teacher-links/[requestId]
 * Owner/admin withdraws a still-pending, center-initiated link request for THIS
 * center. Only pending + initiated_by='center' rows belonging to the caller's
 * center can be withdrawn; anything else reads as 404/409.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const ctx = await requireOwnerAdminCenter(request);
  if (ctx instanceof NextResponse) return ctx;

  if (!validateCSRFRequest(request, ctx.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  const { requestId } = await params;

  const { data: reqRow, error: readErr } = await ctx.supabaseAdmin
    .from('teacher_center_requests')
    .select('id, center_id, status, initiated_by')
    .eq('id', requestId)
    .maybeSingle();
  if (readErr) return fail('read_request', readErr);

  const row = reqRow as
    | { id: string; center_id: string; status: string; initiated_by: string }
    | null;
  if (!row || row.center_id !== ctx.centerId || row.initiated_by !== 'center') {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
  }
  if (row.status !== 'pending') {
    return NextResponse.json({ error: 'Cannot withdraw', code: 'CANNOT_WITHDRAW' }, { status: 409 });
  }

  const { error: updErr } = await ctx.supabaseAdmin
    .from('teacher_center_requests')
    .update({ status: 'withdrawn', responded_at: new Date().toISOString(), responded_by: ctx.userId })
    .eq('id', requestId);
  if (updErr) return fail('withdraw_update', updErr);

  return NextResponse.json({ ok: true });
}
