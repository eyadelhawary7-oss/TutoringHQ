/**
 * Daily MRR snapshot — stores aggregates in mrr_snapshots (idempotent per snapshot_date).
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'mrr-snapshot';

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    const snapshot_date = new Date().toISOString().slice(0, 10);
    const d = new Date();
    const yesterdayUtc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1));
    const yesterdayStr = yesterdayUtc.toISOString().slice(0, 10);
    const yesterdayStart = `${yesterdayStr}T00:00:00.000Z`;

    const [billingRes, activeCountRes, newCountRes, churnedRes] = await Promise.all([
      supabase.from('centers').select('billing_amount').eq('status', 'active'),
      supabase.from('centers').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase
        .from('centers')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')
        .gte('approved_at', yesterdayStart),
      supabase
        .from('centers')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'suspended')
        .eq('auto_suspend_at', yesterdayStr),
    ]);

    const qErr =
      billingRes.error ?? activeCountRes.error ?? newCountRes.error ?? churnedRes.error;
    if (qErr) {
      throw new Error(qErr.message);
    }

    const billingRows = (billingRes.data ?? []) as { billing_amount: number | null }[];
    const mrr = billingRows.reduce((s, r) => s + Number(r.billing_amount ?? 0), 0);
    const active_centers = activeCountRes.count ?? 0;
    const new_centers = newCountRes.count ?? 0;
    const churned_centers = churnedRes.count ?? 0;

    const { error: upsertError } = await supabase.from('mrr_snapshots').upsert(
      {
        snapshot_date,
        mrr,
        active_centers,
        new_centers,
        churned_centers,
      },
      { onConflict: 'snapshot_date', ignoreDuplicates: true },
    );

    if (upsertError) {
      throw new Error(upsertError.message);
    }

    await supabase.from('cron_log').insert({
      cron_name: CRON_NAME,
      status: 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: 1,
      metadata: { snapshot_date, mrr, active_centers, new_centers, churned_centers },
    });

    return NextResponse.json({
      success: true,
      snapshot_date,
      mrr,
      active_centers,
      new_centers,
      churned_centers,
    });
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
