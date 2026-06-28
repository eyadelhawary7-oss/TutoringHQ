/**
 * Summer-2026 daily billing pass (Vercel cron). Runs once per day; idempotent.
 *
 * No-op unless summer.promo.enabled is ON. When on, it (1) enrolls signed-up
 * customers into their 14-day trial on/after SUMMER_FREE_UNTIL (money-free) and
 * (2) issues each customer's first invoice on/after their first_invoice_at — but
 * ONLY when summer.first_charge_release = RELEASED. See src/lib/summerBillingCron.
 *
 * Gated on CRON_SECRET and honours platform_config.cron_paused like the others.
 */

import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { insertCronLogSuccess, insertCronLogFailure } from '@/lib/cron/cronLog';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { runSummerBillingCron } from '@/lib/summerBillingCron';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function run(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'summer-billing';

  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  if (!supabaseAdmin) {
    return NextResponse.json({ success: false }, { status: 200 });
  }
  const supabase = supabaseAdmin;

  const { data: paused } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'cron_paused')
    .maybeSingle();
  if (paused?.value === true) {
    return NextResponse.json({ skipped: 'cron_paused' }, { status: 200 });
  }

  try {
    const result = await runSummerBillingCron(supabase);
    await insertCronLogSuccess(supabase, CRON_NAME, {
      duration_ms: Date.now() - cronStart,
      records_processed:
        result.centersEnrolled +
        result.centersInvoiced +
        result.centersRolled +
        result.teachersEnrolled +
        result.teachersInvoiced +
        result.teachersRolled,
      metadata: { ...result },
    });
    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (err) {
    await insertCronLogFailure(supabase, CRON_NAME, err, { duration_ms: Date.now() - cronStart });
    return NextResponse.json({ success: false }, { status: 200 });
  }
}

export async function GET(request: Request) {
  return run(request);
}
export async function POST(request: Request) {
  return run(request);
}
