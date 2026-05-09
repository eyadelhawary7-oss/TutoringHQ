import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminApi } from '@/lib/admin-auth';
import { requireSuperAdminRow } from '@/lib/admin-access';
import { parseIncludeTestCenters } from '@/lib/adminIncludeTest';
import { getPaymobHealthMode } from '@/lib/paymobGuardLogic';

export const dynamic = 'force-dynamic';

// Aggregates: cron_log (latest per cron_name), stuck_sessions (stale combined_payment_sessions),
// zero_billing_centers (active centers with null/zero billing_amount).

/**
 * All Vercel cron routes (path + schedule) — single source for health UI row count.
 * Order matches vercel.json `crons`.
 */
export const VERCEL_CRON_DEFINITIONS = [
  { path: '/api/cron/check-stuck-payments', schedule: '*/30 * * * *' },
  { path: '/api/cron/cleanup-expired-sessions', schedule: '0 1 * * *' },
  { path: '/api/cron/expire-credits', schedule: '0 1 * * *' },
  { path: '/api/cron/parent-pack-billing', schedule: '1 0 1 * *' },
  { path: '/api/cron/parent-absence-alerts', schedule: '0 19 * * *' },
  { path: '/api/cron/parent-balance-alerts', schedule: '0 8 * * *' },
  { path: '/api/cron/pack-request-check', schedule: '0 7 * * *' },
  { path: '/api/cron/ceo-briefing', schedule: '15 7 * * *' },
  { path: '/api/cron/payg-billing', schedule: '0 21 28-31 * *' },
  { path: '/api/cron/commission-t2-check', schedule: '0 9 * * *' },
  { path: '/api/cron/loyalty-bonus-check', schedule: '0 9 * * *' },
  { path: '/api/cron/process-renewals', schedule: '0 7 * * *' },
  { path: '/api/cron/detect-churn', schedule: '0 2 * * *' },
  { path: '/api/cron/daily-summary', schedule: '55 5 * * *' },
  { path: '/api/cron/compute-benchmarks', schedule: '0 1 * * *' },
  { path: '/api/cron/recompute-health-scores', schedule: '0 2 * * *' },
  { path: '/api/cron/status-ping', schedule: '*/5 * * * *' },
  { path: '/api/cron/mrr-snapshot', schedule: '0 0 * * *' },
  { path: '/api/cron/check-token-health', schedule: '0 8 * * 1' },
  { path: '/api/cron/renewal-reminders', schedule: '0 7 * * *' },
  { path: '/api/cron/weekly-backup', schedule: '0 3 * * 0' },
  { path: '/api/cron/monthly-backup', schedule: '0 2 1 * *' },
  { path: '/api/cron/cleanup-status-checks', schedule: '0 1 * * 1' },
  { path: '/api/cron/referral-automation', schedule: '0 3 2 * *' },
  { path: '/api/cron/dormancy-warnings', schedule: '0 4 2 * *' },
] as const;

function pathToCronLogName(path: string): string {
  return path.replace(/^\/api\/cron\//, '').replace(/\/$/, '');
}

function waMode(): 'live' | 'test' {
  return process.env.WHATSAPP_PHONE_NUMBER_ID === '1013787185158313' ? 'test' : 'live';
}

export type AdminHealthCronRow = {
  /** Route path, e.g. /api/cron/check-stuck-payments */
  path: string;
  /** Vercel cron expression */
  schedule: string;
  /** Matches cron_log.cron_name */
  name: string;
  last_ran: string | null;
  last_status: 'success' | 'failure' | 'partial' | null;
  last_duration_ms: number | null;
  last_error: string | null;
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
        .select('cron_name, ran_at, status, duration_ms, error_message')
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
      cronRowsRes.error;
    if (err) {
      console.error('[admin/health]', err);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }

    const latestByName = new Map<
      string,
      { ran_at: string; status: string; duration_ms: number | null; error_message: string | null }
    >();
    for (const row of cronRowsRes.data ?? []) {
      const name = String((row as { cron_name?: string }).cron_name ?? '');
      if (!name || latestByName.has(name)) continue;
      const r = row as {
        ran_at: string;
        status: string;
        duration_ms: number | null;
        error_message: string | null;
      };
      latestByName.set(name, {
        ran_at: r.ran_at,
        status: r.status,
        duration_ms: r.duration_ms,
        error_message: r.error_message,
      });
    }

    const cron_status: AdminHealthCronRow[] = VERCEL_CRON_DEFINITIONS.map(({ path, schedule }) => {
      const name = pathToCronLogName(path);
      const hit = latestByName.get(name);
      if (!hit) {
        return {
          path,
          schedule,
          name,
          last_ran: null,
          last_status: null,
          last_duration_ms: null,
          last_error: null,
        };
      }
      const st = hit.status;
      const last_status =
        st === 'success' || st === 'failure' || st === 'partial' ? st : null;
      return {
        path,
        schedule,
        name,
        last_ran: hit.ran_at,
        last_status,
        last_duration_ms: hit.duration_ms,
        last_error: hit.error_message,
      };
    });

    const stuck_sessions = stuckRes.count ?? 0;
    const zero_billing_centers = zeroBillRes.count ?? 0;

    return NextResponse.json({
      paymob_mode: getPaymobHealthMode(),
      wa_mode: waMode(),
      active_centers: activeRes.count ?? 0,
      pending_signups: pendingSignupRes.count ?? 0,
      stuck_sessions,
      pending_cancellations: pendingCancelRes.count ?? 0,
      pending_withdrawals: pendingWdRes.count ?? 0,
      zero_billing_centers,
      cron_status,
    });
  } catch (e) {
    console.error('[admin/health]', e);
    return NextResponse.json({ error: 'Failed to load health data' }, { status: 500 });
  }
}
