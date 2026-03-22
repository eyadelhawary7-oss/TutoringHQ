/**
 * Daily summary API — invoked by daily-summary Edge Function
 * Queries yesterday's data (Cairo time), sends chq_daily_summary template
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  sendDailySummary,
  getYesterdayCairo,
  getYesterdayCairoUtcRange,
  type DailySummaryData,
} from '@/lib/whatsapp/flows/dailySummary';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Egypt week: Sat=0, Sun=1, Mon=2, Tue=3, Wed=4, Thu=5, Fri=6. JS getDay: Sun=0..Sat=6. */
function getEgyptDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const jsDay = new Date(y, m - 1, d).getDay();
  return (jsDay + 1) % 7;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const yesterdayStr = getYesterdayCairo();
  const { start: rangeStart, end: rangeEnd } = getYesterdayCairoUtcRange();
  const egyptDay = getEgyptDayOfWeek(yesterdayStr);

  const { data: centers, error: centersError } = await supabase
    .from('centers')
    .select('id, name, phone')
    .eq('daily_summary_enabled', true)
    .eq('subscription_status', 'active')
    .not('phone', 'is', null);

  if (centersError || !centers?.length) {
    return NextResponse.json({ ok: true, processed: 0, message: 'No centers' });
  }

  let processed = 0;

  for (const center of centers as { id: string; name: string; phone: string }[]) {
    try {
      const centerId = center.id;

      const attendedRes = await supabase
        .from('attendance_scans')
        .select('student_id', { count: 'exact', head: true })
        .eq('center_id', centerId)
        .gte('scanned_at', rangeStart)
        .lte('scanned_at', rangeEnd);

      const attendedCount = attendedRes.count ?? 0;

      const paymentsRes = await supabase
        .from('payments')
        .select('amount, confirmed')
        .eq('center_id', centerId)
        .gte('paid_at', rangeStart)
        .lte('paid_at', rangeEnd);

      const payments = (paymentsRes.data || []) as { amount: number; confirmed: boolean }[];
      const paymentsCollected = payments
        .filter((p) => p.confirmed === true)
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      const pendingPayments = payments
        .filter((p) => p.confirmed === false)
        .reduce((s, p) => s + Number(p.amount || 0), 0);

      const balanceRes = await supabase
        .from('students')
        .select('balance_due')
        .eq('center_id', centerId)
        .eq('is_active', true);

      const students = (balanceRes.data || []) as { balance_due?: number }[];
      const pendingBalanceTotal = students.reduce((s, st) => s + (Number(st.balance_due) || 0), 0);

      let absentCount = 0;
      const dayNames = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
      const dayName = dayNames[egyptDay];
      const slotsRes = await supabase
        .from('schedule_slots')
        .select('id, group_id')
        .eq('center_id', centerId)
        .or(`day_of_week.eq.${egyptDay},day_of_week.eq.${dayName}`);

      const slots = (slotsRes.data || []) as { id: string; group_id: string | null }[];
      const groupIds = [...new Set(slots.map((s) => s.group_id).filter(Boolean))] as string[];

      if (groupIds.length > 0) {
        const membersRes = await supabase
          .from('student_group_members')
          .select('student_id')
          .in('group_id', groupIds);

        const expectedStudentIds = [...new Set((membersRes.data || []).map((m: { student_id: string }) => m.student_id))];

        const attendedRes2 = await supabase
          .from('attendance_scans')
          .select('student_id')
          .eq('center_id', centerId)
          .eq('session_date', yesterdayStr);

        const attendedIds = new Set((attendedRes2.data || []).map((a: { student_id: string }) => a.student_id));
        absentCount = expectedStudentIds.filter((id) => !attendedIds.has(id)).length;
      }

      if (attendedCount === 0 && paymentsCollected === 0) continue;

      const payload: DailySummaryData = {
        centerId,
        centerName: center.name,
        phone: center.phone,
        attendedCount,
        absentCount,
        paymentsCollected,
        pendingPayments,
        pendingBalanceTotal,
      };

      const r = await sendDailySummary(payload);
      if (r.success) processed++;
      else console.error(`[daily-summary] ${centerId}: ${r.error}`);
    } catch (err) {
      console.error(`[daily-summary] Error for ${center.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, processed });
}
