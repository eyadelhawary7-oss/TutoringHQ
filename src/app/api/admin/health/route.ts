import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminApi } from '@/lib/admin-auth';
import { requireSuperAdminRow } from '@/lib/admin-access';

export const dynamic = 'force-dynamic';

// Aggregates: cron_log (latest per cron_name), stuck_sessions (stale combined_payment_sessions),
// zero_billing_centers (active centers with null/zero billing_amount).

/** Crons we expect to see in cron_log (merge with DB for any extras). */
const KNOWN_CRON_NAMES = [
  'ceo-briefing',
  'check-stuck-payments',
  'cleanup-expired-sessions',
  'compute-benchmarks',
  'daily-summary',
  'detect-churn',
  'expire-credits',
  'mrr-snapshot',
  'pack-request-check',
  'parent-absence-alerts',
  'parent-balance-alerts',
  'parent-pack-billing',
  'process-renewals',
  'recompute-health-scores',
  'renewal-reminders',
  'status-ping',
  'check-token-health',
] as const;

function paymobMode(): 'live' | 'sandbox' {
  return process.env.PAYMOB_API_KEY?.startsWith('Key_') ? 'live' : 'sandbox';
}

function waMode(): 'live' | 'test' {
  return process.env.WHATSAPP_PHONE_NUMBER_ID === '1013787185158313' ? 'test' : 'live';
}

export type AdminHealthCronRow = {
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

  const supabase = auth.supabaseAdmin;
  const now = new Date();
  const cutoffIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  try {
    const [
      activeRes,
      pendingSignupRes,
      stuckRes,
      pendingCancelRes,
      pendingWdRes,
      zeroBillRes,
      cronRowsRes,
    ] = await Promise.all([
      supabase
        .from('centers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active'),
      supabase
        .from('centers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabase
        .from('combined_payment_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .lt('created_at', cutoffIso)
        .gt('expires_at', nowIso)
        .is('finalized_at', null),
      supabase
        .from('centers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_cancellation'),
      supabase
        .from('withdrawal_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabase
        .from('centers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .or('billing_amount.eq.0,billing_amount.is.null'),
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

    const nameSet = new Set<string>([...KNOWN_CRON_NAMES]);
    for (const n of latestByName.keys()) nameSet.add(n);

    const cron_status: AdminHealthCronRow[] = [...nameSet]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const hit = latestByName.get(name);
        if (!hit) {
          return {
            name,
            last_ran: null,
            last_status: null,
            last_duration_ms: null,
            last_error: null,
          };
        }
        const st = hit.status;
        const last_status =
          st === 'success' || st === 'failure' || st === 'partial'
            ? st
            : null;
        return {
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
      paymob_mode: paymobMode(),
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
