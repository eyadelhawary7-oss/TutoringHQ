import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import { requireOwnedSession } from '@/lib/teacherPrivate';

const ROUTE_TAG = 'api/teacher/private/finish-class';

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
 * POST: finish the class and bill the attendees, via finish_class_and_bill
 * (p_session_id, p_actor_id = auth.userId). The function transitions the
 * session to finished if needed, bills every attendance_scans row with
 * billable=true at the group's fee_per_class snapshot, and is idempotent
 * twice over: an already-billed session returns (billed_now=false, 0) as a
 * no-op, and every charge carries a per-session+student idempotency key. A
 * stale-tab second call can never double-bill.
 *
 * Verified business errors map to:
 *   23514 "cannot bill a cancelled session" -> 409 session_cancelled
 *   other 23514 (private-only / no fee / illegal transition)
 *                                            -> 409 cannot_bill
 *   P0002 (session/group vanished)           -> 404 not_found
 *   23503 (no teacher_profiles row)          -> 500 + Sentry. Integrity gap:
 *     center-invited teachers get a profile from invite_teacher_to_center; a
 *     pure-private signup flow must create one too.
 *   anything else                            -> 500 + Sentry
 *
 * The UI's "N x fee = total" is display-only confirmation - the amounts here
 * come from the DB snapshot, nothing money-bearing is read from the body.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string; sessionId: string }> },
) {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) {
    return auth.response;
  }
  const { groupId, sessionId } = await params;
  const owned = await requireOwnedSession(
    auth.supabaseAdmin,
    auth.userId,
    groupId,
    sessionId,
    ROUTE_TAG,
  );
  if (!owned.ok) {
    return owned.response;
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
  if (!result) {
    return serverError('finish_shape', { message: 'finish_class_and_bill returned no row' });
  }

  // Billed summary: the charges the function just created (or, on an
  // idempotent re-call, the ones that already existed). Display data on top
  // of a successful bill - best-effort, never fails the finish.
  let charges: { studentId: string; amount: number; status: string }[] = [];
  let total = 0;
  const { data: txnRows, error: txnErr } = await auth.supabaseAdmin
    .from('transactions')
    .select('student_id, amount_billed, status')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'lesson')
    .eq('session_id', sessionId);
  if (txnErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'billed_summary');
      Sentry.captureMessage(
        `billed-summary lookup failed after finish: ${txnErr.message}`,
        'warning',
      );
    });
  } else {
    charges = ((txnRows ?? []) as { student_id: string; amount_billed: number | string | null; status: string }[]).map(
      (r) => ({
        studentId: r.student_id,
        amount: Number(r.amount_billed) || 0,
        status: r.status,
      }),
    );
    total = Math.round(charges.reduce((acc, c) => acc + c.amount, 0) * 100) / 100;
  }

  return NextResponse.json({
    billedNow: result.billed_now,
    alreadyBilled: !result.billed_now,
    chargesCreated: result.charges_created,
    charges,
    total,
  });
}
