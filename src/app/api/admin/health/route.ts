import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminApi } from '@/lib/admin-auth';
import { requireSuperAdminRow } from '@/lib/admin-access';
import { parseIncludeTestCenters } from '@/lib/adminIncludeTest';
import { getPaymobHealthMode } from '@/lib/paymobGuardLogic';
import { cronPathToLogName } from '@/lib/cron/cronLog';
import { VERCEL_CRON_DEFINITIONS } from '@/lib/vercelCronDefinitions';
import { listUnresolvedDeadLetters } from '@/lib/deadLetterQueue';

export const dynamic = 'force-dynamic';

function waMode(): 'live' | 'test' {
  return process.env.WHATSAPP_PHONE_NUMBER_ID === '1013787185158313' ? 'test' : 'live';
}

export type CronRecentFailure = {
  ran_at: string;
  error_message: string | null;
  error_stack: string | null;
};

export type AdminHealthCronRow = {
  path: string;
  schedule: string;
  name: string;
  last_ran: string | null;
  last_status: 'success' | 'failure' | 'partial' | null;
  last_duration_ms: number | null;
  /** Only when last run ended in `failure` */
  last_error: string | null;
  last_error_stack: string | null;
  recent_failures: CronRecentFailure[];
};

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  const row403 = await requireSuperAdminRow(auth.supabaseAdmin, auth.userId);
  if (row403) return row403;

  const includeTest = parseIncludeTestCenters(request);

  const supabase = auth.supabaseAdmin;
  const now = new Date();
  const cutoffIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  const excludeTest = !includeTest;

  try {
    let activeQ = supabase.from('centers').select('id', { count: 'exact', head: true }).eq('status', 'active');
    let pendingSignupQ = supabase.from('centers').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    let pendingCancelQ = supabase.from('centers').select('id', { count: 'exact', head: true }).eq('status', 'pending_cancellation');
    let zeroBillQ = supabase
      .from('centers')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .or('billing_amount.eq.0,billing_amount.is.null');
    if (excludeTest) {
      activeQ = activeQ.eq('is_test', false);
      pendingSignupQ = pendingSignupQ.eq('is_test', false);
      pendingCancelQ = pendingCancelQ.eq('is_test', false);
      zeroBillQ = zeroBillQ.eq('is_test', false);
    }

    const [
      activeRes,
      pendingSignupRes,
      stuckRes,
      pendingCancelRes,
      pendingWdRes,
      zeroBillRes,
      cronRowsRes,
      cronFailuresRes,
    ] = await Promise.all([
      activeQ,
      pendingSignupQ,
      supabase
        .from('combined_payment_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .lt('created_at', cutoffIso)
        .gt('expires_at', nowIso)
        .is('finalized_at', null),
      pendingCancelQ,
      supabase
        .from('withdrawal_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      zeroBillQ,
      supabase
        .from('cron_log')
        .select('cron_name, ran_at, status, duration_ms, error_message, error_stack')
        .order('ran_at', { ascending: false })
        .limit(12000),
      supabase
        .from('cron_log')
        .select('cron_name, ran_at, status, error_message, error_stack')
        .eq('status', 'failure')
        .order('ran_at', { ascending: false })
        .limit(8000),
    ]);

    const err =
      activeRes.error ||
      pendingSignupRes.error ||
      stuckRes.error ||
      pendingCancelRes.error ||
      pendingWdRes.error ||
      zeroBillRes.error ||
      cronRowsRes.error ||
      cronFailuresRes.error;
    if (err) {
      console.error('[admin/health]', err);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }

    type CronHit = {
      ran_at: string;
      status: string;
      duration_ms: number | null;
      error_message: string | null;
      error_stack: string | null;
    };

    const latestByName = new Map<string, CronHit>();
    for (const row of cronRowsRes.data ?? []) {
      const name = String((row as { cron_name?: string }).cron_name ?? '');
      if (!name || latestByName.has(name)) continue;
      const r = row as CronHit;
      latestByName.set(name, {
        ran_at: r.ran_at,
        status: r.status,
        duration_ms: r.duration_ms,
        error_message: r.error_message,
        error_stack: r.error_stack ?? null,
      });
    }

    const failuresByName = new Map<string, CronRecentFailure[]>();
    for (const row of cronFailuresRes.data ?? []) {
      const name = String((row as { cron_name?: string }).cron_name ?? '');
      if (!name) continue;
      const cur = failuresByName.get(name) ?? [];
      if (cur.length >= 5) continue;
      const r = row as CronRecentFailure;
      cur.push({
        ran_at: r.ran_at,
        error_message: r.error_message,
        error_stack: r.error_stack ?? null,
      });
      failuresByName.set(name, cur);
    }

    const cron_status: AdminHealthCronRow[] = VERCEL_CRON_DEFINITIONS.map(({ path, schedule }) => {
      const name = cronPathToLogName(path);
      const hit = latestByName.get(name);
      const recent_failures = failuresByName.get(name) ?? [];
      if (!hit) {
        return {
          path,
          schedule,
          name,
          last_ran: null,
          last_status: null,
          last_duration_ms: null,
          last_error: null,
          last_error_stack: null,
          recent_failures,
        };
      }
      const st = hit.status;
      const last_status =
        st === 'success' || st === 'failure' || st === 'partial' ? st : null;
      const failed = last_status === 'failure';
      return {
        path,
        schedule,
        name,
        last_ran: hit.ran_at,
        last_status,
        last_duration_ms: hit.duration_ms,
        last_error: failed ? hit.error_message : null,
        last_error_stack: failed ? hit.error_stack : null,
        recent_failures,
      };
    });

    const stuck_sessions = stuckRes.count ?? 0;
    const zero_billing_centers = zeroBillRes.count ?? 0;

    // Dead-lettered outbox jobs (notifications that exhausted their retries).
    // Surfaced so a dropped message is visible and recoverable, not silently lost.
    const { entries: deadLetters } = await listUnresolvedDeadLetters(supabase, 100);

    return NextResponse.json({
      paymob_mode: getPaymobHealthMode(),
      wa_mode: waMode(),
      active_centers: activeRes.count ?? 0,
      pending_signups: pendingSignupRes.count ?? 0,
      stuck_sessions,
      pending_cancellations: pendingCancelRes.count ?? 0,
      pending_withdrawals: pendingWdRes.count ?? 0,
      zero_billing_centers,
      dead_letters: deadLetters,
      dead_letter_count: deadLetters.length,
      cron_status,
    });
  } catch (e) {
    console.error('[admin/health]', e);
    return NextResponse.json({ error: 'Failed to load health data' }, { status: 500 });
  }
}
