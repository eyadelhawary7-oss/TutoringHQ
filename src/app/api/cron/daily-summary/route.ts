/**
 * Daily summary API — invoked by daily-summary Edge Function
 * Queries yesterday's data (Cairo time), sends chq_daily_summary template
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  sendDailySummary,
  getYesterdayCairo,
  getYesterdayCairoUtcRange,
  type DailySummaryData,
} from '@/lib/whatsapp/flows/dailySummary';
import { tCronBackup } from '@/lib/cronBackupI18n';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Egypt week: Sat=0, Sun=1, Mon=2, Tue=3, Wed=4, Thu=5, Fri=6. JS getDay: Sun=0..Sat=6. */
function getEgyptDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const jsDay = new Date(y, m - 1, d).getDay();
  return (jsDay + 1) % 7;
}

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'daily-summary';

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: tCronBackup('errorUnauthorized') }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ success: false }, { status: 200 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: pausedRow } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'cron_paused')
    .maybeSingle();
  if (pausedRow?.value === true) {
    return NextResponse.json({ skipped: 'cron_paused' }, { status: 200 });
  }

  try {
    const yesterdayStr = getYesterdayCairo();
    const { start: rangeStart, end: rangeEnd } = getYesterdayCairoUtcRange();
    const egyptDay = getEgyptDayOfWeek(yesterdayStr);

    const { data: centers, error: centersError } = await supabase
      .from('centers')
      .select('id, name, phone')
      .eq('daily_summary_enabled', true)
      .eq('subscription_status', 'active')
      .not('phone', 'is', null);

    if (centersError) {
      throw new Error(centersError.message);
    }

    if (!centers?.length) {
      await supabase.from('cron_log').insert({
        cron_name: CRON_NAME,
        status: 'success',
        duration_ms: Date.now() - cronStart,
        records_processed: 0,
        metadata: { message: 'No centers' },
      });
      try {
        if (supabaseAdmin) {
          await supabaseAdmin.from('cron_health_log').upsert(
            {
              cron_name: 'daily-summary',
              last_success_at: new Date().toISOString(),
              failure_count: 0,
            },
            { onConflict: 'cron_name' },
          );
        }
      } catch (healthLogErr) {
        console.error('[daily-summary] cron_health_log:', healthLogErr);
      }
      return NextResponse.json({ success: true, processed: 0, message: 'No centers' });
    }

    const centerList = centers as { id: string; name: string; phone: string }[];
    const centerIds = centerList.map((c) => c.id);

    const dayNames = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
    const dayName = dayNames[egyptDay];

    const [scansRangeRes, paymentsRes, studentsRes, slotsRes, sessionScansRes] = await Promise.all([
      supabase
        .from('attendance_scans')
        .select('center_id')
        .in('center_id', centerIds)
        .gte('scanned_at', rangeStart)
        .lte('scanned_at', rangeEnd),
      supabase
        .from('payments')
        .select('center_id, amount, confirmed')
        .in('center_id', centerIds)
        .gte('paid_at', rangeStart)
        .lte('paid_at', rangeEnd),
      supabase
        .from('students')
        .select('center_id, balance_due')
        .in('center_id', centerIds)
        .eq('is_active', true),
      supabase
        .from('schedule_slots')
        .select('id, group_id, center_id')
        .in('center_id', centerIds)
        .or(`day_of_week.eq.${egyptDay},day_of_week.eq.${dayName}`),
      supabase
        .from('attendance_scans')
        .select('center_id, student_id')
        .in('center_id', centerIds)
        .eq('session_date', yesterdayStr),
    ]);

    const attendedInRangeByCenter = new Map<string, number>();
    for (const row of scansRangeRes.data ?? []) {
      const cid = (row as { center_id: string }).center_id;
      attendedInRangeByCenter.set(cid, (attendedInRangeByCenter.get(cid) ?? 0) + 1);
    }

    const paymentsByCenter = new Map<string, { amount: number; confirmed: boolean }[]>();
    for (const row of paymentsRes.data ?? []) {
      const p = row as { center_id: string; amount: number; confirmed: boolean };
      const list = paymentsByCenter.get(p.center_id) ?? [];
      list.push({ amount: p.amount, confirmed: p.confirmed });
      paymentsByCenter.set(p.center_id, list);
    }

    const balanceByCenter = new Map<string, number>();
    for (const row of studentsRes.data ?? []) {
      const s = row as { center_id: string; balance_due?: number | null };
      balanceByCenter.set(s.center_id, (balanceByCenter.get(s.center_id) ?? 0) + (Number(s.balance_due) || 0));
    }

    const slotsByCenter = new Map<string, { id: string; group_id: string | null }[]>();
    for (const row of slotsRes.data ?? []) {
      const sl = row as { id: string; group_id: string | null; center_id: string };
      const list = slotsByCenter.get(sl.center_id) ?? [];
      list.push({ id: sl.id, group_id: sl.group_id });
      slotsByCenter.set(sl.center_id, list);
    }

    const sessionAttendedByCenter = new Map<string, Set<string>>();
    for (const row of sessionScansRes.data ?? []) {
      const a = row as { center_id: string; student_id: string };
      if (!sessionAttendedByCenter.has(a.center_id)) {
        sessionAttendedByCenter.set(a.center_id, new Set());
      }
      sessionAttendedByCenter.get(a.center_id)!.add(a.student_id);
    }

    const allGroupIds = [
      ...new Set(
        [...slotsByCenter.values()]
          .flat()
          .map((s) => s.group_id)
          .filter(Boolean),
      ),
    ] as string[];

    const membersByGroup = new Map<string, string[]>();
    if (allGroupIds.length > 0) {
      const { data: membersData } = await supabase
        .from('student_group_members')
        .select('student_id, group_id')
        .in('group_id', allGroupIds);
      for (const m of membersData ?? []) {
        const row = m as { student_id: string; group_id: string };
        const list = membersByGroup.get(row.group_id) ?? [];
        list.push(row.student_id);
        membersByGroup.set(row.group_id, list);
      }
    }

    const summaryResults = await Promise.all(
      centerList.map(async (center) => {
        try {
          const centerId = center.id;
          const attendedCount = attendedInRangeByCenter.get(centerId) ?? 0;

          const payments = paymentsByCenter.get(centerId) ?? [];
          const paymentsCollected = payments
            .filter((p) => p.confirmed === true)
            .reduce((s, p) => s + Number(p.amount || 0), 0);
          const pendingPayments = payments
            .filter((p) => p.confirmed === false)
            .reduce((s, p) => s + Number(p.amount || 0), 0);

          const pendingBalanceTotal = balanceByCenter.get(centerId) ?? 0;

          let absentCount = 0;
          const slots = slotsByCenter.get(centerId) ?? [];
          const groupIds = [...new Set(slots.map((s) => s.group_id).filter(Boolean))] as string[];

          if (groupIds.length > 0) {
            const expectedStudentIds = [
              ...new Set(groupIds.flatMap((gid) => membersByGroup.get(gid) ?? [])),
            ];
            const attendedIds = sessionAttendedByCenter.get(centerId) ?? new Set();
            absentCount = expectedStudentIds.filter((id) => !attendedIds.has(id)).length;
          }

          if (attendedCount === 0 && paymentsCollected === 0) return 0;

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

          let r: { success: boolean; error?: string } = { success: false };
          try {
            r = await sendDailySummary(payload);
          } catch (waErr) {
            console.error('[daily-summary] WA send error:', waErr);
          }
          if (r.error) console.error(`[daily-summary] ${centerId}: ${r.error}`);
          return r.success ? 1 : 0;
        } catch (err) {
          console.error(`[daily-summary] Error for ${center.id}:`, err);
          return 0;
        }
      }),
    );

    const processed = summaryResults.reduce<number>((a, b) => a + b, 0);

    await supabase.from('cron_log').insert({
      cron_name: CRON_NAME,
      status: 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: processed,
      metadata: { centersConsidered: centers.length },
    });

    try {
      if (supabaseAdmin) {
        await supabaseAdmin.from('cron_health_log').upsert(
          {
            cron_name: 'daily-summary',
            last_success_at: new Date().toISOString(),
            failure_count: 0,
          },
          { onConflict: 'cron_name' },
        );
      }
    } catch (healthLogErr) {
      console.error('[daily-summary] cron_health_log:', healthLogErr);
    }

    return NextResponse.json({ success: true, processed });
  } catch (error) {
    console.error(`[${CRON_NAME}] Error:`, error);
    try {
      await supabase.from('cron_log').insert({
        cron_name: CRON_NAME,
        status: 'failure',
        duration_ms: Date.now() - cronStart,
        error_message: error instanceof Error ? error.message.slice(0, 2000) : 'Unknown',
      });
    } catch (logErr) {
      console.error(`[${CRON_NAME}] cron_log:`, logErr);
    }
    return NextResponse.json({ success: false }, { status: 200 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
