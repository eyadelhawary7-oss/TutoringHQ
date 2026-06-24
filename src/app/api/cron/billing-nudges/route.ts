/**
 * Unified billing nudge / dunning pass (centers + teachers). Runs daily at
 * ~10:00 Africa/Cairo — AFTER the 00:00 midnight billing run has settled, so
 * auto-charged owners are already 'paid' and excluded. One pass evaluates who is
 * due for which nudge (pre-billing T-3/T-1, due-today/grace, post-lock,
 * card-expiry T-30/T-7) and enqueues the WhatsApp sends idempotently.
 *
 * The in-app banner is NOT driven from here — it is computed live per request in
 * /api/billing/nudge-status and works regardless of this cron or WhatsApp state.
 *
 * WhatsApp stays inert until NUDGE_WHATSAPP_ENABLED=true AND each template is
 * Meta-approved; until then every due nudge is recorded 'disabled' (banner only).
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { insertCronLogSuccess, insertCronLogFailure } from '@/lib/cron/cronLog';
import { runBillingNudges } from '@/lib/nudges/runBillingNudges';
import { createSupabaseNudgeDeps } from '@/lib/nudges/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'billing-nudges';

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
    const deps = createSupabaseNudgeDeps(supabase);
    const summary = await runBillingNudges(deps);

    await insertCronLogSuccess(supabase, CRON_NAME, {
      duration_ms: Date.now() - cronStart,
      records_processed: summary.claimed,
      metadata: { ...summary },
    });

    return NextResponse.json({ success: true, summary });
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
