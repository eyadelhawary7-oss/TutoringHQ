import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import {
  sendDailySummary,
  getYesterdayCairo,
  getYesterdayCairoUtcRange,
  type DailySummaryData,
} from '@/lib/whatsapp/flows/dailySummary';

async function getUserCenter(request: NextRequest) {
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
    .select('id, center_id, role')
    .eq('id', user.id)
    .single();

  const centerId = (userRecord as { center_id?: string | null } | null)?.center_id;
  if (!centerId) return null;

  return { centerId, supabaseAdmin, role: String((userRecord as { role?: string })?.role ?? '') };
}

/** Egypt week: Sat=0..Fri=6 from Y-M-D in local calendar. */
function getEgyptDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const jsDay = new Date(y, m - 1, d).getDay();
  return (jsDay + 1) % 7;
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getUserCenter(request);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { centerId, supabaseAdmin, role } = ctx;
    if (role !== 'owner' && role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: center, error: cErr } = await supabaseAdmin
      .from('centers')
      .select('id, name, phone, daily_summary_enabled, subscription_status')
      .eq('id', centerId)
      .single();

    if (cErr || !center) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }

    const row = center as {
      id: string;
      name: string;
      phone: string | null;
      daily_summary_enabled?: boolean | null;
      subscription_status?: string | null;
    };

    if (row.daily_summary_enabled === false) {
      return NextResponse.json({ error: 'daily_summary_disabled' }, { status: 400 });
    }
    if (!row.phone) {
      return NextResponse.json({ error: 'no_center_phone' }, { status: 400 });
    }
    if (row.subscription_status && row.subscription_status !== 'active') {
      return NextResponse.json({ error: 'center_inactive' }, { status: 400 });
    }

    const yesterdayStr = getYesterdayCairo();
    const { start: rangeStart, end: rangeEnd } = getYesterdayCairoUtcRange();
    const egyptDay = getEgyptDayOfWeek(yesterdayStr);
    const dayNames = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] as const;
    const dayName = dayNames[egyptDay];

    const [scansRangeRes, paymentsRes, studentsRes, slotsRes, sessionScansRes] = await Promise.all([
      supabaseAdmin
        .from('attendance_scans')
        .select('center_id')
        .eq('center_id', centerId)
        .gte('scanned_at', rangeStart)
        .lte('scanned_at', rangeEnd),
      supabaseAdmin
        .from('payments')
        .select('center_id, amount, confirmed')
        .eq('center_id', centerId)
        .gte('paid_at', rangeStart)
        .lte('paid_at', rangeEnd),
      supabaseAdmin
        .from('students')
        .select('center_id, balance_due')
        .eq('center_id', centerId)
        .eq('is_active', true),
      supabaseAdmin
        .from('schedule_slots')
        .select('id, group_id, center_id')
        .eq('center_id', centerId)
        .or(`day_of_week.eq.${egyptDay},day_of_week.eq.${dayName}`),
      supabaseAdmin
        .from('attendance_scans')
        .select('center_id, student_id')
        .eq('center_id', centerId)
        .eq('session_date', yesterdayStr),
    ]);

    const attendedCount = (scansRangeRes.data ?? []).length;

    const payments = (paymentsRes.data ?? []) as { amount: number; confirmed: boolean }[];
    const paymentsCollected = payments
      .filter((p) => p.confirmed === true)
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const pendingPayments = payments
      .filter((p) => p.confirmed === false)
      .reduce((s, p) => s + Number(p.amount || 0), 0);

    const studentsRows = (studentsRes.data ?? []) as { balance_due?: number | null }[];
    const pendingBalanceTotal = studentsRows.reduce((s, st) => s + (Number(st.balance_due) || 0), 0);

    const slots = (slotsRes.data ?? []) as { id: string; group_id: string | null; center_id: string }[];
    const groupIds = [...new Set(slots.map((s) => s.group_id).filter(Boolean))] as string[];

    let absentCount = 0;
    const membersByGroup = new Map<string, string[]>();
    if (groupIds.length > 0) {
      const { data: membersData } = await supabaseAdmin
        .from('student_group_members')
        .select('student_id, group_id')
        .in('group_id', groupIds);
      for (const m of membersData ?? []) {
        const rowM = m as { student_id: string; group_id: string };
        const list = membersByGroup.get(rowM.group_id) ?? [];
        list.push(rowM.student_id);
        membersByGroup.set(rowM.group_id, list);
      }
    }

    const attendedIds = new Set(
      (sessionScansRes.data ?? []).map((r) => (r as { student_id: string }).student_id),
    );
    if (groupIds.length > 0) {
      const expectedStudentIds = [...new Set(groupIds.flatMap((gid) => membersByGroup.get(gid) ?? []))];
      absentCount = expectedStudentIds.filter((id) => !attendedIds.has(id)).length;
    }

    if (attendedCount === 0 && paymentsCollected === 0) {
      return NextResponse.json({ error: 'no_activity_yesterday' }, { status: 400 });
    }

    const payload: DailySummaryData = {
      centerId: row.id,
      centerName: row.name,
      phone: row.phone,
      attendedCount,
      absentCount,
      paymentsCollected,
      pendingPayments,
      pendingBalanceTotal,
    };

    const r = await sendDailySummary(payload);
    if (!r.success && r.error) {
      return NextResponse.json({ error: r.error }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[send-daily-summary]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
