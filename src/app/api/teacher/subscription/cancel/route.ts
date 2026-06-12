import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { validateCSRFRequest } from '@/lib/csrf';

const ROUTE_TAG = 'api/teacher/subscription/cancel';

function fail(step: string, err: unknown) {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * POST /api/teacher/subscription/cancel
 * Cancels the teacher's own subscription via
 * apply_teacher_subscription_transition (the only legal write path for
 * teacher_subscriptions.status - the lifecycle guard blocks direct UPDATEs).
 * Access to private data then lapses at the gate; group data is preserved.
 * Idempotent: cancelling an already-cancelled subscription is a no-op success.
 */
export async function POST(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  if (!validateCSRFRequest(request, auth.userId)) {
    return NextResponse.json({ error: 'Invalid CSRF token', code: 'CSRF' }, { status: 403 });
  }

  // CORE: the subscription row to transition. No row -> nothing to cancel.
  const { data: subRow, error: subErr } = await auth.supabaseAdmin
    .from('teacher_subscriptions')
    .select('id, status')
    .eq('teacher_id', auth.userId)
    .maybeSingle();
  if (subErr) return fail('subscription_lookup', subErr);
  const sub = subRow as { id: string; status: string } | null;
  if (!sub) {
    return NextResponse.json(
      { error: 'No subscription to cancel', code: 'NO_SUBSCRIPTION' },
      { status: 400 },
    );
  }

  const { data: transData, error: transErr } = await auth.supabaseAdmin.rpc(
    'apply_teacher_subscription_transition',
    {
      p_subscription_id: sub.id,
      p_new_status: 'cancelled',
      p_actor_id: auth.userId,
    },
  );
  if (transErr) {
    const code = (transErr as { code?: string }).code;
    if (code === '23514') {
      // Illegal transition: the lifecycle map should always allow -> cancelled,
      // so surface it as a conflict rather than a server error.
      return NextResponse.json(
        { error: 'Conflict', code: 'invalid_transition' },
        { status: 409 },
      );
    }
    return fail('subscription_transition', transErr);
  }

  const updated = (Array.isArray(transData) ? transData[0] : transData) as
    | { status?: string }
    | null;
  return NextResponse.json({ success: true, status: updated?.status ?? 'cancelled' });
}
