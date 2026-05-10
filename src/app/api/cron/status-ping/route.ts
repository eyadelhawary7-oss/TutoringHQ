/**
 * Status ping cron — every 5 minutes
 * Pings API (Supabase), Scanner (Edge Function), Payments → insert status_checks
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { insertCronLogFailure } from '@/lib/cron/cronLog';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function pingSupabase(supabase: SupabaseClient): Promise<{ status: string; ms: number }> {
  const start = Date.now();
  try {
    const { error } = await supabase.from('centers').select('id').limit(1);
    const ms = Date.now() - start;
    return { status: error ? 'degraded' : 'operational', ms };
  } catch {
    return { status: 'outage', ms: Date.now() - start };
  }
}

async function pingScanner(): Promise<{ status: string; ms: number }> {
  const start = Date.now();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return { status: 'outage', ms: 0 };
  const base = supabaseUrl.replace(/\/rest\/v1.*$/, '');
  const fnUrl = `${base}/functions/v1/process-onboarding`;
  try {
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10000),
    });
    const ms = Date.now() - start;
    return { status: res.ok ? 'operational' : res.status >= 500 ? 'outage' : 'degraded', ms };
  } catch {
    return { status: 'outage', ms: Date.now() - start };
  }
}

async function pingPayments(): Promise<{ status: string; ms: number }> {
  const start = Date.now();
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://centerhq.app');
  try {
    const res = await fetch(`${appUrl}/api/health`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
    const ms = Date.now() - start;
    if (!res) return { status: 'outage', ms };
    return { status: res.ok ? 'operational' : res.status >= 500 ? 'outage' : 'degraded', ms };
  } catch {
    return { status: 'outage', ms: Date.now() - start };
  }
}

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'status-ping';

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
    const [apiResult, scannerResult, paymentsResult] = await Promise.all([
      pingSupabase(supabase),
      pingScanner(),
      pingPayments(),
    ]);

    const rows = [
      { service: 'api', status: apiResult.status, response_time_ms: apiResult.ms },
      { service: 'scanner', status: scannerResult.status, response_time_ms: scannerResult.ms },
      { service: 'payments', status: paymentsResult.status, response_time_ms: paymentsResult.ms },
    ];

    const { error } = await supabase.from('status_checks').insert(rows);

    if (error) {
      throw new Error(error.message);
    }

    await supabase.from('cron_log').insert({
      cron_name: CRON_NAME,
      status: 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: rows.length,
    });

    try {
      if (supabaseAdmin) {
        await supabaseAdmin.from('cron_health_log').upsert(
          {
            cron_name: 'status-ping',
            last_success_at: new Date().toISOString(),
            failure_count: 0,
          },
          { onConflict: 'cron_name' },
        );
      }
    } catch (healthLogErr) {
      console.error('[status-ping] cron_health_log:', healthLogErr);
    }

    return NextResponse.json({ success: true, pings: rows });
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
