import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import { isUuid } from '@/lib/teacherPrivate';

const ROUTE_TAG = 'api/teacher/private/mark-paid';

// Manual zero-commission methods ONLY. card/wallet/apple_pay/google_pay are
// the future Paymob flow and are never offered manually.
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
 * POST: mark a pending lesson charge paid (cash or InstaPay - money the
 * teacher collected directly; CenterHQ takes no cut). Status flips through
 * apply_transaction_transition(id, 'paid', auth.userId, method), which sets
 * method (never overwriting a different one), stamps paid_at and
 * marked_paid_by, and audits with the method.
 *
 * Ownership BEFORE the transition: the transaction must be the teacher's own
 * lesson charge (.eq teacher_id + kind='lesson'). A foreign id is 404 with no
 * RPC call. The CORE read errors as 500, never an error-minted 404.
 *
 * Idempotency: the fn no-ops on a same-status call, so re-marking an
 * already-paid charge with the same method returns the row -> 200. Retrying
 * with a DIFFERENT method hits 'method already set' -> 409 method_conflict.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ transactionId: string }> },
) {
  const auth = await requireTeacherPrivateAccess(request);
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

  const { data: txnRow, error: txnErr } = await auth.supabaseAdmin
    .from('transactions')
    .select('id, teacher_id, kind, status, session_id')
    .eq('id', transactionId)
    .eq('teacher_id', auth.userId)
    .eq('kind', 'lesson')
    .maybeSingle();
  if (txnErr) {
    return serverError('transaction_ownership', txnErr);
  }
  if (!txnRow) {
    return NextResponse.json(
      { error: 'Not found', code: 'transaction_not_found' },
      { status: 404 },
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
    const msg = transErr.message ?? '';
    if (
      code === '23514' &&
      (msg.includes('method already set') ||
        msg.includes('method required') ||
        msg.includes('invalid payment method'))
    ) {
      return NextResponse.json(
        { error: 'Conflict', code: 'method_conflict' },
        { status: 409 },
      );
    }
    if (code === '23514') {
      // 'illegal transaction transition' (already failed/cancelled) and any
      // other constraint-shaped rejection.
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
