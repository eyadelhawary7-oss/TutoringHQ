import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import { isUuid } from '@/lib/teacherPrivate';
import { cairoDateKey } from '@/lib/cairo/day';

const ROUTE_TAG = 'api/teacher/private/schedule/sessions/[sessionId]';

type SessionRow = {
  id: string;
  group_id: string;
  scheduled_at: string;
  status: string;
  billed: boolean;
  billed_at: string | null;
};

type ScanRow = {
  student_id: string;
  billable: boolean;
};

type TransactionRow = {
  id: string;
  student_id: string;
  amount_billed: number | string | null;
  status: string;
  method: string | null;
  paid_at: string | null;
};

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
 * GET: read-only session detail for an already-recorded slot - who attended,
 * what was billed, and what is paid vs outstanding. sessions has no
 * teacher_id column, so ownership goes session -> group -> teacher_id
 * (403 on mismatch per the schedule-surface contract). Transaction statuses
 * come straight from the DB (pending|paid|failed|cancelled per
 * transactions_status_chk); the UI maps them to badges via i18n keys.
 */
export async function GET(
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

  const { data: sessionRow, error: sessionErr } = await auth.supabaseAdmin
    .from('sessions')
    .select('id, group_id, scheduled_at, status, billed, billed_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionErr) {
    return serverError('session_lookup', sessionErr);
  }
  if (!sessionRow) {
    return NextResponse.json(
      { error: 'Not found', code: 'session_not_found' },
      { status: 404 },
    );
  }
  const session = sessionRow as SessionRow;

  const { data: groupRow, error: groupErr } = await auth.supabaseAdmin
    .from('student_groups')
    .select('id, name, teacher_id, kind')
    .eq('id', session.group_id)
    .maybeSingle();
  if (groupErr) {
    return serverError('group_lookup', groupErr);
  }
  const group = groupRow as
    | { id: string; name: string | null; teacher_id: string | null; kind: string | null }
    | null;
  if (!group || group.teacher_id !== auth.userId || group.kind !== 'private') {
    return NextResponse.json(
      { error: 'Forbidden', code: 'not_your_session' },
      { status: 403 },
    );
  }

  const { data: scanRows, error: scansErr } = await auth.supabaseAdmin
    .from('attendance_scans')
    .select('student_id, billable')
    .eq('session_id', sessionId);
  if (scansErr) {
    return serverError('scans_lookup', scansErr);
  }
  const scans = (scanRows ?? []) as ScanRow[];

  const { data: txnRows, error: txnErr } = await auth.supabaseAdmin
    .from('transactions')
    .select('id, student_id, amount_billed, status, method, paid_at')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'lesson')
    .eq('session_id', sessionId);
  if (txnErr) {
    return serverError('transactions_lookup', txnErr);
  }
  const transactions = (txnRows ?? []) as TransactionRow[];

  const studentIds = Array.from(
    new Set([...scans.map((s) => s.student_id), ...transactions.map((t) => t.student_id)]),
  );
  const nameById = new Map<string, string | null>();
  const guestById = new Map<string, boolean>();
  if (studentIds.length > 0) {
    const { data: studentRows, error: studentsErr } = await auth.supabaseAdmin
      .from('students')
      .select('id, name, is_guest')
      .in('id', studentIds);
    if (studentsErr) {
      return serverError('students_lookup', studentsErr);
    }
    for (const s of (studentRows ?? []) as {
      id: string;
      name: string | null;
      is_guest: boolean | null;
    }[]) {
      nameById.set(s.id, s.name);
      guestById.set(s.id, s.is_guest === true);
    }
  }

  return NextResponse.json({
    session: {
      id: session.id,
      group_id: session.group_id,
      group_name: group.name,
      scheduled_date: cairoDateKey(new Date(session.scheduled_at)),
      status: session.status,
      billed: session.billed,
      billed_at: session.billed_at,
    },
    attendance: scans.map((s) => ({
      student_id: s.student_id,
      student_name: nameById.get(s.student_id) ?? null,
      billable: s.billable,
      is_guest: guestById.get(s.student_id) === true,
    })),
    transactions: transactions.map((t) => ({
      id: t.id,
      student_id: t.student_id,
      student_name: nameById.get(t.student_id) ?? null,
      amount_billed: Number(t.amount_billed) || 0,
      status: t.status,
      payment_method: t.method,
      paid_at: t.paid_at,
      is_guest: guestById.get(t.student_id) === true,
    })),
  });
}
