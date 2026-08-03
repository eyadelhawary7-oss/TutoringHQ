import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import { isUuid } from '@/lib/teacherPrivate';
import { sendTemplateMessage } from '@/lib/whatsapp/client';
import { formatCurrency } from '@/lib/formatNumber';
import {
  FEE_REMINDER_TEMPLATE,
  MAX_FEE_REMINDERS,
  pickRemindableCharge,
  resolveFeeReminderBlock,
} from '@/lib/teacherFeeReminder';

const ROUTE_TAG = 'api/teacher/private/students/[studentId]/send-reminder';

function serverError(step: string, err: { message: string }): NextResponse {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

function notFound(): NextResponse {
  return NextResponse.json({ error: 'Not found', code: 'student_not_found' }, { status: 404 });
}

/**
 * POST: send ONE manual fee reminder for this student's oldest pending lesson
 * charge, over the same Meta template and the same four body parameters the
 * nightly `fee-reminders` cron uses, and bump the same cadence columns so the
 * two paths cannot double-send.
 *
 * BLOCKED EXTERNAL, AND VISIBLY SO. `chq_fee_reminder` is PENDING at Meta and
 * the `teacher.fee_reminder.manual_enabled` config row does not exist, so today
 * every call returns 503 with a named reason and writes nothing. There is no
 * branch here that returns success without a delivered message: the cadence
 * bump happens only after sendTemplateMessage reports success. See
 * src/lib/teacherFeeReminder.ts for the single config point.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ studentId: string }> },
) {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) return auth.response;

  const { studentId } = await params;
  if (!isUuid(studentId)) return notFound();

  // Tenant boundary first, exactly as the detail GET: the student must hold a
  // live enrollment in one of this teacher's own private groups.
  const { data: groupRows, error: groupsErr } = await auth.supabaseAdmin
    .from('student_groups')
    .select('id')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'private');
  if (groupsErr) return serverError('group_list', groupsErr);
  const groupIds = ((groupRows ?? []) as { id: string }[]).map((g) => g.id);
  if (groupIds.length === 0) return notFound();

  const { data: enrollRows, error: enrollErr } = await auth.supabaseAdmin
    .from('enrollments')
    .select('group_id')
    .eq('student_id', studentId)
    .in('group_id', groupIds)
    .in('status', ['pending', 'active']);
  if (enrollErr) return serverError('enrollment_list', enrollErr);
  if (((enrollRows ?? []) as unknown[]).length === 0) return notFound();

  const { data: pendingRows, error: pendingErr } = await auth.supabaseAdmin
    .from('transactions')
    .select('id, amount_billed, payer_phone, fee_reminder_count, center_id, created_at')
    .eq('teacher_id', auth.userId)
    .eq('student_id', studentId)
    .eq('kind', 'lesson')
    .eq('status', 'pending')
    .eq('is_test', false)
    .order('created_at', { ascending: true })
    .limit(500);
  if (pendingErr) return serverError('pending_charges', pendingErr);
  const pending = (pendingRows ?? []) as {
    id: string;
    amount_billed: number | string | null;
    payer_phone: string | null;
    fee_reminder_count: number | null;
    center_id: string | null;
    created_at: string;
  }[];

  // Re-evaluated server-side on every call; the client's disabled state is a
  // courtesy, not the control.
  const block = await resolveFeeReminderBlock(auth.supabaseAdmin, pending);
  if (block) {
    return NextResponse.json({ error: 'Unavailable', code: block }, { status: 503 });
  }

  const charge = pickRemindableCharge(pending);
  if (!charge) {
    return NextResponse.json(
      { error: 'Unavailable', code: 'reminder_cap_reached' },
      { status: 503 },
    );
  }

  const { data: studentRow } = await auth.supabaseAdmin
    .from('students')
    .select('name')
    .eq('id', studentId)
    .maybeSingle();
  const studentName = ((studentRow as { name?: string | null } | null)?.name ?? '').trim();

  // Same four body parameters and the same order as the cron, so a manual send
  // and an automatic one are the same message.
  const feeStr = formatCurrency(Number(charge.amount_billed ?? 0), 'ar');
  let result: { success: boolean; error?: string };
  try {
    result = await sendTemplateMessage(
      charge.center_id ?? '',
      charge.payer_phone as string,
      FEE_REMINDER_TEMPLATE,
      { '1': studentName, '2': feeStr, '3': 'برجاء إرسال رسوم الحصة.', '4': '' },
      { bodyParameterOrder: ['1', '2', '3', '4'] },
    );
  } catch (waErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'wa_send');
      Sentry.captureException(waErr);
    });
    return NextResponse.json({ error: 'Send failed', code: 'send_failed' }, { status: 502 });
  }

  // Not delivered means not sent. No cadence bump, no success, no timestamp.
  if (!result.success) {
    return NextResponse.json(
      { error: 'Send failed', code: result.error ?? 'send_failed' },
      { status: 502 },
    );
  }

  const nextCount = Math.min(Number(charge.fee_reminder_count ?? 0) + 1, MAX_FEE_REMINDERS);
  const sentAt = new Date().toISOString();
  const { error: updErr } = await auth.supabaseAdmin
    .from('transactions')
    .update({ fee_reminder_count: nextCount, fee_reminder_last_at: sentAt })
    .eq('id', charge.id);
  if (updErr) {
    // The message really did go out, so this is not a failed send - but the
    // cadence columns are now behind, which risks one extra cron reminder.
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'cadence_update');
      Sentry.captureMessage(
        `manual fee reminder sent but cadence update failed: ${updErr.message}`,
        'error',
      );
    });
  }

  return NextResponse.json({
    sent: true,
    transaction_id: charge.id,
    reminder_count: nextCount,
    reminder_last_at: sentAt,
  });
}
