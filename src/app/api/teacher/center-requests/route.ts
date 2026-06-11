import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';

const ROUTE_TAG = 'api/teacher/center-requests';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * POST /api/teacher/center-requests
 * A centre-less (or any) teacher requests to join a centre by its center_code.
 * Free zone: joining a centre is free, so requireTeacherAuth (no private gate).
 */
export async function POST(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    centerCode?: unknown;
    message?: unknown;
  };
  const centerCode = typeof body.centerCode === 'string' ? body.centerCode.trim() : '';
  const message =
    typeof body.message === 'string' && body.message.trim().length > 0
      ? body.message.trim().slice(0, 500)
      : null;

  if (!centerCode) {
    return NextResponse.json({ error: 'Center code required', code: 'INVALID_INPUT' }, { status: 400 });
  }

  // Look up the centre by its public join code.
  const { data: center, error: centerErr } = await auth.supabaseAdmin
    .from('centers')
    .select('id, name')
    .eq('center_code', centerCode)
    .maybeSingle();
  if (centerErr) return fail('center_lookup', centerErr);
  if (!center) {
    return NextResponse.json({ error: 'Center not found', code: 'CENTER_NOT_FOUND' }, { status: 404 });
  }
  const centerRow = center as { id: string; name: string | null };

  // Already an active member? No request needed.
  const { data: membership, error: memErr } = await auth.supabaseAdmin
    .from('teacher_center')
    .select('teacher_id')
    .eq('teacher_id', auth.userId)
    .eq('center_id', centerRow.id)
    .eq('status', 'active')
    .maybeSingle();
  if (memErr) return fail('membership_check', memErr);
  if (membership) {
    return NextResponse.json(
      { error: 'Already a member', code: 'ALREADY_A_MEMBER' },
      { status: 409 },
    );
  }

  // Insert the pending request. The partial unique index
  // (teacher_id, center_id) WHERE status='pending' surfaces duplicates as 23505.
  const { data: inserted, error: insErr } = await auth.supabaseAdmin
    .from('teacher_center_requests')
    .insert({
      teacher_id: auth.userId,
      center_id: centerRow.id,
      status: 'pending',
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

  return NextResponse.json(
    { requestId: (inserted as { id: string }).id, centerName: centerRow.name },
    { status: 201 },
  );
}

/**
 * GET /api/teacher/center-requests
 * The teacher's own join requests with centre name + status.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabaseAdmin
    .from('teacher_center_requests')
    .select('id, status, message, created_at, responded_at, center_id, centers(name)')
    .eq('teacher_id', auth.userId)
    .order('created_at', { ascending: false });
  if (error) return fail('list_own', error);

  type Row = {
    id: string;
    status: string;
    message: string | null;
    created_at: string;
    responded_at: string | null;
    center_id: string;
    centers: { name: string | null } | { name: string | null }[] | null;
  };
  const requests = ((data ?? []) as Row[]).map((r) => {
    const center = Array.isArray(r.centers) ? r.centers[0] : r.centers;
    return {
      id: r.id,
      status: r.status,
      message: r.message,
      createdAt: r.created_at,
      respondedAt: r.responded_at,
      centerName: center?.name ?? null,
    };
  });

  return NextResponse.json({ requests });
}
