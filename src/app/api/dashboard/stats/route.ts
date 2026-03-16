import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

async function getUserContext(request: NextRequest) {
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

  const { data: { user }, error } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id')
    .eq('id', user.id)
    .single();

  if (!userRecord?.center_id) return null;

  return { centerId: userRecord.center_id, supabaseAdmin };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { centerId, supabaseAdmin } = ctx;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const now = new Date();
    const dayOfWeek = now.getDay();
    const diffToMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - diffToMon);
    weekStart.setHours(0, 0, 0, 0);

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const twentyOneDaysAgo = new Date(now);
    twentyOneDaysAgo.setDate(twentyOneDaysAgo.getDate() - 21);

    const [paymentsRes, scansRes, studentsRes, recentPaymentsRes, recentScansRes, academicRes, studentsCreatedRes] = await Promise.all([
      supabaseAdmin
        .from('payments')
        .select('amount, paid_at')
        .eq('center_id', centerId)
        .eq('status', 'confirmed')
        .gte('paid_at', sixMonthsAgo.toISOString()),
      supabaseAdmin
        .from('attendance_scans')
        .select('student_id, scanned_at')
        .eq('center_id', centerId)
        .gte('scanned_at', weekStart.toISOString()),
      supabaseAdmin
        .from('students')
        .select('balance_due')
        .eq('center_id', centerId),
      supabaseAdmin
        .from('payments')
        .select('id, amount, method, paid_at, students(name)')
        .eq('center_id', centerId)
        .order('paid_at', { ascending: false })
        .limit(10),
      supabaseAdmin
        .from('attendance_scans')
        .select('id, scanned_at, payment_status_at_scan, students(name)')
        .eq('center_id', centerId)
        .order('scanned_at', { ascending: false })
        .limit(5),
      supabaseAdmin
        .from('academic_years')
        .select('id, start_date, end_date')
        .eq('center_id', centerId)
        .eq('is_current', true)
        .maybeSingle(),
      supabaseAdmin
        .from('students')
        .select('id, created_at')
        .eq('center_id', centerId)
        .gte('created_at', twentyOneDaysAgo.toISOString()),
    ]);

    const academicYear = (academicRes as { data?: { id: string; start_date: string; end_date: string } | null })?.data ?? null;
    let periods: { period_type: string; start_date: string; end_date: string }[] = [];
    if (academicYear?.id) {
      const pr = await supabaseAdmin
        .from('academic_periods')
        .select('period_type, start_date, end_date')
        .eq('academic_year_id', academicYear.id);
      periods = (pr.data ?? []) as { period_type: string; start_date: string; end_date: string }[];
    }

    const studentsCreated = (studentsCreatedRes.data || []) as { id: string; created_at: string }[];

    // Current period type from academic_periods
    const todayStr = now.toISOString().slice(0, 10);
    let current_period_type: string = 'normal';
    for (const p of periods) {
      if (todayStr >= p.start_date && todayStr <= p.end_date) {
        current_period_type = p.period_type;
        break;
      }
    }

    // Academic year average attendance (since year start)
    let academic_year_average_attendance: number | null = null;
    if (academicYear?.start_date) {
      const yearStart = new Date(academicYear.start_date + 'T12:00:00');
      const { data: yearScans } = await supabaseAdmin
        .from('attendance_scans')
        .select('student_id, scanned_at')
        .eq('center_id', centerId)
        .gte('scanned_at', yearStart.toISOString());
      const totalStudents = (studentsRes.data || []).length;
      const weeksSinceStart = Math.max(1, (now.getTime() - yearStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
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
      academic_year_average_attendance = totalStudents > 0
        ? Math.round((avgWeeklyUnique / totalStudents) * 10000) / 100
        : 0;
    }

    // Enrollment surge: within 21 days of exam period AND enrollment growth > 5% vs 3-week average
    let enrollment_surge_active = false;
    let surge_message: string | null = null;
    const examPeriods = periods.filter((p) => p.period_type === 'exam');
    for (const ep of examPeriods) {
      const examStart = new Date(ep.start_date + 'T12:00:00');
      const daysToExam = Math.ceil((examStart.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      if (daysToExam > 0 && daysToExam <= 21) {
        const newLast7 = studentsCreated.filter((s) => {
          const d = new Date(s.created_at);
          return d >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        }).length;
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

    const payments = (paymentsRes.data || []) as { amount: number; paid_at: string }[];
    const scans = (scansRes.data || []) as { student_id: string; scanned_at: string }[];
    const students = (studentsRes.data || []) as { balance_due?: number }[];
    const recentPayments = (recentPaymentsRes.data || []) as { id: string; amount: number; method: string; paid_at: string; students?: { name?: string } | null }[];
    const recentScans = (recentScansRes.data || []) as { id: string; scanned_at: string; payment_status_at_scan?: string; students?: { name?: string } | null }[];

    const revenueToday = payments
      .filter((p) => {
        const d = new Date(p.paid_at);
        return d >= todayStart && d <= todayEnd;
      })
      .reduce((s, p) => s + (p.amount ?? 0), 0);

    const activeStudentsThisWeek = new Set(scans.map((s) => s.student_id)).size;

    const attendanceToday = scans.filter((s) => {
      const d = new Date(s.scanned_at);
      return d >= todayStart && d <= todayEnd;
    }).length;

    const pendingBalance = students.reduce((s, st) => s + (Number(st.balance_due) || 0), 0);

    const byMonth: Record<string, number> = {};
    for (let i = 5; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
      byMonth[key] = 0;
    }
    payments.forEach((p) => {
      if (!p.paid_at) return;
      const d = new Date(p.paid_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (key in byMonth) byMonth[key] += p.amount ?? 0;
    });
    const monthlyRevenue = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({ month, amount }));

    const formatTimeAgo = (dateStr: string, locale: string) => {
      const d = new Date(dateStr);
      const diffMs = Date.now() - d.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);
      if (locale === 'ar') {
        if (diffMins < 1) return 'الآن';
        if (diffMins < 60) return `منذ ${diffMins} د`;
        if (diffHours < 24) return `منذ ${diffHours} س`;
        if (diffDays < 7) return `منذ ${diffDays} يوم`;
        return d.toLocaleDateString('ar-EG', { dateStyle: 'short' });
      }
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return d.toLocaleDateString('en-GB', { dateStyle: 'short' });
    };

    const locale = request.headers.get('accept-language')?.includes('ar') ? 'ar' : 'en';
    const recentActivity: { type: 'payment' | 'scan'; student: string; detail: string; time: string; ts: string }[] = [];

    recentPayments.forEach((p) => {
      recentActivity.push({
        type: 'payment',
        student: p.students?.name ?? '—',
        detail: `${p.amount} EGP (${p.method})`,
        time: formatTimeAgo(p.paid_at, locale),
        ts: p.paid_at,
      });
    });
    recentScans.forEach((s) => {
      recentActivity.push({
        type: 'scan',
        student: s.students?.name ?? '—',
        detail: s.payment_status_at_scan === 'paid' ? (locale === 'ar' ? 'حضر + دفع' : 'Attended + Paid') : (locale === 'ar' ? 'حضر' : 'Attended'),
        time: formatTimeAgo(s.scanned_at, locale),
        ts: s.scanned_at,
      });
    });
    recentActivity.sort((a, b) => (b.ts > a.ts ? 1 : -1));
    const merged = recentActivity.slice(0, 15).map(({ type, student, detail, time }) => ({ type, student, detail, time }));

    return NextResponse.json({
      revenueToday,
      activeStudentsThisWeek,
      attendanceToday,
      pendingBalance,
      monthlyRevenue,
      recentActivity: merged,
      current_period_type: current_period_type,
      academic_year_average_attendance: academic_year_average_attendance,
      enrollment_surge_active: enrollment_surge_active,
      surge_message: surge_message,
    });
  } catch (error) {
    console.error('[dashboard/stats] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
