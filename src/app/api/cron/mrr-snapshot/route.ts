/**
 * Daily MRR snapshot — stores aggregates in mrr_snapshots (idempotent per snapshot_date).
 */

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return Response.json({ error: 'Missing Supabase config' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: pausedRow, error: pausedError } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'cron_paused')
    .maybeSingle();

  if (pausedError) {
    console.error('[mrr-snapshot] platform_config:', pausedError);
    return Response.json({ error: pausedError.message }, { status: 500 });
  }

  if (pausedRow?.value === true) {
    return Response.json({ skipped: true, reason: 'cron_paused' }, { status: 200 });
  }

  const snapshot_date = new Date().toISOString().slice(0, 10);
  const d = new Date();
  const yesterdayUtc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1));
  const yesterdayStr = yesterdayUtc.toISOString().slice(0, 10);
  const yesterdayStart = `${yesterdayStr}T00:00:00.000Z`;

  // mrr: COALESCE(SUM(billing_amount), 0) WHERE status = 'active'
  // new_centers: approved_at >= CURRENT_DATE - INTERVAL '1 day' (≥ start of yesterday, UTC)
  // churned_centers: auto_suspend_at = CURRENT_DATE - 1 (calendar date equality)
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
    console.error('[mrr-snapshot] aggregate query error:', qErr);
    return Response.json({ error: qErr.message }, { status: 500 });
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
    { onConflict: 'snapshot_date', ignoreDuplicates: true }
  );

  if (upsertError) {
    console.error('[mrr-snapshot] upsert error:', upsertError);
    return Response.json({ error: upsertError.message }, { status: 500 });
  }

  return Response.json(
    {
      success: true,
      snapshot_date,
      mrr,
      active_centers,
      new_centers,
      churned_centers,
    },
    { status: 200 }
  );
}

export const dynamic = 'force-dynamic';
