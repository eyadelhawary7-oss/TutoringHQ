import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';

const ROUTE_TAG = 'api/teacher/group-detach';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * POST /api/teacher/group-detach
 * Flip a center-attached group the teacher runs back to their OWN solo private
 * group: detach_center_from_group clears center_id, zeroes the cut and flips
 * kind->'private'. The teacher's own action on their own group - NO center
 * approval. Past records (transactions, attendance, the cut already taken) are
 * never touched; only future sessions change (private engine, no cut).
 *
 * Gated on requireTeacherPrivateAccess: the result is a private-engine group, so
 * only a teacher who can run private groups may flip one back.
 */
export async function POST(request: NextRequest) {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { group_id?: unknown };
  const groupId = typeof body.group_id === 'string' ? body.group_id.trim() : '';
  if (!groupId) {
    return NextResponse.json({ error: 'Invalid input', code: 'INVALID_INPUT' }, { status: 400 });
  }

  const { data, error } = await auth.supabaseAdmin.rpc('detach_center_from_group', {
    p_group_id: groupId,
    p_actor_user_id: auth.userId,
  });
  if (error) {
    const code = (error as { code?: string }).code ?? '';
    const msg = (error as { message?: string }).message ?? '';
    // Ownership/unknown group -> 404 (no existence oracle). Not-attached -> 409.
    if (code === 'P0002') {
      return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    if (code === '23514' && msg.includes('not center-attached')) {
      return NextResponse.json(
        { error: 'That group is not center-attached', code: 'NOT_ATTACHED' },
        { status: 409 },
      );
    }
    return fail('detach_rpc', error);
  }

  const result = (Array.isArray(data) ? data[0] : data) as
    | { group_id: string; group_kind: string }
    | undefined;
  if (!result) {
    return fail('detach_shape', { message: 'detach_center_from_group returned no row' });
  }

  return NextResponse.json({ status: 'private', group_id: result.group_id });
}
