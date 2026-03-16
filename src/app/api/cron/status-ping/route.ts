/**
 * Status ping cron — every 5 minutes
 * Pings API (Supabase), Scanner (Edge Function), Payments → insert status_checks
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function pingSupabase(supabase: SupabaseClient<any, any, any>): Promise<{ status: string; ms: number }> {
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://center-hq.vercel.app');
  try {
    const res = await fetch(`${appUrl}/api/health`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
    const ms = Date.now() - start;
    if (!res) return { status: 'outage', ms };
    return { status: res.ok ? 'operational' : res.status >= 500 ? 'outage' : 'degraded', ms };
  } catch {
    return { status: 'outage', ms: Date.now() - start };
  }
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
    console.error('[status-ping] Insert error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, pings: rows });
}
