import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import { isUuid } from '@/lib/teacherPrivate';
import { requireTeacherUnderCap } from '@/lib/teacherCap';
import { isFeatureEnabled } from '@/lib/features';
import { isDigitalStudentFeeCollectionEnabled } from '@/lib/digitalStudentFeeCollection';

const ROUTE_TAG = 'api/teacher/private/schedule/sessions/[sessionId]/finish';

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
 * POST: end a LIVE session and record it. finish_class_and_bill handles the
 * live -> finished transition internally and creates one PENDING charge per
 * billable scan at the group's fee snapshot (idempotent: per-session+student
 * idempotency keys).
 *
 * Default (digital student-fee collection DORMANT): charges land Unpaid. This is
 * the living payment record — the teacher marks each student Paid (with a
 * method) whenever the money actually arrives, often days later. No money is
 * processed and no Paymob link is ever generated; the request body is ignored.
 *
 * When the single switch (digital_student_fee_collection.enabled) is flipped ON,
 * the original collection flow is restored: cash auto-confirms the pending
 * charges on the spot, while 'digital' leaves them pending for the Paymob
 * payment-link flow. This branch is the dormant feature's restoration seam.
 *
 * Only a LIVE session can be finished here (409 otherwise). Ownership flows
 * session -> group -> teacher_id (403 on mismatch).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await requireTeacherPrivateAccess(request);
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

  // Session + ownership chain.
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

  if (session.status !== 'live') {
    return NextResponse.json(
      { error: 'Conflict', code: 'session_not_live' },
      { status: 409 },
    );
  }

  // Over-cap lock: a Standard teacher past 60 students cannot finish + bill.
  // Pro is never capped. After ownership + live check, before billing runs.
  const cap = await requireTeacherUnderCap(auth.supabaseAdmin, auth.userId, ROUTE_TAG);
  if (!cap.ok) {
    return cap.response;
  }

  const { data: finishData, error: finishErr } = await auth.supabaseAdmin.rpc(
    'finish_class_and_bill',
    { p_session_id: sessionId, p_actor_id: auth.userId },
  );
  if (finishErr) {
    const code = (finishErr as { code?: string }).code;
    const msg = finishErr.message ?? '';
    if (code === '23514' && msg.includes('cannot bill a cancelled session')) {
      return NextResponse.json(
        { error: 'Conflict', code: 'session_cancelled' },
        { status: 409 },
      );
    }
    if (code === '23514') {
      return NextResponse.json(
        { error: 'Conflict', code: 'cannot_bill' },
        { status: 409 },
      );
    }
    if (code === 'P0002') {
      return NextResponse.json(
        { error: 'Not found', code: 'not_found' },
        { status: 404 },
      );
    }
    return serverError('finish_class_and_bill', finishErr);
  }

  const result = (Array.isArray(finishData) ? finishData[0] : finishData) as
    | { session_id: string; billed_now: boolean; charges_created: number }
    | undefined;
  const chargesCreated = result?.charges_created ?? 0;

  // DEFAULT: digital student-fee collection is dormant, so charges stay PENDING
  // (Unpaid) for the living payment record. The teacher records who paid — and
  // how — anytime after the class.
  if (!(await isDigitalStudentFeeCollectionEnabled())) {
    return NextResponse.json({
      session_id: sessionId,
      charges_created: chargesCreated,
    });
  }

  // RESTORED (single switch ON): the original collection flow. 'digital' (with
  // Paymob live) leaves charges pending for the payment-link flow; everything
  // else auto-confirms the pending charges as cash via the lifecycle RPC. A
  // per-charge failure is non-fatal but surfaces as 207 so the teacher knows to
  // settle the stragglers.
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const rawPaymentMethod = (body as { payment_method?: unknown })?.payment_method;
  const digitalActive =
    rawPaymentMethod === 'digital' && isFeatureEnabled('PAYMOB_ENABLED');

  let collectionFailed = false;
  if (!digitalActive) {
    const { data: pendingTxns, error: pendingErr } = await auth.supabaseAdmin
      .from('transactions')
      .select('id')
      .eq('session_id', sessionId)
      .eq('status', 'pending');
    if (pendingErr) {
      collectionFailed = true;
      Sentry.withScope((scope) => {
        scope.setTag('route', ROUTE_TAG);
        scope.setTag('step', 'collect_pending_lookup');
        Sentry.captureException(pendingErr);
      });
    } else {
      for (const txn of (pendingTxns ?? []) as { id: string }[]) {
        const { error: collectErr } = await auth.supabaseAdmin.rpc(
          'apply_transaction_transition',
          {
            p_transaction_id: txn.id,
            p_new_status: 'paid',
            p_actor_id: auth.userId,
            p_method: 'cash',
          },
        );
        if (collectErr) {
          collectionFailed = true;
          Sentry.withScope((scope) => {
            scope.setTag('route', ROUTE_TAG);
            scope.setTag('step', 'collect_transition');
            Sentry.captureException(collectErr);
          });
        }
      }
    }
  }

  const resolvedMethod = digitalActive ? 'digital' : 'cash';
  if (collectionFailed) {
    return NextResponse.json(
      {
        session_id: sessionId,
        charges_created: chargesCreated,
        payment_method: resolvedMethod,
        billing_error: 'cash_collection_partial',
      },
      { status: 207 },
    );
  }

  return NextResponse.json({
    session_id: sessionId,
    charges_created: chargesCreated,
    payment_method: resolvedMethod,
  });
}
