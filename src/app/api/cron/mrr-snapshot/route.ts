/**
 * Daily MRR snapshot — stores aggregates in mrr_snapshots (idempotent per snapshot_date).
 * Invoked via Supabase pg_cron + net.http_post with Bearer CRON_SECRET.
 */

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
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
    console.error('[mrr-snapshot] platform_config error:', pausedError);
    return Response.json({ error: pausedError.message }, { status: 500 });
  }

  if (pausedRow?.value === true) {
    return Response.json({ skipped: true, reason: 'cron_paused' }, { status: 200 });
  }

  // Aligns with Postgres CURRENT_DATE-style boundaries using UTC calendar dates (Supabase default).
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterdayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const yesterdayStr = yesterdayUtc.toISOString().slice(0, 10);
  const yesterdayStart = `${yesterdayStr}T00:00:00.000Z`;
  const todayStart = `${today}T00:00:00.000Z`;

  // mrr: COALESCE(SUM(billing_amount), 0) FROM centers WHERE status = 'active'
  // active_centers / new_centers / churned_centers: COUNT(*) with same filters as specified SQL
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
      .gte('auto_suspend_at', yesterdayStart)
      .lt('auto_suspend_at', todayStart),
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

  // ON CONFLICT (snapshot_date) DO NOTHING — idempotent
  const { error: upsertError } = await supabase.from('mrr_snapshots').upsert(
    {
      snapshot_date: today,
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
      snapshot_date: today,
      mrr,
      active_centers,
      new_centers,
      churned_centers,
    },
    { status: 200 }
  );
}

export const dynamic = 'force-dynamic';
