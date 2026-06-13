import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import {
  cairoDateKey,
  parseCairoYmd,
  startOfUtcInstantForCairoCalendarDay,
} from '@/lib/cairo/day';

const ROUTE_TAG = 'api/teacher/center-attendance';
const SESSION_LIMIT = 20;

// The teacher's cut of center work lives in transactions.kind='center_fee'.
type CutRow = {
  session_id: string | null;
  teacher_net: number | string | null;
  snap_teacher_pct: number | string | null;
  amount_billed: number | string | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The teacher's net cut of a center-fee transaction. teacher_net is
 * authoritative when set; otherwise fall back to snap_teacher_pct *
 * amount_billed, then 0. (Same rule as /api/teacher/center-cuts.)
 */
function teacherCut(row: CutRow): number {
  const net = row.teacher_net == null ? null : Number(row.teacher_net);
  if (net != null && Number.isFinite(net)) return net;
  const pct = row.snap_teacher_pct == null ? null : Number(row.snap_teacher_pct);
  const billed = row.amount_billed == null ? null : Number(row.amount_billed);
  if (pct != null && Number.isFinite(pct) && billed != null && Number.isFinite(billed)) {
    return (pct / 100) * billed;
  }
  return 0;
}

function startOfCurrentCairoMonthIso(): string {
  const { y, m } = parseCairoYmd(cairoDateKey());
  const firstOfMonth = `${y}-${String(m).padStart(2, '0')}-01`;
  return startOfUtcInstantForCairoCalendarDay(firstOfMonth).toISOString();
}

/**
 * Center attendance + earnings (FREE zone). Recent attendance sessions for the
 * teacher's center groups, plus an earnings summary (this Cairo month and
 * all-time) of their center cut. Auth is requireTeacherAuth - NOT the private
 * gate - so every teacher sees it; all reads are scoped to the teacher
 * (teacher_id = auth.userId) and their active center memberships
 * (center_id IN auth.centerIds), is_test=false.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const serverError = (step: string, err: { message: string }) => {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', step);
      Sentry.captureException(err);
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  };

  if (auth.centerIds.length === 0) {
    return NextResponse.json({ earnedThisMonth: 0, earnedAllTime: 0, sessions: [] });
  }

  // Earnings: teacher cut from PAID center-fee transactions, all-time and this
  // Cairo month. CORE - an error here is a 500 (Rule 151).
  const { data: paidRows, error: paidErr } = await auth.supabaseAdmin
    .from('transactions')
    .select('session_id, teacher_net, snap_teacher_pct, amount_billed, paid_at')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'center_fee')
    .eq('status', 'paid')
    .eq('is_test', false)
    .in('center_id', auth.centerIds);
  if (paidErr) {
    return serverError('earnings', paidErr);
  }
  const monthStartIso = startOfCurrentCairoMonthIso();
  let earnedThisMonth = 0;
  let earnedAllTime = 0;
  for (const r of (paidRows ?? []) as (CutRow & { paid_at: string | null })[]) {
    const cut = teacherCut(r);
    earnedAllTime += cut;
    if (r.paid_at && r.paid_at >= monthStartIso) earnedThisMonth += cut;
  }

  // Center groups the teacher teaches, to scope the attendance list.
  const { data: groupRows, error: groupsErr } = await auth.supabaseAdmin
    .from('student_groups')
    .select('id, name')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'center')
    .in('center_id', auth.centerIds);
  if (groupsErr) {
    return serverError('center_groups', groupsErr);
  }
  const groupNameById = new Map<string, string | null>();
  for (const g of (groupRows ?? []) as { id: string; name: string | null }[]) {
    groupNameById.set(g.id, g.name);
  }
  const groupIds = Array.from(groupNameById.keys());

  if (groupIds.length === 0) {
    return NextResponse.json({
      earnedThisMonth: round2(earnedThisMonth),
      earnedAllTime: round2(earnedAllTime),
      sessions: [],
    });
  }

  const { data: sessionRows, error: sessionsErr } = await auth.supabaseAdmin
    .from('sessions')
    .select('id, group_id, scheduled_at')
    .in('group_id', groupIds)
    .order('scheduled_at', { ascending: false })
    .limit(SESSION_LIMIT);
  if (sessionsErr) {
    return serverError('center_sessions', sessionsErr);
  }
  const sessions = (sessionRows ?? []) as { id: string; group_id: string; scheduled_at: string }[];
  if (sessions.length === 0) {
    return NextResponse.json({
      earnedThisMonth: round2(earnedThisMonth),
      earnedAllTime: round2(earnedAllTime),
      sessions: [],
    });
  }
  const sessionIds = sessions.map((s) => s.id);

  const { data: scanRows, error: scansErr } = await auth.supabaseAdmin
    .from('attendance_scans')
    .select('session_id, billable')
    .in('session_id', sessionIds);
  if (scansErr) {
    return serverError('center_scans', scansErr);
  }
  const attendedBySession = new Map<string, number>();
  for (const s of (scanRows ?? []) as { session_id: string; billable: boolean }[]) {
    if (!s.billable) continue;
    attendedBySession.set(s.session_id, (attendedBySession.get(s.session_id) ?? 0) + 1);
  }

  const { data: cutRows, error: cutErr } = await auth.supabaseAdmin
    .from('transactions')
    .select('session_id, teacher_net, snap_teacher_pct, amount_billed')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'center_fee')
    .in('session_id', sessionIds);
  if (cutErr) {
    return serverError('session_cuts', cutErr);
  }
  const earnedBySession = new Map<string, number>();
  for (const r of (cutRows ?? []) as CutRow[]) {
    if (!r.session_id) continue;
    earnedBySession.set(r.session_id, (earnedBySession.get(r.session_id) ?? 0) + teacherCut(r));
  }

  return NextResponse.json({
    earnedThisMonth: round2(earnedThisMonth),
    earnedAllTime: round2(earnedAllTime),
    sessions: sessions.map((s) => ({
      session_id: s.id,
      date: cairoDateKey(new Date(s.scheduled_at)),
      group_name: groupNameById.get(s.group_id) ?? null,
      attended_count: attendedBySession.get(s.id) ?? 0,
      earned: round2(earnedBySession.get(s.id) ?? 0),
    })),
  });
}
