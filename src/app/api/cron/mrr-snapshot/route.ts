/**
 * Daily MRR snapshot — stores aggregates in mrr_snapshots (idempotent per snapshot_date).
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createAction } from '@/lib/ceo';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'mrr-snapshot';

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
    const snapshot_date = new Date().toISOString().slice(0, 10);
    const d = new Date();
    const yesterdayUtc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1));
    const yesterdayDate = yesterdayUtc.toISOString().slice(0, 10);
    const yesterdayStart = `${yesterdayDate}T00:00:00.000Z`;

    const [mrrRes, activeCountRes, newCountRes, churnedRes] = await Promise.all([
      supabase
        .from('centers')
        .select('all_in_price')
        .eq('subscription_status', 'active')
        .neq('billing_status', 'suspended')
        .neq('billing_type', 'payg')
        .gt('all_in_price', 0),
      supabase.from('centers').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase
        .from('centers')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')
        .gte('approved_at', yesterdayStart),
      supabase
        .from('centers')
        .select('*', { count: 'exact', head: true })
        .eq('subscription_status', 'suspended')
        .gte('auto_suspend_at', `${yesterdayDate}T00:00:00.000Z`)
        .lt('auto_suspend_at', `${yesterdayDate}T23:59:59.999Z`),
    ]);

    const qErr =
      mrrRes.error ?? activeCountRes.error ?? newCountRes.error ?? churnedRes.error;
    if (qErr) {
      throw new Error(qErr.message);
    }

    const mrrRows = (mrrRes.data ?? []) as { all_in_price: number | null }[];
    const mrr = mrrRows.reduce((s, r) => s + Number(r.all_in_price ?? 0), 0);
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

    const { data: zeroBillingCenters, error: zeroBillingErr } = await supabase
      .from('centers')
      .select('id, name, plan')
      .eq('status', 'active')
      .neq('billing_type', 'payg')
      .or('billing_amount.is.null,billing_amount.eq.0');

    if (zeroBillingErr) {
      console.error(`[${CRON_NAME}] zero billing check:`, zeroBillingErr);
    } else if (zeroBillingCenters?.length) {
      const rows = zeroBillingCenters as { name?: string | null; plan?: string | null }[];
      const body = rows.map((c) => `${c.name ?? '?'} (${c.plan ?? ''})`).join(', ');
      try {
        await createAction(supabase, {
          type: 'ops',
          priority: 'red',
          title: `⚠️ ${zeroBillingCenters.length} active centers with no billing amount`,
          subtitle: `zero_billing: ${body}`.slice(0, 2000),
          revenue_at_risk: 0,
          auto_generated: true,
        });
      } catch (actionErr) {
        console.error(`[${CRON_NAME}] ceo_action_queue (zero_billing):`, actionErr);
      }
    }

    await supabase.from('cron_log').insert({
      cron_name: CRON_NAME,
      status: 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: 1,
      metadata: { snapshot_date, mrr, active_centers, new_centers, churned_centers },
    });

    try {
      if (supabaseAdmin) {
        await supabaseAdmin.from('cron_health_log').upsert(
          {
            cron_name: 'mrr-snapshot',
            last_success_at: new Date().toISOString(),
            failure_count: 0,
          },
          { onConflict: 'cron_name' },
        );
      }
    } catch (healthLogErr) {
      console.error('[mrr-snapshot] cron_health_log:', healthLogErr);
    }

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
