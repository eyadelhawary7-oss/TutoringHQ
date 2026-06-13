import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { isUuid } from '@/lib/teacherPrivate';

const ROUTE_TAG = 'api/teacher/private/transactions/collect';

// Manual zero-commission methods the teacher collects directly. card/wallet/
// apple_pay/google_pay are the future Paymob flow and are never offered here.
const MANUAL_METHODS = new Set(['cash', 'instapay']);

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
 * POST: collect a pending lesson charge as cash or InstaPay - money the
 * teacher takes directly (CenterHQ takes no cut). Used from the slot sheet's
 * after-the-fact settle path and the group detail Classes tab.
 *
 * Ownership: the charge must be the caller's own - either teacher_id matches
 * directly, or it resolves through session -> group -> teacher_id. Anything
 * else is 403. The status flip goes through apply_transaction_transition only
 * (never a direct UPDATE); a non-pending charge is 409.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ transactionId: string }> },
) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) {
    return auth.response;
  }
  const { transactionId } = await params;
  if (!isUuid(transactionId)) {
    return NextResponse.json(
      { error: 'Not found', code: 'transaction_not_found' },
      { status: 404 },
    );
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
  const { method: rawMethod } = (body ?? {}) as { method?: unknown };
  const method = typeof rawMethod === 'string' ? rawMethod : '';
  if (!MANUAL_METHODS.has(method)) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_method' },
      { status: 400 },
    );
  }

  // Fetch the charge, then prove ownership before any state change.
  const { data: txnRow, error: txnErr } = await auth.supabaseAdmin
    .from('transactions')
    .select('id, teacher_id, status, session_id')
    .eq('id', transactionId)
    .maybeSingle();
  if (txnErr) {
    return serverError('transaction_lookup', txnErr);
  }
  if (!txnRow) {
    return NextResponse.json(
      { error: 'Not found', code: 'transaction_not_found' },
      { status: 404 },
    );
  }
  const txn = txnRow as {
    id: string;
    teacher_id: string | null;
    status: string;
    session_id: string | null;
  };

  let isOwner = txn.teacher_id === auth.userId;
  // Fallback: resolve ownership through the session's group when the charge
  // carries no teacher_id of its own.
  if (!isOwner && txn.session_id) {
    const { data: sessionRow, error: sessionErr } = await auth.supabaseAdmin
      .from('sessions')
      .select('group_id')
      .eq('id', txn.session_id)
      .maybeSingle();
    if (sessionErr) {
      return serverError('session_lookup', sessionErr);
    }
    const groupId = (sessionRow as { group_id: string | null } | null)?.group_id ?? null;
    if (groupId) {
      const { data: groupRow, error: groupErr } = await auth.supabaseAdmin
        .from('student_groups')
        .select('teacher_id')
        .eq('id', groupId)
        .maybeSingle();
      if (groupErr) {
        return serverError('group_lookup', groupErr);
      }
      if ((groupRow as { teacher_id: string | null } | null)?.teacher_id === auth.userId) {
        isOwner = true;
      }
    }
  }
  if (!isOwner) {
    return NextResponse.json(
      { error: 'Forbidden', code: 'not_your_transaction' },
      { status: 403 },
    );
  }

  if (txn.status !== 'pending') {
    return NextResponse.json(
      { error: 'Conflict', code: 'already_settled' },
      { status: 409 },
    );
  }

  const { data: transData, error: transErr } = await auth.supabaseAdmin.rpc(
    'apply_transaction_transition',
    {
      p_transaction_id: transactionId,
      p_new_status: 'paid',
      p_actor_id: auth.userId,
      p_method: method,
    },
  );
  if (transErr) {
    const code = (transErr as { code?: string }).code;
    if (code === '23514') {
      return NextResponse.json(
        { error: 'Conflict', code: 'invalid_transition' },
        { status: 409 },
      );
    }
    if (code === 'P0002') {
      return NextResponse.json(
        { error: 'Not found', code: 'transaction_not_found' },
        { status: 404 },
      );
    }
    return serverError('transaction_transition', transErr);
  }

  const updated = (Array.isArray(transData) ? transData[0] : transData) as
    | { id?: string; status?: string; method?: string | null; paid_at?: string | null }
    | null;

  return NextResponse.json({
    transaction: {
      id: updated?.id ?? transactionId,
      status: updated?.status ?? 'paid',
      method: updated?.method ?? method,
      paid_at: updated?.paid_at ?? null,
    },
  });
}
