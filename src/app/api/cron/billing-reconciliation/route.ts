import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { insertCronLogSuccess, insertCronLogFailure } from '@/lib/cron/cronLog';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { reconcileRecentBilling } from '@/lib/billing/reconciliation';
import { inquirePaymobCardOrder } from '@/lib/paymobOrderInquiry';
import { finalizeInvoicePaymentSuccess } from '@/lib/invoicePaymobPayment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Nightly billing reconciliation (centers + teachers): cross-checks recent
 * invoice state against Paymob's record of truth. Flags mismatches into
 * billing_reconciliation_reports for human review and self-heals only the one
 * safe direction (Paymob-paid-but-unfinalized → run the idempotent finalizer).
 * Never auto-reverses or auto-refunds.
 */
export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'billing-reconciliation';

  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ success: false }, { status: 200 });
  }

  const supabase = createClient(url, key, {
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
    const summary = await reconcileRecentBilling(supabase, {
      inquireOrder: inquirePaymobCardOrder,
      finalize: finalizeInvoicePaymentSuccess,
      windowDays: 7,
    });

    await insertCronLogSuccess(supabase, CRON_NAME, {
      duration_ms: Date.now() - cronStart,
      records_processed: summary.paidChecked + summary.unpaidChecked,
      metadata: { ...summary },
    });

    try {
      if (supabaseAdmin) {
        await supabaseAdmin.from('cron_health_log').upsert(
          {
            cron_name: CRON_NAME,
            last_success_at: new Date().toISOString(),
            failure_count: 0,
          },
          { onConflict: 'cron_name' },
        );
      }
    } catch (healthLogErr) {
      console.error('[billing-reconciliation] cron_health_log:', healthLogErr);
    }

    return NextResponse.json({ success: true, ...summary });
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
