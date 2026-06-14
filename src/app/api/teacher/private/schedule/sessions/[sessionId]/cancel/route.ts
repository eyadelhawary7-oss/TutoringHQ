import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { isUuid } from '@/lib/teacherPrivate';
import { requireTeacherUnderCap } from '@/lib/teacherCap';

const ROUTE_TAG = 'api/teacher/private/schedule/sessions/[sessionId]/cancel';

function serverError(step: string, err: { message: string }): NextResponse {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json(
    { error: 'Server error', code: 'server_error' },
    { status: 500 },
  );
}

/**
 * POST: cancel a LIVE session mid-class. Status change goes through
 * apply_session_transition (live -> cancelled); the recorded attendance scans
 * are not billed (cancelled sessions can never be billed). Ownership flows
 * session -> group -> teacher_id. Only a live (or scheduled) session can be
 * cancelled here; a finished/billed session is a hard 409.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) {
    return auth.response;
  }
  const { sessionId } = await params;
  if (!isUuid(sessionId)) {
    return NextResponse.json(
      { error: 'Not found', code: 'session_not_found' },
      { status: 404 },
    );
  }

  const { data: sessionRow, error: sessionErr } = await auth.supabaseAdmin
    .from('sessions')
    .select('id, group_id, status')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionErr) {
    return serverError('session_lookup', sessionErr);
  }
  const session = sessionRow as
    | { id: string; group_id: string; status: string }
    | null;
  if (!session) {
    return NextResponse.json(
      { error: 'Not found', code: 'session_not_found' },
      { status: 404 },
    );
  }

  const { data: groupRow, error: groupErr } = await auth.supabaseAdmin
    .from('student_groups')
    .select('id, teacher_id, kind')
    .eq('id', session.group_id)
    .maybeSingle();
  if (groupErr) {
    return serverError('group_lookup', groupErr);
  }
  const group = groupRow as
    | { id: string; teacher_id: string | null; kind: string | null }
    | null;
  if (!group || group.teacher_id !== auth.userId || group.kind !== 'private') {
    return NextResponse.json(
      { error: 'Forbidden', code: 'not_your_session' },
      { status: 403 },
    );
  }

  if (session.status !== 'live' && session.status !== 'scheduled') {
    return NextResponse.json(
      { error: 'Conflict', code: 'session_not_cancellable' },
      { status: 409 },
    );
  }

  // Over-cap lock: a Standard teacher past 60 students cannot manage sessions.
  // Pro is never capped. After ownership + cancellable check, before the
  // transition.
  const cap = await requireTeacherUnderCap(auth.supabaseAdmin, auth.userId, ROUTE_TAG);
  if (!cap.ok) {
    return cap.response;
  }

  const { error: transitionErr } = await auth.supabaseAdmin.rpc(
    'apply_session_transition',
    { p_session_id: sessionId, p_new_status: 'cancelled', p_actor_id: auth.userId },
  );
  if (transitionErr) {
    return serverError('apply_session_transition', transitionErr);
  }

  return NextResponse.json({ session_id: sessionId, status: 'cancelled' });
}
