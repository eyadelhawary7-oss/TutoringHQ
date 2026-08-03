import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import { isUuid } from '@/lib/teacherPrivate';
import {
  attendanceForStudent,
  type FinishedSessionRow,
  type ScanRow,
  type StudentAttendance,
} from '@/lib/teacherAnalytics';
import { resolveFeeReminderBlock, type FeeReminderBlock } from '@/lib/teacherFeeReminder';

const ROUTE_TAG = 'api/teacher/private/students/[studentId]';

/** Generous ceiling for one student's own lesson history — a private student
 *  accumulates a few dozen charges a year, not hundreds. */
const MAX_CHARGE_SCAN = 500;
/** Recent classes drawn by §02. */
const MAX_RECENT = 10;

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type TeacherStudentDetail = {
  student: { id: string; name: string | null; phone: string | null; parentPhone: string | null };
  groups: { id: string; name: string | null }[];
  billing: {
    outstanding: number;
    pendingCount: number;
    /** Ids of every pending lesson charge, oldest first — what "Mark collected" settles. */
    pendingIds: string[];
    transactions: {
      id: string;
      /** The class date (sessions.scheduled_at), falling back to created_at. */
      date: string;
      amount: number;
      groupName: string | null;
      status: string | null;
      method: string | null;
    }[];
  };
  attendance: StudentAttendance;
  /** null when a manual fee reminder can be sent; otherwise why it cannot. */
  reminderBlock: FeeReminderBlock | null;
};

/**
 * GET: one student's detail for Merged-Teacher-Students §02 — contact, balance,
 * attendance and recent classes.
 *
 * Tenant boundary: the student must hold a live enrollment in one of THIS
 * teacher's private groups. No enrollment is a 404, never a 403, so a foreign
 * student id is indistinguishable from an unknown one.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ studentId: string }> },
) {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) return auth.response;

  const { studentId } = await params;
  if (!isUuid(studentId)) return notFound();

  const { data: groupRows, error: groupsErr } = await auth.supabaseAdmin
    .from('student_groups')
    .select('id, name')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'private');
  if (groupsErr) return serverError('group_list', groupsErr);
  const allGroups = (groupRows ?? []) as { id: string; name: string | null }[];
  if (allGroups.length === 0) return notFound();
  const nameByGroup = new Map(allGroups.map((g) => [g.id, g.name]));

  const { data: enrollRows, error: enrollErr } = await auth.supabaseAdmin
    .from('enrollments')
    .select('group_id, joined_at')
    .eq('student_id', studentId)
    .in('group_id', allGroups.map((g) => g.id))
    .in('status', ['pending', 'active']);
  if (enrollErr) return serverError('enrollment_list', enrollErr);
  const enrollments = (enrollRows ?? []) as { group_id: string; joined_at: string | null }[];
  // THE tenant check: no enrollment in one of this teacher's groups -> 404.
  if (enrollments.length === 0) return notFound();

  const { data: studentRow, error: studentErr } = await auth.supabaseAdmin
    .from('students')
    .select('id, name, phone, parent_phone')
    .eq('id', studentId)
    .maybeSingle();
  if (studentErr) return serverError('student_read', studentErr);
  if (!studentRow) return notFound();
  const s = studentRow as {
    id: string;
    name: string | null;
    phone: string | null;
    parent_phone: string | null;
  };

  const groups = enrollments.map((e) => ({
    id: e.group_id,
    name: nameByGroup.get(e.group_id) ?? null,
  }));

  // Pending charges: exact outstanding, exact count, and the ids the
  // Mark-collected action settles. Teacher-scoped, lesson-only, test excluded.
  const { data: pendingRows, error: pendingErr } = await auth.supabaseAdmin
    .from('transactions')
    .select('id, amount_billed, payer_phone, fee_reminder_count, created_at')
    .eq('teacher_id', auth.userId)
    .eq('student_id', studentId)
    .eq('kind', 'lesson')
    .eq('status', 'pending')
    .eq('is_test', false)
    .order('created_at', { ascending: true })
    .limit(MAX_CHARGE_SCAN);
  if (pendingErr) return serverError('pending_charges', pendingErr);
  const pending = (pendingRows ?? []) as {
    id: string;
    amount_billed: number | string | null;
    payer_phone: string | null;
    fee_reminder_count: number | null;
    created_at: string;
  }[];

  let outstanding = 0;
  for (const p of pending) outstanding = round2(outstanding + (Number(p.amount_billed) || 0));

  // Recent classes: the last N charges whatever their status.
  const { data: recentRows, error: recentErr } = await auth.supabaseAdmin
    .from('transactions')
    .select('id, session_id, group_id, amount_billed, status, created_at, paid_at, method')
    .eq('teacher_id', auth.userId)
    .eq('student_id', studentId)
    .eq('kind', 'lesson')
    .eq('is_test', false)
    .order('created_at', { ascending: false })
    .limit(MAX_RECENT);
  if (recentErr) return serverError('recent_charges', recentErr);
  const recent = (recentRows ?? []) as {
    id: string;
    session_id: string | null;
    group_id: string | null;
    amount_billed: number | string | null;
    status: string | null;
    created_at: string;
    paid_at: string | null;
    method: string | null;
  }[];

  // BEST-EFFORT: finished sessions drive both the attendance card and the
  // class-date on each recent row. A failure degrades to a null-rate card and
  // created_at dates, never a 500 - the rest of the screen still renders.
  let attendance: StudentAttendance = { finishedSessions: 0, present: 0, rate: null };
  const scheduledBySession = new Map<string, string>();
  try {
    const { data: sessionRows, error: sessErr } = await auth.supabaseAdmin
      .from('sessions')
      .select('id, group_id, scheduled_at')
      .in('group_id', enrollments.map((e) => e.group_id))
      .eq('status', 'finished');
    if (sessErr) throw sessErr;
    const finishedSessions = (sessionRows ?? []) as FinishedSessionRow[];
    for (const sess of finishedSessions) {
      if (sess.scheduled_at) scheduledBySession.set(sess.id, sess.scheduled_at);
    }

    if (finishedSessions.length > 0) {
      const { data: scanRows, error: scanErr } = await auth.supabaseAdmin
        .from('attendance_scans')
        .select('session_id, student_id, scanned_at')
        .eq('student_id', studentId)
        .in('session_id', finishedSessions.map((x) => x.id));
      if (scanErr) throw scanErr;
      attendance = attendanceForStudent(
        studentId,
        enrollments,
        finishedSessions,
        (scanRows ?? []) as ScanRow[],
      );
    }
  } catch (attErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', 'student_attendance');
      Sentry.captureMessage(
        `teacher student detail attendance lookup failed: ${(attErr as Error).message}`,
        'warning',
      );
    });
  }

  const reminderBlock = await resolveFeeReminderBlock(auth.supabaseAdmin, pending);

  const payload: TeacherStudentDetail = {
    student: { id: s.id, name: s.name, phone: s.phone, parentPhone: s.parent_phone },
    groups,
    billing: {
      outstanding,
      pendingCount: pending.length,
      pendingIds: pending.map((p) => p.id),
      transactions: recent.map((r) => ({
        id: r.id,
        date: (r.session_id ? scheduledBySession.get(r.session_id) : null) ?? r.created_at,
        amount: round2(Number(r.amount_billed) || 0),
        groupName: r.group_id ? (nameByGroup.get(r.group_id) ?? null) : null,
        status: r.status,
        method: r.method,
      })),
    },
    attendance,
    reminderBlock,
  };

  return NextResponse.json(payload);
}
