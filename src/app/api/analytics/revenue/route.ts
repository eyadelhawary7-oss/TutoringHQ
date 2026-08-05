import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { isSuperAdminPhone } from '@/lib/admin-access';
import { phoneFromCenterhqAuthEmail } from '@/lib/ownerPhone';
import { getStudentBalances, sumOutstanding } from '@/lib/studentBalance';
import { centerAccessGateResponse } from '@/lib/centerAccessGate';
import {
  cairoMonthKey,
  cairoMonthKeyPlusMonths,
  cairoMonthUtcBounds,
  startOfUtcInstantForCairoMonth,
} from '@/lib/cairo/day';

const EMPTY_ANALYTICS_PAYLOAD = {
  mrr: 0,
  outstanding_total: 0,
  collection_rate: 0,
  avg_payment_per_student: 0,
  revenue_by_group: [] as { group_id: string; group_name: string; amount: number }[],
  mrr_trend: [] as { month: string; amount: number }[],
  payment_method_distribution: [] as { method: string; amount: number }[],
  attendance_heatmap: [] as { day: number; week: number; count: number }[],
  aging_report: [] as {
    student_id: string;
    student_name: string;
    group_name: string;
    days_overdue: number;
    amount: number;
  }[],
  expenses_by_month: {} as Record<string, { rent: number; salaries: number; utilities: number; other: number }>,
  income_by_month: {} as Record<string, number>,
  pnl_months: [] as string[],
  current_period_type: 'normal',
  academic_year_average_attendance: null as number | null,
  enrollment_surge_active: false,
  surge_message: null as string | null,
};

type AnalyticsAuthContext = {
  centerId: string | null;
  supabaseAdmin: SupabaseClient;
  isSuperAdmin: boolean;
};

async function getAnalyticsAuth(request: NextRequest): Promise<AnalyticsAuthContext | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace('Bearer ', '');
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id, phone')
    .eq('id', user.id)
    .maybeSingle();

  const { data: adminRecord } = await supabaseAdmin.from('admin_users').select('id').eq('id', user.id).maybeSingle();

  if (!userRecord && !adminRecord) return null;

  // Super-admin authority comes from admin_users + SUPER_ADMIN_PHONES only.
  // Never trust `users.role` - it is the centre-tenant role and is writable by
  // centre admins (was the source of a prior privilege-escalation P0).
  //
  // Phone source: derive from the auth.users.email local-part (`<digits>@centerhq.local`),
  // NOT public.users.phone. The email is set server-side and is not writable via the
  // /api/db proxy; public.users.phone is centre-tenant data. Mirrors centerAuth.ts /
  // admin-auth.ts. Fall back to auth.users.phone then public.users.phone (defence-in-depth).
  const emailPhone = phoneFromCenterhqAuthEmail((user as { email?: string | null }).email);
  const phone =
    emailPhone ??
    (user as { phone?: string | null }).phone ??
    (userRecord as { phone?: string | null } | null)?.phone ??
    null;
  const isSuperAdmin = !!adminRecord || isSuperAdminPhone(phone);

  let centerId = (userRecord as { center_id?: string | null } | null)?.center_id ?? null;
  const qp = request.nextUrl.searchParams.get('center_id');
  if (isSuperAdmin && qp) {
    centerId = qp;
  }

  if (!isSuperAdmin && !centerId) return null;

  return { centerId, supabaseAdmin, isSuperAdmin };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getAnalyticsAuth(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { centerId, supabaseAdmin, isSuperAdmin } = ctx;

    if (!centerId) {
      if (isSuperAdmin) {
        return NextResponse.json(EMPTY_ANALYTICS_PAYLOAD);
      }
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Part 6 (BLOCK): a locked centre sees only the invoice and a pay button, and
    // this finance dashboard exposes student names and parent phones. Inherit the
    // suspension / lock gate the hand-rolled auth skipped. Super-admins bypass,
    // matching requireCenterAuth, so cross-centre support views keep working.
    if (!isSuperAdmin) {
      const gate = await centerAccessGateResponse(supabaseAdmin, centerId);
      if (gate) return gate;
    }

    const now = new Date();

    /*
     * CAIRO months, not the server's.
     *
     * These were `new Date(now.getFullYear(), now.getMonth(), 1)` — server-local,
     * which is UTC on Vercel — while the analytics header labels the same window
     * with `formatCalendarMonthYyyyMmInCairo()`. That is a real month-boundary
     * defect, not a naming quibble: between 22:00/23:00 UTC on the last day of a
     * Cairo month and 00:00 UTC, Cairo has rolled over and the server has not, so
     * the header read the NEW month while `mrr`, the trend's emphasised final bar
     * and the aging fallback were all still computing the OLD one. CLAUDE.md:
     * Cairo time, not UTC, for any user-visible calendar window.
     *
     * Bounds are half-open [start, endExclusive) — the old `monthEnd` was the last
     * day at 23:59:59, which silently dropped any payment in that final second.
     */
    const currentMonthKey = cairoMonthKey(now);
    const { start: monthStart, endExclusive: monthEndExclusive } =
      cairoMonthUtcBounds(currentMonthKey);
    const sixMonthsAgo = startOfUtcInstantForCairoMonth(
      cairoMonthKeyPlusMonths(currentMonthKey, -5),
    );

    const [
      paymentsRes,
      studentsRes,
      groupsRes,
      expensesRes,
    ] = await Promise.all([
      supabaseAdmin
        .from('payments')
        .select('amount, paid_at, method, group_id, student_id, status')
        .eq('center_id', centerId)
        .gte('paid_at', sixMonthsAgo.toISOString()),
      supabaseAdmin
        .from('students')
        .select('id, name, phone, student_number')
        .eq('center_id', centerId),
      supabaseAdmin
        .from('student_groups')
        .select('id, name')
        .eq('center_id', centerId),
      supabaseAdmin
        .from('center_expenses')
        .select('month, rent, salaries, utilities, other')
        .eq('center_id', centerId)
        .gte('month', sixMonthsAgo.toISOString().slice(0, 7) + '-01'),
    ]);

    const payments = (paymentsRes.data || []) as { amount: number; paid_at: string; method: string; group_id: string | null; student_id: string | null; status: string }[];
    const studentRows = (studentsRes.data || []) as { id: string; name: string; phone: string | null; student_number: string | null }[];
    const balances = await getStudentBalances(supabaseAdmin, { centerId, activeOnly: true });
    const studentsWithBalance = studentRows
      .map((s) => ({
        id: s.id,
        name: s.name,
        balance_due: balances.get(s.id)?.balance ?? 0,
        phone: s.phone,
        student_number: s.student_number,
      }))
      .filter((s) => s.balance_due > 0);
    const groups = (groupsRes.data || []) as { id: string; name: string }[];
    const expenses = (expensesRes.data || []) as { month: string; rent: number; salaries: number; utilities: number; other: number }[];

    const groupMap = new Map(groups.map((g) => [g.id, g.name]));

    const confirmedPayments = payments.filter((p) => p.status === 'confirmed' || p.status === 'paid');
    const monthPayments = confirmedPayments.filter((p) => p.paid_at >= monthStart.toISOString() && p.paid_at < monthEndExclusive.toISOString());

    const mrr = monthPayments.reduce((s, p) => s + (p.amount ?? 0), 0);
    const outstanding_total = sumOutstanding(balances.values());

    const expectedThisMonth = studentsWithBalance.length > 0
      ? studentsWithBalance.reduce((s, st) => s + (Number(st.balance_due) || 0), 0) + monthPayments.reduce((s, p) => s + (p.amount ?? 0), 0)
      : monthPayments.reduce((s, p) => s + (p.amount ?? 0), 0);
    const collectedThisMonth = monthPayments.reduce((s, p) => s + (p.amount ?? 0), 0);
    const collection_rate = expectedThisMonth > 0 ? (collectedThisMonth / expectedThisMonth) * 100 : 100;

    const totalStudentsPaid = new Set(monthPayments.map((p) => p.student_id).filter(Boolean)).size;
    const avg_payment_per_student = totalStudentsPaid > 0 ? collectedThisMonth / totalStudentsPaid : 0;

    const revenueByGroup: { group_id: string; group_name: string; amount: number }[] = [];
    const groupRevenue = new Map<string, number>();
    for (const p of confirmedPayments) {
      const gid = p.group_id ?? 'ungrouped';
      groupRevenue.set(gid, (groupRevenue.get(gid) ?? 0) + (p.amount ?? 0));
    }
    for (const [gid, amt] of groupRevenue) {
      const group_name =
        gid === 'ungrouped'
          ? groups.length > 0
            ? ''
            : ','
          : (groupMap.get(gid) ?? gid);
      revenueByGroup.push({
        group_id: gid,
        group_name,
        amount: amt,
      });
    }
    revenueByGroup.sort((a, b) => b.amount - a.amount);

    const byMonth: Record<string, number> = {};
    for (let i = 5; i >= 0; i--) {
      byMonth[cairoMonthKeyPlusMonths(currentMonthKey, -i)] = 0;
    }
    confirmedPayments.forEach((p) => {
      if (!p.paid_at) return;
      // Bucket by the payment's CAIRO month so a payment made at 23:30 Cairo on
      // the 31st does not land in the next month's bar.
      const key = cairoMonthKey(new Date(p.paid_at));
      if (key in byMonth) byMonth[key] += p.amount ?? 0;
    });
    const mrr_trend = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({ month, amount }));

    const methodMap = new Map<string, number>();
    confirmedPayments.forEach((p) => {
      const method = p.method || 'other';
      methodMap.set(method, (methodMap.get(method) ?? 0) + (p.amount ?? 0));
    });
    const payment_method_distribution = Array.from(methodMap.entries()).map(([method, amount]) => ({ method, amount }));

    const studentIds = studentsWithBalance.map((s) => s.id);
    let lastPayments: { student_id: string; paid_at: string }[] = [];
    if (studentIds.length > 0) {
      const { data: lastP } = await supabaseAdmin
        .from('payments')
        .select('student_id, paid_at')
        .in('student_id', studentIds)
        .eq('center_id', centerId)
        .eq('status', 'confirmed')
        .order('paid_at', { ascending: false });
      lastPayments = (lastP || []) as { student_id: string; paid_at: string }[];
    }

    const lastPaymentByStudent = new Map<string, string>();
    for (const lp of lastPayments) {
      if (lp.student_id && !lastPaymentByStudent.has(lp.student_id)) {
        lastPaymentByStudent.set(lp.student_id, lp.paid_at);
      }
    }

    const membersRes = studentIds.length > 0
      ? await supabaseAdmin
          .from('student_group_members')
          .select('student_id, group_id')
          .in('student_id', studentIds)
      : { data: [] };
    const members = (membersRes.data || []) as { student_id: string; group_id: string }[];
    const studentGroups = new Map<string, string[]>();
    for (const m of members) {
      const gname = groupMap.get(m.group_id) ?? '';
      if (!studentGroups.has(m.student_id)) studentGroups.set(m.student_id, []);
      if (gname) studentGroups.get(m.student_id)!.push(gname);
    }

    const firstOfMonth = monthStart.getTime();
    const todayMs = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;

    const aging_report: { student_id: string; student_name: string; group_name: string; days_overdue: number; amount: number }[] = [];
    for (const st of studentsWithBalance) {
      const lastPaid = lastPaymentByStudent.get(st.id);
      const dueDate = lastPaid ? new Date(lastPaid).getTime() + 30 * msPerDay : firstOfMonth;
      const days_overdue = Math.max(0, Math.floor((todayMs - dueDate) / msPerDay));
      const groupNames = studentGroups.get(st.id) ?? [];
      aging_report.push({
        student_id: st.id,
        student_name: st.name ?? '',
        group_name: groupNames.join(' • ') || ',',
        days_overdue,
        amount: Number(st.balance_due) || 0,
      });
    }
    aging_report.sort((a, b) => b.days_overdue - a.days_overdue);

    const expensesByMonth = new Map<string, { rent: number; salaries: number; utilities: number; other: number }>();
    for (const e of expenses) {
      const key = e.month.slice(0, 7);
      expensesByMonth.set(key, {
        rent: Number(e.rent) || 0,
        salaries: Number(e.salaries) || 0,
        utilities: Number(e.utilities) || 0,
        other: Number(e.other) || 0,
      });
    }

    const incomeByMonth = new Map<string, number>();
    for (const t of mrr_trend) {
      incomeByMonth.set(t.month, t.amount);
    }

    const pnl_months = [...new Set([...expensesByMonth.keys(), ...incomeByMonth.keys()])].sort();

    // Academic: current_period_type, academic_year_average_attendance, enrollment_surge_active, surge_message
    const { data: academicYear } = await supabaseAdmin
      .from('academic_years')
      .select('id, start_date, end_date')
      .eq('center_id', centerId)
      .eq('is_current', true)
      .maybeSingle();

    let current_period_type = 'normal';
    let academic_year_average_attendance: number | null = null;
    let enrollment_surge_active = false;
    let surge_message: string | null = null;

    if (academicYear) {
      const { data: periods } = await supabaseAdmin
        .from('academic_periods')
        .select('period_type, start_date, end_date')
        .eq('academic_year_id', (academicYear as { id: string }).id);
      const periodList = (periods ?? []) as { period_type: string; start_date: string; end_date: string }[];
      const todayStr = now.toISOString().slice(0, 10);
      for (const p of periodList) {
        if (todayStr >= p.start_date && todayStr <= p.end_date) {
          current_period_type = p.period_type;
          break;
        }
      }

      const yearStart = new Date((academicYear as { start_date: string }).start_date + 'T12:00:00');
      const { data: yearScans } = await supabaseAdmin
        .from('attendance_scans')
        .select('student_id, scanned_at')
        .eq('center_id', centerId)
        .gte('scanned_at', yearStart.toISOString());
      const { count: totalStudents } = await supabaseAdmin
        .from('students')
        .select('*', { count: 'exact', head: true })
        .eq('center_id', centerId);
      const uniquePerWeek = new Map<string, Set<string>>();
      for (const s of (yearScans || []) as { student_id: string; scanned_at: string }[]) {
        const d = new Date(s.scanned_at);
        const weekKey = `${d.getFullYear()}-W${Math.ceil(d.getDate() / 7)}`;
        if (!uniquePerWeek.has(weekKey)) uniquePerWeek.set(weekKey, new Set());
        uniquePerWeek.get(weekKey)!.add(s.student_id);
      }
      const avgWeeklyUnique = uniquePerWeek.size > 0
        ? [...uniquePerWeek.values()].reduce((s, set) => s + set.size, 0) / uniquePerWeek.size
        : 0;
      academic_year_average_attendance = (totalStudents ?? 0) > 0
        ? Math.round((avgWeeklyUnique / (totalStudents ?? 1)) * 10000) / 100
        : 0;

      const twentyOneDaysAgo = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000);
      const { data: newStudents } = await supabaseAdmin
        .from('students')
        .select('id, created_at')
        .eq('center_id', centerId)
        .gte('created_at', twentyOneDaysAgo.toISOString());
      const studentsCreated = (newStudents ?? []) as { id: string; created_at: string }[];
      const examPeriods = periodList.filter((p) => p.period_type === 'exam');
      for (const ep of examPeriods) {
        const examStart = new Date(ep.start_date + 'T12:00:00');
        const daysToExam = Math.ceil((examStart.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
        if (daysToExam > 0 && daysToExam <= 21) {
          const newLast7 = studentsCreated.filter((s) => new Date(s.created_at) >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)).length;
          const newPrev14 = studentsCreated.filter((s) => {
            const d = new Date(s.created_at);
            return d >= new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000) && d < new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          }).length;
          const avg3Week = (newLast7 + newPrev14) / 3;
          const growthPct = avg3Week > 0 ? ((newLast7 - avg3Week) / avg3Week) * 100 : 0;
          if (growthPct > 5) {
            enrollment_surge_active = true;
            surge_message = `موسم الامتحانات قادم خلال ${daysToExam} يوم`;
            break;
          }
        }
      }
    }

    const heatmapWeeks = 12;
    const heatmapStart = new Date(now);
    heatmapStart.setDate(heatmapStart.getDate() - heatmapWeeks * 7);
    const { data: heatmapScans } = await supabaseAdmin
      .from('attendance_scans')
      .select('scanned_at')
      .eq('center_id', centerId)
      .gte('scanned_at', heatmapStart.toISOString());

    const heatmapBucket = new Map<string, number>();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    for (const row of (heatmapScans || []) as { scanned_at: string }[]) {
      const d = new Date(row.scanned_at);
      const day = d.getDay();
      const ms = d.getTime() - heatmapStart.getTime();
      const week = Math.min(heatmapWeeks - 1, Math.max(0, Math.floor(ms / weekMs)));
      const key = `${week}-${day}`;
      heatmapBucket.set(key, (heatmapBucket.get(key) ?? 0) + 1);
    }
    const attendance_heatmap: { day: number; week: number; count: number }[] = [];
    for (let w = 0; w < heatmapWeeks; w++) {
      for (let day = 0; day < 7; day++) {
        attendance_heatmap.push({
          week: w,
          day,
          count: heatmapBucket.get(`${w}-${day}`) ?? 0,
        });
      }
    }

    return NextResponse.json({
      mrr,
      outstanding_total,
      collection_rate,
      avg_payment_per_student: Math.round(avg_payment_per_student * 100) / 100,
      revenue_by_group: revenueByGroup,
      mrr_trend,
      payment_method_distribution,
      attendance_heatmap,
      aging_report,
      expenses_by_month: Object.fromEntries(expensesByMonth),
      income_by_month: Object.fromEntries(incomeByMonth),
      pnl_months,
      current_period_type,
      academic_year_average_attendance,
      enrollment_surge_active,
      surge_message,
    });
  } catch (error) {
    console.error('[analytics/revenue] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
