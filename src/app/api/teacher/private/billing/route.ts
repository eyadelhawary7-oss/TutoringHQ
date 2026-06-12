import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';

const ROUTE_TAG = 'api/teacher/private/billing';
const MAX_SESSIONS = 50;

function serverError(step: string, err: { message: string }): NextResponse {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type TxnRow = {
  id: string;
  session_id: string | null;
  group_id: string | null;
  amount_billed: number | string | null;
  status: string | null;
  created_at: string;
};

type SessionAgg = {
  sessionId: string;
  date: string;
  groupId: string | null;
  groupName: string | null;
  total: number;
  attendees: number;
  paidCount: number;
};

/**
 * GET: attendance + billing history for the teacher's private practice. Each
 * billed class is one row, folded from per-attendee lesson transactions
 * (attendees = transaction count, total = summed amount, status = paid when
 * every attendee paid else pending). PRIVATE data: requireTeacherPrivateAccess
 * gates it; tenant scope is transactions.teacher_id = auth.userId.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) return auth.response;

  // Group names for display (best-effort: a failed name lookup degrades to null
  // names, not a 500).
  const { data: groupRows } = await auth.supabaseAdmin
    .from('student_groups')
    .select('id, name')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'private');
  const nameByGroup = new Map(
    ((groupRows ?? []) as { id: string; name: string | null }[]).map((g) => [g.id, g.name]),
  );

  const { data: txnRows, error: txnErr } = await auth.supabaseAdmin
    .from('transactions')
    .select('id, session_id, group_id, amount_billed, status, created_at')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'lesson')
    .eq('is_test', false)
    .order('created_at', { ascending: false })
    .limit(400);
  if (txnErr) return serverError('transactions', txnErr);

  const bySession = new Map<string, SessionAgg>();
  for (const r of (txnRows ?? []) as TxnRow[]) {
    const key = r.session_id ?? r.id;
    const amount = Number(r.amount_billed) || 0;
    const isPaid = r.status === 'paid';
    const existing = bySession.get(key);
    if (existing) {
      existing.total = round2(existing.total + amount);
      existing.attendees += 1;
      if (isPaid) existing.paidCount += 1;
      if (r.created_at > existing.date) existing.date = r.created_at;
    } else {
      bySession.set(key, {
        sessionId: key,
        date: r.created_at,
        groupId: r.group_id,
        groupName: r.group_id ? (nameByGroup.get(r.group_id) ?? null) : null,
        total: round2(amount),
        attendees: 1,
        paidCount: isPaid ? 1 : 0,
      });
    }
  }

  const sessions = Array.from(bySession.values())
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, MAX_SESSIONS)
    .map((s) => ({
      sessionId: s.sessionId,
      date: s.date,
      groupId: s.groupId,
      groupName: s.groupName,
      total: s.total,
      attendees: s.attendees,
      status: s.paidCount >= s.attendees ? 'paid' : 'pending',
    }));

  return NextResponse.json({ sessions });
}
