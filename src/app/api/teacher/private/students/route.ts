import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';

const ROUTE_TAG = 'api/teacher/private/students';

function serverError(step: string, err: { message: string }): NextResponse {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

const MAX_TXNS_PER_STUDENT = 10;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type StudentBilling = {
  outstanding: number;
  lastPaymentAt: string | null;
  transactions: {
    id: string;
    date: string;
    amount: number;
    groupId: string | null;
    groupName: string | null;
    status: string | null;
  }[];
};

/**
 * GET: every student (active + pending) across the teacher's private groups,
 * one row per enrollment so a student in two groups appears under each. PRIVATE
 * data, so requireTeacherPrivateAccess is the first line of defense - a lapsed
 * or never-subscribed teacher gets 403 and no query runs. Tenant scoping:
 * student_groups.teacher_id = auth.userId.
 *
 * billingByStudent is display data for the student detail panel (outstanding,
 * last payment, recent transactions) and is best-effort: a failed lookup
 * degrades to an empty map + Sentry warning, never a 500.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) return auth.response;

  const { data: groupRows, error: groupsErr } = await auth.supabaseAdmin
    .from('student_groups')
    .select('id, name')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'private');
  if (groupsErr) return serverError('group_list', groupsErr);
  const groups = (groupRows ?? []) as { id: string; name: string | null }[];
  if (groups.length === 0) {
    return NextResponse.json({ students: [], billingByStudent: {} });
  }
  const nameByGroup = new Map(groups.map((g) => [g.id, g.name]));

  const { data: enrollRows, error: enrollErr } = await auth.supabaseAdmin
    .from('enrollments')
    .select('id, student_id, group_id, status, joined_at')
    .in('group_id', groups.map((g) => g.id))
    .in('status', ['pending', 'active']);
  if (enrollErr) return serverError('enrollment_list', enrollErr);
  const enrollments = (enrollRows ?? []) as {
    id: string;
    student_id: string;
    group_id: string;
    status: string;
    joined_at: string | null;
  }[];

  const studentById = new Map<string, { name: string | null; phone: string | null }>();
  if (enrollments.length > 0) {
    const { data: studentRows, error: studentsErr } = await auth.supabaseAdmin
      .from('students')
      .select('id, name, phone')
      .in('id', enrollments.map((e) => e.student_id));
    if (studentsErr) return serverError('student_list', studentsErr);
    for (const s of (studentRows ?? []) as { id: string; name: string | null; phone: string | null }[]) {
      studentById.set(s.id, { name: s.name, phone: s.phone });
    }
  }

  // Pending first (they need action), then active; alpha within each.
  const rank = (s: string) => (s === 'pending' ? 0 : 1);
  const students = enrollments
    .map((e) => ({
      enrollmentId: e.id,
      studentId: e.student_id,
      name: studentById.get(e.student_id)?.name ?? null,
      phone: studentById.get(e.student_id)?.phone ?? null,
      status: e.status,
      groupId: e.group_id,
      groupName: nameByGroup.get(e.group_id) ?? null,
      joinedAt: e.joined_at,
    }))
    .sort(
      (a, b) =>
        rank(a.status) - rank(b.status) ||
        (a.name ?? '').localeCompare(b.name ?? ''),
    );

  // BEST-EFFORT: per-student billing summary (outstanding, last payment,
  // recent transactions) for the detail panel. Lesson charges only,
  // teacher-scoped, test rows excluded.
  const billingByStudent: Record<string, StudentBilling> = {};
  if (enrollments.length > 0) {
    const studentIds = Array.from(new Set(enrollments.map((e) => e.student_id)));
    const { data: txnRows, error: txnErr } = await auth.supabaseAdmin
      .from('transactions')
      .select('id, student_id, group_id, amount_billed, status, created_at, paid_at')
      .eq('teacher_id', auth.userId)
      .eq('kind', 'lesson')
      .eq('is_test', false)
      .in('student_id', studentIds)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (txnErr) {
      Sentry.withScope((scope) => {
        scope.setTag('route', ROUTE_TAG);
        scope.setTag('step', 'student_billing');
        Sentry.captureMessage(
          `teacher students billing lookup failed: ${txnErr.message}`,
          'warning',
        );
      });
    } else {
      for (const r of (txnRows ?? []) as {
        id: string;
        student_id: string | null;
        group_id: string | null;
        amount_billed: number | string | null;
        status: string | null;
        created_at: string;
        paid_at: string | null;
      }[]) {
        if (!r.student_id) continue;
        const entry = (billingByStudent[r.student_id] ??= {
          outstanding: 0,
          lastPaymentAt: null,
          transactions: [],
        });
        const amount = Number(r.amount_billed) || 0;
        if (r.status === 'pending') {
          entry.outstanding = round2(entry.outstanding + amount);
        }
        if (r.status === 'paid' && r.paid_at) {
          if (!entry.lastPaymentAt || r.paid_at > entry.lastPaymentAt) {
            entry.lastPaymentAt = r.paid_at;
          }
        }
        if (entry.transactions.length < MAX_TXNS_PER_STUDENT) {
          entry.transactions.push({
            id: r.id,
            date: r.created_at,
            amount: round2(amount),
            groupId: r.group_id,
            groupName: r.group_id ? (nameByGroup.get(r.group_id) ?? null) : null,
            status: r.status,
          });
        }
      }
    }
  }

  return NextResponse.json({ students, billingByStudent });
}
