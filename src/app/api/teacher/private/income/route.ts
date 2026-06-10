import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherPrivateAccess } from '@/lib/centerAuth';
import {
  cairoDateKey,
  parseCairoYmd,
  startOfUtcInstantForCairoCalendarDay,
} from '@/lib/cairo/day';

type GroupIncome = {
  id: string;
  name: string | null;
  collectedThisMonth: number;
  outstanding: number;
};

type ActivityItem = {
  sessionId: string;
  date: string;
  groupId: string | null;
  groupName: string | null;
  amountBilled: number;
};

type TxnRow = {
  group_id: string | null;
  amount_billed: number | string | null;
};

type ActivityRow = TxnRow & {
  id: string;
  session_id: string | null;
  created_at: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumBilled(rows: TxnRow[]): number {
  return round2(rows.reduce((acc, r) => acc + (Number(r.amount_billed) || 0), 0));
}

/** First UTC instant of the current Cairo calendar month (billing windows are Cairo-anchored). */
function startOfCurrentCairoMonthIso(): string {
  const { y, m } = parseCairoYmd(cairoDateKey());
  const firstOfMonth = `${y}-${String(m).padStart(2, '0')}-01`;
  return startOfUtcInstantForCairoCalendarDay(firstOfMonth).toISOString();
}

/**
 * Private income view (the teacher portal hero). PRIVATE-ENGINE data: the
 * FIRST line of defense is requireTeacherPrivateAccess - a lapsed or
 * never-subscribed teacher calling this directly gets the gate's 403
 * NO_PRIVATE_ACCESS, a gate RPC error gets its 500, and no data query runs.
 *
 * Tenant scoping: every query filters on the authenticated teacher's id
 * (student_groups.teacher_id / transactions.teacher_id / ar_by_teacher
 * .teacher_id, all = auth.userId). transactions.teacher_id is written by
 * finish_class_and_bill from the group's teacher_id; ar_by_teacher aggregates
 * transactions by the same column.
 *
 * Rule 151: groups / collected / outstanding / pending are CORE for this view
 * (error -> 500 + Sentry). Recent activity is best-effort (error -> [] +
 * Sentry warning) so a failure there does not blank the headline numbers.
 *
 * Money: amounts are summed server-side from numeric rows and rounded to 2
 * decimals; formatting happens only in the UI via formatCurrency.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherPrivateAccess(request);
  if (!auth.ok) {
    return auth.response;
  }

  const serverError = (step: string, err: { message: string }) => {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/teacher/private/income');
      scope.setTag('step', step);
      Sentry.captureException(err);
    });
    return NextResponse.json(
      { error: 'Server error', code: 'server_error' },
      { status: 500 },
    );
  };

  // CORE: the teacher's private groups (kind='private' rows carry the private
  // practice; center-kind groups belong to the center zone, not this view).
  const { data: groupRows, error: groupsErr } = await auth.supabaseAdmin
    .from('student_groups')
    .select('id, name')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'private');
  if (groupsErr) {
    return serverError('private_groups', groupsErr);
  }
  const groups = (groupRows ?? []) as { id: string; name: string | null }[];

  // CORE: lesson charges paid during the current Cairo month.
  const monthStartIso = startOfCurrentCairoMonthIso();
  const { data: paidRows, error: paidErr } = await auth.supabaseAdmin
    .from('transactions')
    .select('group_id, amount_billed')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'lesson')
    .eq('status', 'paid')
    .eq('is_test', false)
    .gte('paid_at', monthStartIso);
  if (paidErr) {
    return serverError('collected_month', paidErr);
  }
  const paid = (paidRows ?? []) as TxnRow[];

  // CORE: still-pending lesson charges (raw billed-not-paid, per group).
  const { data: pendingRows, error: pendingErr } = await auth.supabaseAdmin
    .from('transactions')
    .select('group_id, amount_billed')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'lesson')
    .eq('status', 'pending')
    .eq('is_test', false);
  if (pendingErr) {
    return serverError('pending_by_group', pendingErr);
  }
  const pending = (pendingRows ?? []) as TxnRow[];

  // CORE: headline outstanding from the canonical AR view (credit-aware:
  // total_outstanding = unpaid minus active student credits, floored at 0).
  // Per-group outstanding below is the raw pending sum, because credits are
  // student-scoped, not group-scoped, and cannot be allocated to a group.
  const { data: arRow, error: arErr } = await auth.supabaseAdmin
    .from('ar_by_teacher')
    .select('total_outstanding')
    .eq('teacher_id', auth.userId)
    .maybeSingle();
  if (arErr) {
    return serverError('ar_headline', arErr);
  }
  const outstanding = round2(
    Number((arRow as { total_outstanding?: number | string | null } | null)?.total_outstanding) || 0,
  );

  const collectedThisMonth = sumBilled(paid);

  const byGroup = (rows: TxnRow[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (!r.group_id) continue;
      m.set(r.group_id, (m.get(r.group_id) ?? 0) + (Number(r.amount_billed) || 0));
    }
    return m;
  };
  const paidByGroup = byGroup(paid);
  const pendingByGroup = byGroup(pending);

  const groupIncomes: GroupIncome[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    collectedThisMonth: round2(paidByGroup.get(g.id) ?? 0),
    outstanding: round2(pendingByGroup.get(g.id) ?? 0),
  }));

  // BEST-EFFORT: recent billed classes. Charges are per attendee; a "billed
  // class" is the session, so recent rows are folded by session_id and the
  // attendees' amounts summed. A failure here degrades to an empty list.
  let recentActivity: ActivityItem[] = [];
  const { data: activityRows, error: activityErr } = await auth.supabaseAdmin
    .from('transactions')
    .select('id, session_id, group_id, amount_billed, created_at')
    .eq('teacher_id', auth.userId)
    .eq('kind', 'lesson')
    .eq('is_test', false)
    .order('created_at', { ascending: false })
    .limit(60);
  if (activityErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/teacher/private/income');
      scope.setTag('step', 'recent_activity');
      Sentry.captureMessage(
        `teacher income recent-activity lookup failed: ${activityErr.message}`,
        'warning',
      );
    });
  } else {
    const nameByGroup = new Map(groups.map((g) => [g.id, g.name]));
    const bySession = new Map<string, ActivityItem>();
    for (const r of (activityRows ?? []) as ActivityRow[]) {
      const key = r.session_id ?? r.id;
      const existing = bySession.get(key);
      if (existing) {
        existing.amountBilled = round2(existing.amountBilled + (Number(r.amount_billed) || 0));
        if (r.created_at > existing.date) existing.date = r.created_at;
      } else {
        bySession.set(key, {
          sessionId: key,
          date: r.created_at,
          groupId: r.group_id,
          groupName: r.group_id ? (nameByGroup.get(r.group_id) ?? null) : null,
          amountBilled: round2(Number(r.amount_billed) || 0),
        });
      }
    }
    recentActivity = Array.from(bySession.values())
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 10);
  }

  return NextResponse.json({
    collectedThisMonth,
    outstanding,
    groups: groupIncomes,
    recentActivity,
  });
}
