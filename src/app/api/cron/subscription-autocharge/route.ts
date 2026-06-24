/**
 * Phase 2 (2a) — midnight billing cron. Scheduled at 00:00 Africa/Cairo
 * (registered at 0 22 * * * UTC, the repo's midnight-Cairo convention; the engine
 * is Cairo-date-driven regardless of the exact UTC fire time).
 *
 * Auto-charges every due saved-card customer (center + teacher) via the Phase 1
 * engine, leaves wallet / no-card customers on the manual unpaid surface, routes
 * bank declines (auth-required / hard) to the OTP fallback, and reschedules soft
 * declines. Idempotent: Phase 1's unique idempotency keys + due-date filtering
 * mean a same-day re-run never double-charges or double-invoices.
 *
 * INERT until PAYMOB_RECURRING_INTEGRATION_ID is set: with no recurring id the
 * Phase 1 charge returns 'recurring_integration_not_configured' and every due
 * customer simply lands on the manual surface — nothing is charged.
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { insertCronLogSuccess, insertCronLogFailure } from '@/lib/cron/cronLog';
import { cairoYmdPlusDays } from '@/lib/cairo/day';
import { runMidnightBilling } from '@/lib/midnightBilling';
import { createSupabaseMidnightBillingAdapter } from '@/lib/midnightBillingAdapter';
import { chargeSavedCard } from '@/lib/savedCard/autoCharge';
import { createSupabaseSavedCardStore } from '@/lib/savedCard/store';
import { paymobRecurringClient } from '@/lib/savedCard/paymobRecurring';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'subscription-autocharge';

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
    const adapter = createSupabaseMidnightBillingAdapter(supabase);
    const store = createSupabaseSavedCardStore(supabase);

    const summary = await runMidnightBilling(adapter, {
      charge: (input) => chargeSavedCard(input, { store, paymob: paymobRecurringClient }),
      addDays: cairoYmdPlusDays,
    });

    await insertCronLogSuccess(supabase, CRON_NAME, {
      duration_ms: Date.now() - cronStart,
      records_processed: summary.processed,
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
