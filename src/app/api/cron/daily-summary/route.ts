/**
 * Daily summary API - invoked by daily-summary Edge Function
 * Queries yesterday's data (Cairo time), sends chq_daily_summary template
 * CEO: daily freeform briefing to ADMIN_WHATSAPP_NUMBER (Automation 9)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { insertCronLogSuccess, insertCronLogFailure } from '@/lib/cron/cronLog';
import { normalizeWhatsAppNumber, sendWhatsAppMessage } from '@/lib/whatsapp';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  sendDailySummary,
  getYesterdayCairo,
  getYesterdayCairoUtcRange,
  type DailySummaryData,
} from '@/lib/whatsapp/flows/dailySummary';
import { tCronBackup } from '@/lib/cronBackupI18n';
import { formatDate, formatDateTime, formatNumber } from '@/lib/formatNumber';
import { assertIsoDateForOrFilter, orClauseDayOfWeekEgypt } from '@/lib/postgrestSafe';

const CEO_LOCALE = 'en';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Egypt week: Sat=0, Sun=1, Mon=2, Tue=3, Wed=4, Thu=5, Fri=6. JS getDay: Sun=0..Sat=6. */
function getEgyptDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const jsDay = new Date(y, m - 1, d).getDay();
  return (jsDay + 1) % 7;
}

function utcTodayBounds(): { start: string; end: string; dateStr: string } {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const start = new Date(Date.UTC(y, m, day, 0, 0, 0, 0)).toISOString();
  const end = new Date(Date.UTC(y, m, day + 1, 0, 0, 0, 0)).toISOString();
  const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { start, end, dateStr };
}

type CronFailRow = { cron_name: string; last_failure_at: string | null };

/** Sum MRR: centers.status = active; prefer centers.all_in_price, else pricing_plans.all_in_price when embed works. */
async function ceoQueryMrr(admin: SupabaseClient): Promise<number> {
  try {
    const { data, error } = await admin
      .from('centers')
      .select('all_in_price, pricing_plans(all_in_price)')
      .eq('status', 'active');
    if (error) throw error;
    let sum = 0;
    for (const raw of data ?? []) {
      const row = raw as {
        all_in_price?: number | null;
        pricing_plans?: { all_in_price?: number | null } | { all_in_price?: number | null }[] | null;
      };
      let v = Number(row.all_in_price ?? 0);
      if (!v && row.pricing_plans != null) {
        const pp = row.pricing_plans;
        const planRow = Array.isArray(pp) ? pp[0] : pp;
        v = Number(planRow?.all_in_price ?? 0);
      }
      sum += v;
    }
    return sum;
  } catch (e) {
    try {
      const { data, error } = await admin.from('centers').select('all_in_price').eq('status', 'active');
      if (error) throw error;
      return (data ?? []).reduce(
        (s, r) => s + Number((r as { all_in_price?: number | null }).all_in_price ?? 0),
        0,
      );
    } catch (e2) {
      console.error('[daily-summary] CEO MRR:', e2);
      return 0;
    }
  }
}

async function ceoQueryCount(
  label: string,
  run: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<number> {
  try {
    const { count, error } = await run();
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    console.error(`[daily-summary] CEO ${label}:`, e);
    return 0;
  }
}

async function ceoQuerySumPaymentsToday(admin: SupabaseClient, start: string, end: string): Promise<number> {
  try {
    const { data, error } = await admin
      .from('payments')
      .select('amount')
      .gte('paid_at', start)
      .lt('paid_at', end)
      .not('paid_at', 'is', null)
      .in('status', ['paid', 'confirmed']);
    if (error) throw error;
    return (data ?? []).reduce((s, r) => s + Number((r as { amount?: unknown }).amount ?? 0), 0);
  } catch (e) {
    console.error('[daily-summary] CEO collected today:', e);
    return 0;
  }
}

async function ceoQueryFailedCrons(admin: SupabaseClient): Promise<CronFailRow[]> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await admin
      .from('cron_health_log')
      .select('cron_name, last_failure_at')
      .gt('last_failure_at', since);
    if (error) throw error;
    return (data ?? []) as CronFailRow[];
  } catch (e) {
    console.error('[daily-summary] CEO failed crons:', e);
    return [];
  }
}

async function ceoQueryLastBackup(admin: SupabaseClient): Promise<string> {
  try {
    const { data, error } = await admin
      .from('cron_health_log')
      .select('last_success_at')
      .eq('cron_name', 'weekly-backup')
      .maybeSingle();
    if (error) throw error;
    const at = (data as { last_success_at?: string | null } | null)?.last_success_at;
    if (!at) return 'None';
    return formatDateTime(new Date(at), CEO_LOCALE, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (e) {
    console.error('[daily-summary] CEO last backup:', e);
    return 'None';
  }
}

async function runCeoDailyBriefing(admin: SupabaseClient): Promise<void> {
  try {
    const { start, end, dateStr } = utcTodayBounds();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      mrr,
      activeCount,
      pendingPaymentCount,
      redCount,
      amberCount,
      newToday,
      churnedWeek,
      collectedToday,
      failedCount,
      overdueCount,
      failedCrons,
      lastBackup,
      inboundCount,
      deflectedCount,
      smCount,
    ] = await Promise.all([
      ceoQueryMrr(admin),
      ceoQueryCount('active centers', () =>
        admin.from('centers').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      ),
      ceoQueryCount('pending payment', () =>
        admin.from('centers').select('*', { count: 'exact', head: true }).eq('status', 'pending_payment'),
      ),
      ceoQueryCount('red health', () =>
        admin
          .from('centers')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'active')
          .eq('health_status', 'red'),
      ),
      ceoQueryCount('amber health', () =>
        admin
          .from('centers')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'active')
          .eq('health_status', 'amber'),
      ),
      ceoQueryCount('new today', () =>
        admin
          .from('centers')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'active')
          .gte('approved_at', start)
          .lt('approved_at', end),
      ),
      ceoQueryCount('churned week', () =>
        admin
          .from('centers')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'suspended')
          .gte('updated_at', sevenDaysAgo),
      ),
      ceoQuerySumPaymentsToday(admin, start, end),
      ceoQueryCount('failed invoices', () =>
        admin
          .from('invoices')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'failed')
          .gte('updated_at', start)
          .lt('updated_at', end),
      ),
      ceoQueryCount('overdue invoices', () =>
        admin.from('invoices').select('*', { count: 'exact', head: true }).eq('status', 'pending').lt('due_date', dateStr),
      ),
      ceoQueryFailedCrons(admin),
      ceoQueryLastBackup(admin),
      ceoQueryCount('inbound WA', () =>
        admin
          .from('whatsapp_inbound_log')
          .select('*', { count: 'exact', head: true })
          .gte('received_at', start)
          .lt('received_at', end),
      ),
      ceoQueryCount('FAQ deflected', () =>
        admin
          .from('whatsapp_inbound_log')
          .select('*', { count: 'exact', head: true })
          .eq('matched_faq', true)
          .gte('received_at', start)
          .lt('received_at', end),
      ),
      ceoQueryCount('passed SM', () =>
        admin
          .from('whatsapp_inbound_log')
          .select('*', { count: 'exact', head: true })
          .eq('matched_faq', false)
          .gte('received_at', start)
          .lt('received_at', end),
      ),
    ]);

    const today = formatDate(new Date(), CEO_LOCALE, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const message =
      `CenterHQ Daily Briefing - ${today}\n\n` +
      `REVENUE\n` +
      `MRR: ${formatNumber(mrr, CEO_LOCALE)} EGP\n` +
      `Active centers: ${formatNumber(activeCount, CEO_LOCALE)}\n` +
      `Pending payment: ${formatNumber(pendingPaymentCount, CEO_LOCALE)}\n\n` +
      `HEALTH\n` +
      `Critical (red): ${formatNumber(redCount, CEO_LOCALE)}\n` +
      `At-risk (amber): ${formatNumber(amberCount, CEO_LOCALE)}\n` +
      `New today: ${formatNumber(newToday, CEO_LOCALE)}\n` +
      `Churned this week: ${formatNumber(churnedWeek, CEO_LOCALE)}\n\n` +
      `PAYMENTS\n` +
      `Collected today: ${formatNumber(collectedToday, CEO_LOCALE)} EGP\n` +
      `Failed payments: ${formatNumber(failedCount, CEO_LOCALE)}\n` +
      `Overdue invoices: ${formatNumber(overdueCount, CEO_LOCALE)}\n\n` +
      `CRONS\n` +
      `Failed (24h): ${
        failedCrons.length === 0 ? 'None' : failedCrons.map((c) => c.cron_name).join(', ')
      }\n` +
      `Last backup: ${lastBackup}\n\n` +
      `SUPPORT\n` +
      `Inbound WA: ${formatNumber(inboundCount, CEO_LOCALE)}\n` +
      `FAQ deflected: ${formatNumber(deflectedCount, CEO_LOCALE)}\n` +
      `Passed to SM: ${formatNumber(smCount, CEO_LOCALE)}`;

    const raw = process.env.ADMIN_WHATSAPP_NUMBER?.trim();
    if (!raw) {
      console.warn('[daily-summary] CEO briefing skipped: ADMIN_WHATSAPP_NUMBER not set');
      return;
    }
    const ok = await sendWhatsAppMessage(normalizeWhatsAppNumber(raw), message);
    if (!ok) {
      console.error('[daily-summary] CEO briefing WhatsApp send failed');
    }
  } catch (e) {
    console.error('[daily-summary] CEO briefing:', e);
  }
}

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'daily-summary';

  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

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
    await runCeoDailyBriefing(supabase);

    const yesterdayStr = assertIsoDateForOrFilter(getYesterdayCairo(), 'yesterdayStr');
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
      await insertCronLogSuccess(supabase, CRON_NAME, {
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
        .or(orClauseDayOfWeekEgypt(egyptDay)),
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

    await insertCronLogSuccess(supabase, CRON_NAME, {
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
    await insertCronLogFailure(supabase, CRON_NAME, error, {
      duration_ms: Date.now() - cronStart,
    });
    return NextResponse.json({ success: false }, { status: 200 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
