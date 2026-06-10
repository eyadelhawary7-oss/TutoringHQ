import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import { requireOwnedPrivateGroup, isUuid } from '@/lib/teacherPrivate';

const ROUTE_TAG = 'api/teacher/private/enrollments';

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
 * POST: approve or reject a pending enrollment. Status transitions go through
 * apply_enrollment_transition ONLY - direct UPDATEs of enrollments.status are
 * blocked by the guard_enrollments_lifecycle trigger.
 *
 * Ownership is checked twice: the group must be the teacher's own private
 * group, AND the enrollment must belong to that verified group (an enrollment
 * id from another group is 404 enrollment_not_found - never transitioned).
 *
 * Transition errors map to:
 *   23514 "illegal enrollment transition" -> 409 invalid_transition (e.g.
 *     already approved on another device - the client refetches)
 *   P0002                                 -> 404 enrollment_not_found
 *   anything else                         -> 500 + Sentry
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) {
    return auth.response;
  }
  const { groupId } = await params;
  const owned = await requireOwnedPrivateGroup(auth.supabaseAdmin, auth.userId, groupId, ROUTE_TAG);
  if (!owned.ok) {
    return owned.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_body' },
      { status: 400 },
    );
  }
  const { enrollment_id: rawEnrollmentId, action: rawAction } = (body ?? {}) as {
    enrollment_id?: unknown;
    action?: unknown;
  };

  const enrollmentId = typeof rawEnrollmentId === 'string' ? rawEnrollmentId : '';
  if (!isUuid(enrollmentId)) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_enrollment_id' },
      { status: 400 },
    );
  }
  if (rawAction !== 'approve' && rawAction !== 'reject') {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_action' },
      { status: 400 },
    );
  }

  // The enrollment must belong to the verified group - not just any
  // enrollment id the caller happens to know. CORE read: error -> 500.
  const { data: enrRow, error: enrErr } = await auth.supabaseAdmin
    .from('enrollments')
    .select('id, status')
    .eq('id', enrollmentId)
    .eq('group_id', groupId)
    .maybeSingle();
  if (enrErr) {
    return serverError('enrollment_lookup', enrErr);
  }
  if (!enrRow) {
    return NextResponse.json(
      { error: 'Not found', code: 'enrollment_not_found' },
      { status: 404 },
    );
  }

  const { data: transData, error: transErr } = await auth.supabaseAdmin.rpc(
    'apply_enrollment_transition',
    {
      p_enrollment_id: enrollmentId,
      p_new_status: rawAction === 'approve' ? 'active' : 'rejected',
      p_actor_id: auth.userId,
    },
  );
  if (transErr) {
    const code = (transErr as { code?: string }).code;
    const msg = transErr.message ?? '';
    if (code === '23514' || msg.includes('illegal enrollment transition')) {
      return NextResponse.json(
        { error: 'Conflict', code: 'invalid_transition' },
        { status: 409 },
      );
    }
    if (code === 'P0002') {
      return NextResponse.json(
        { error: 'Not found', code: 'enrollment_not_found' },
        { status: 404 },
      );
    }
    return serverError('enrollment_transition', transErr);
  }

  const updated = (Array.isArray(transData) ? transData[0] : transData) as
    | { id?: string; status?: string }
    | null;

  return NextResponse.json({
    enrollment: {
      id: updated?.id ?? enrollmentId,
      status: updated?.status ?? (rawAction === 'approve' ? 'active' : 'rejected'),
    },
  });
}
