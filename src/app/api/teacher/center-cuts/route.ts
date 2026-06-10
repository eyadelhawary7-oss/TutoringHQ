import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import {
  cairoDateKey,
  parseCairoYmd,
  startOfUtcInstantForCairoCalendarDay,
} from '@/lib/cairo/day';

const ROUTE_TAG = 'api/teacher/center-cuts';

// Center-fee charges (the teacher's cut of center-group work) live in
// transactions with kind='center_fee' (verified CHECK: lesson | center_fee).
type CutRow = {
  center_id: string | null;
  group_id: string | null;
  teacher_net: number | string | null;
  snap_teacher_pct: number | string | null;
  amount_billed: number | string | null;
  created_at: string;
};

type GroupCut = {
  id: string;
  name: string | null;
  collectedThisMonth: number;
  outstanding: number;
  snapTeacherPct: number | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The teacher's cut of a center-fee transaction. teacher_net is authoritative
 * when set, but no current write path populates it (the manual lesson flow
 * leaves the commission/net columns null, and the center-fee billing path is
 * not yet live), so fall back to snap_teacher_pct * amount_billed, then 0.
 * When the Paymob split finalizer lands and writes teacher_net, this picks it
 * up automatically without a code change.
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

/** First UTC instant of the current Cairo calendar month (Cairo-anchored windows). */
function startOfCurrentCairoMonthIso(): string {
  const { y, m } = parseCairoYmd(cairoDateKey());
  const firstOfMonth = `${y}-${String(m).padStart(2, '0')}-01`;
  return startOfUtcInstantForCairoCalendarDay(firstOfMonth).toISOString();
}

/**
 * Center-cut tracker (FREE zone): what a teacher's center groups owe them.
 * Auth is requireTeacherAuth - NOT the private gate - so every teacher sees
 * it regardless of subscription. All queries are scoped to the authenticated
 * teacher (teacher_id = auth.userId) and to the centres they are an active
 * member of (center_id IN auth.centerIds, the membership list from auth, never
 * a body param), is_test=false.
 *
 * Rule 151: the paid/pending headline sums are CORE -> 500 + Sentry on error.
 * Centre names and the per-group breakdown are display extras -> best-effort
 * (empty/null + Sentry warning) so a display hiccup never blanks the numbers.
 * Money is summed server-side and rounded to 2 decimals; the UI only formats.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  // No active memberships -> nothing to owe. Skip every query.
  if (auth.centerIds.length === 0) {
    return NextResponse.json({
      centers: [],
      totalCollectedThisMonth: 0,
      totalOutstanding: 0,
    });
  }

  const serverError = (step: string, err: { message: string }) => {
    Sentry.withScope((scope) => {
      scope.setTag('route', ROUTE_TAG);
      scope.setTag('step', step);
      Sentry.captureException(err);
    });
    return NextResponse.json(
      { error: 'Server error', code: 'server_error' },
      { status: 500 },
    );
  };

  const cutColumns = 'center_id, group_id, teacher_net, snap_teacher_pct, amount_billed, created_at';

  // CORE: teacher cut paid this Cairo month, per centre.
  const monthStartIso = startOfCurrentCairoMonthIso();
  const { data: paidRows, error: paidErr } = await auth.supabaseAdmin
    .from('transactions')
    .select(cutColumns)
    .eq('teacher_id', auth.userId)
    .eq('kind', 'center_fee')
    .eq('status', 'paid')
    .eq('is_test', false)
    .in('center_id', auth.centerIds)
    .gte('paid_at', monthStartIso);
  if (paidErr) {
    return serverError('collected_month', paidErr);
  }
  const paid = (paidRows ?? []) as CutRow[];

  // CORE: teacher cut still pending (outstanding), per centre.
  const { data: pendingRows, error: pendingErr } = await auth.supabaseAdmin
    .from('transactions')
    .select(cutColumns)
    .eq('teacher_id', auth.userId)
    .eq('kind', 'center_fee')
    .eq('status', 'pending')
    .eq('is_test', false)
    .in('center_id', auth.centerIds);
  if (pendingErr) {
    return serverError('outstanding', pendingErr);
  }
  const pending = (pendingRows ?? []) as CutRow[];

  // BEST-EFFORT: centre display names.
  const nameByCenter = new Map<string, string | null>();
  {
    const { data: centerRows, error: centersErr } = await auth.supabaseAdmin
      .from('centers')
      .select('id, name')
      .in('id', auth.centerIds);
    if (centersErr) {
      Sentry.withScope((scope) => {
        scope.setTag('route', ROUTE_TAG);
        scope.setTag('step', 'center_names');
        Sentry.captureMessage(
          `center-cuts centre-name lookup failed: ${centersErr.message}`,
          'warning',
        );
      });
    } else {
      for (const c of (centerRows ?? []) as { id: string; name: string | null }[]) {
        nameByCenter.set(c.id, c.name);
      }
    }
  }

  // BEST-EFFORT: centre-group names for the per-group breakdown. The per-group
  // sums come from the CORE transaction rows above, so a failure here drops the
  // breakdown to [] without touching the headline numbers. center_id is fetched
  // so zero-activity groups still place under their owning centre.
  const groupNameById = new Map<string, string | null>();
  const groupCenterById = new Map<string, string>();
  let groupBreakdownAvailable = true;
  {
    const { data: groupRows, error: groupsErr } = await auth.supabaseAdmin
      .from('student_groups')
      .select('id, name, center_id')
      .eq('teacher_id', auth.userId)
      .eq('kind', 'center')
      .in('center_id', auth.centerIds);
    if (groupsErr) {
      groupBreakdownAvailable = false;
      Sentry.withScope((scope) => {
        scope.setTag('route', ROUTE_TAG);
        scope.setTag('step', 'group_breakdown');
        Sentry.captureMessage(
          `center-cuts group-breakdown lookup failed: ${groupsErr.message}`,
          'warning',
        );
      });
    } else {
      for (const g of (groupRows ?? []) as { id: string; name: string | null; center_id: string }[]) {
        groupNameById.set(g.id, g.name);
        groupCenterById.set(g.id, g.center_id);
      }
    }
  }

  // Accumulate cut sums per centre and per group.
  type Acc = { collected: number; outstanding: number };
  const centerAcc = new Map<string, Acc>();
  const groupAcc = new Map<string, Acc>();
  const groupSnapPct = new Map<string, { pct: number; at: string }>();

  for (const id of auth.centerIds) centerAcc.set(id, { collected: 0, outstanding: 0 });

  const accumulate = (rows: CutRow[], bucket: 'collected' | 'outstanding') => {
    for (const r of rows) {
      if (!r.center_id) continue;
      const cut = teacherCut(r);
      const ca = centerAcc.get(r.center_id) ?? { collected: 0, outstanding: 0 };
      ca[bucket] += cut;
      centerAcc.set(r.center_id, ca);
      if (r.group_id) {
        const ga = groupAcc.get(r.group_id) ?? { collected: 0, outstanding: 0 };
        ga[bucket] += cut;
        groupAcc.set(r.group_id, ga);
        // Most recent snap_teacher_pct wins (by created_at).
        const pct = r.snap_teacher_pct == null ? null : Number(r.snap_teacher_pct);
        if (pct != null && Number.isFinite(pct)) {
          const prev = groupSnapPct.get(r.group_id);
          if (!prev || r.created_at > prev.at) {
            groupSnapPct.set(r.group_id, { pct, at: r.created_at });
          }
        }
      }
    }
  };
  accumulate(paid, 'collected');
  accumulate(pending, 'outstanding');

  // The breakdown lists every named centre group under its owning centre (from
  // the student_groups query), carrying its cut sums from the transaction rows.
  // Without that query we cannot label groups, so it degrades to [] per the
  // best-effort contract.
  const groupsForCenter = (centerId: string): GroupCut[] => {
    if (!groupBreakdownAvailable) return [];
    const out: GroupCut[] = [];
    for (const [gid, gCenterId] of groupCenterById) {
      if (gCenterId !== centerId) continue;
      const ga = groupAcc.get(gid) ?? { collected: 0, outstanding: 0 };
      out.push({
        id: gid,
        name: groupNameById.get(gid) ?? null,
        collectedThisMonth: round2(ga.collected),
        outstanding: round2(ga.outstanding),
        snapTeacherPct: groupSnapPct.get(gid)?.pct ?? null,
      });
    }
    return out;
  };

  let totalCollected = 0;
  let totalOutstanding = 0;
  const centers = auth.centerIds.map((id) => {
    const acc = centerAcc.get(id) ?? { collected: 0, outstanding: 0 };
    const collected = round2(acc.collected);
    const outstanding = round2(acc.outstanding);
    totalCollected += collected;
    totalOutstanding += outstanding;
    return {
      id,
      name: nameByCenter.get(id) ?? null,
      collectedThisMonth: collected,
      outstanding,
      groups: groupsForCenter(id),
    };
  });

  return NextResponse.json({
    centers,
    totalCollectedThisMonth: round2(totalCollected),
    totalOutstanding: round2(totalOutstanding),
  });
}
