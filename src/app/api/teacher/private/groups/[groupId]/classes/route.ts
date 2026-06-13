import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { isUuid } from '@/lib/teacherPrivate';
import { cairoDateKey } from '@/lib/cairo/day';

const ROUTE_TAG = 'api/teacher/private/groups/[groupId]/classes';
const PAGE_SIZE = 20;

type SessionRow = { id: string; scheduled_at: string };
type ScanRow = { session_id: string; student_id: string; billable: boolean };
type TxnRow = {
  id: string;
  session_id: string;
  student_id: string;
  amount_billed: number | string | null;
  status: string;
};

function serverError(step: string, err: { message: string }): NextResponse {
  Sentry.withScope((scope) => {
    scope.setTag('route', ROUTE_TAG);
    scope.setTag('step', step);
    Sentry.captureException(err);
  });
  return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
}

/**
 * GET: the group's past sessions, newest first, with per-session attendance +
 * billing rollups and a per-student breakdown. Cursor-paginated (20/page) on
 * scheduled_at - one session per (group, Cairo day) keeps that key unique
 * enough to page on. Ownership goes group -> teacher_id (403 on mismatch).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) {
    return auth.response;
  }
  const { groupId } = await params;
  if (!isUuid(groupId)) {
    return NextResponse.json({ error: 'Not found', code: 'group_not_found' }, { status: 404 });
  }

  const { data: groupRow, error: groupErr } = await auth.supabaseAdmin
    .from('student_groups')
    .select('id, teacher_id, kind')
    .eq('id', groupId)
    .maybeSingle();
  if (groupErr) {
    return serverError('group_lookup', groupErr);
  }
  const group = groupRow as { teacher_id: string | null; kind: string | null } | null;
  if (!group) {
    return NextResponse.json({ error: 'Not found', code: 'group_not_found' }, { status: 404 });
  }
  if (group.teacher_id !== auth.userId || group.kind !== 'private') {
    return NextResponse.json({ error: 'Forbidden', code: 'not_your_group' }, { status: 403 });
  }

  const cursor = request.nextUrl.searchParams.get('cursor');

  let sessionQuery = auth.supabaseAdmin
    .from('sessions')
    .select('id, scheduled_at')
    .eq('group_id', groupId)
    .order('scheduled_at', { ascending: false })
    .limit(PAGE_SIZE + 1);
  if (cursor) {
    sessionQuery = sessionQuery.lt('scheduled_at', cursor);
  }
  const { data: sessionRows, error: sessionsErr } = await sessionQuery;
  if (sessionsErr) {
    return serverError('sessions_list', sessionsErr);
  }
  const allSessions = (sessionRows ?? []) as SessionRow[];
  const hasMore = allSessions.length > PAGE_SIZE;
  const sessions = hasMore ? allSessions.slice(0, PAGE_SIZE) : allSessions;
  const nextCursor = hasMore ? sessions[sessions.length - 1].scheduled_at : null;

  if (sessions.length === 0) {
    return NextResponse.json({ classes: [], next_cursor: null });
  }

  const sessionIds = sessions.map((s) => s.id);

  const { data: scanRows, error: scansErr } = await auth.supabaseAdmin
    .from('attendance_scans')
    .select('session_id, student_id, billable')
    .in('session_id', sessionIds);
  if (scansErr) {
    return serverError('scans_list', scansErr);
  }
  const scans = (scanRows ?? []) as ScanRow[];

  const { data: txnRows, error: txnErr } = await auth.supabaseAdmin
    .from('transactions')
    .select('id, session_id, student_id, amount_billed, status')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'lesson')
    .in('session_id', sessionIds);
  if (txnErr) {
    return serverError('transactions_list', txnErr);
  }
  const transactions = (txnRows ?? []) as TxnRow[];

  const studentIds = Array.from(
    new Set([...scans.map((s) => s.student_id), ...transactions.map((t) => t.student_id)]),
  );
  const studentById = new Map<string, { name: string | null; is_guest: boolean }>();
  if (studentIds.length > 0) {
    const { data: studentRows, error: studentsErr } = await auth.supabaseAdmin
      .from('students')
      .select('id, name, is_guest')
      .in('id', studentIds);
    if (studentsErr) {
      return serverError('students_list', studentsErr);
    }
    for (const s of (studentRows ?? []) as {
      id: string;
      name: string | null;
      is_guest: boolean | null;
    }[]) {
      studentById.set(s.id, { name: s.name, is_guest: s.is_guest === true });
    }
  }

  // Index scans + transactions by session for assembly.
  const scansBySession = new Map<string, ScanRow[]>();
  for (const sc of scans) {
    const list = scansBySession.get(sc.session_id) ?? [];
    list.push(sc);
    scansBySession.set(sc.session_id, list);
  }
  const txnsBySession = new Map<string, TxnRow[]>();
  for (const tx of transactions) {
    const list = txnsBySession.get(tx.session_id) ?? [];
    list.push(tx);
    txnsBySession.set(tx.session_id, list);
  }

  const classes = sessions.map((session) => {
    const sScans = scansBySession.get(session.id) ?? [];
    const sTxns = txnsBySession.get(session.id) ?? [];
    const txnByStudent = new Map<string, TxnRow>();
    for (const tx of sTxns) txnByStudent.set(tx.student_id, tx);

    // One row per student who either attended (billable scan) or was charged.
    const studentIdsForSession = Array.from(
      new Set([
        ...sScans.filter((sc) => sc.billable).map((sc) => sc.student_id),
        ...sTxns.map((tx) => tx.student_id),
      ]),
    );
    const attendedSet = new Set(
      sScans.filter((sc) => sc.billable).map((sc) => sc.student_id),
    );

    const students = studentIdsForSession.map((sid) => {
      const tx = txnByStudent.get(sid);
      const info = studentById.get(sid);
      return {
        student_id: sid,
        transaction_id: tx?.id ?? null,
        name: info?.name ?? null,
        is_guest: info?.is_guest === true,
        attended: attendedSet.has(sid),
        amount: tx ? Number(tx.amount_billed) || 0 : 0,
        status: tx?.status ?? null,
      };
    });

    const totalBilled = sTxns.reduce((acc, tx) => acc + (Number(tx.amount_billed) || 0), 0);
    const totalCollected = sTxns
      .filter((tx) => tx.status === 'paid')
      .reduce((acc, tx) => acc + (Number(tx.amount_billed) || 0), 0);

    return {
      session_id: session.id,
      scheduled_at: session.scheduled_at,
      date: cairoDateKey(new Date(session.scheduled_at)),
      attended_count: attendedSet.size,
      total_billed: totalBilled,
      total_collected: totalCollected,
      outstanding: totalBilled - totalCollected,
      students,
    };
  });

  return NextResponse.json({ classes, next_cursor: nextCursor });
}
