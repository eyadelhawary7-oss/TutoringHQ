/**
 * Single-day billing lockout tick (Job 3, Part 2). Scheduled "0,59 * * * *" in
 * vercel.json (UTC), but every decision is Cairo-wall-clock driven and DST-safe: the
 * pure scheduler fires the invoice+nudge at 00:00 Cairo, same-day card retries at the
 * tunable times, the second reminder at 17:00, and the lock at 23:59 -- each exactly
 * once per Cairo day via the billing_lockout_events ledger.
 *
 * WHY "0,59" AND NOT "0 * * * *": Africa/Cairo is a whole-hour offset, so an on-the-
 * hour cron only ever produces a Cairo minute-of-day of 0 (max 1380 at 23:00) and the
 * 23:59 lock (1439) could NEVER fire. Adding the :59 tick makes the 23:59-Cairo
 * instant a real tick so the lock actually runs, while the :00 tick keeps the retry
 * and reminder phases on their exact configured hours. tests/unit/billingLockoutSchedule.test.ts
 * parses this schedule from vercel.json and proves the lock fires on both DST edges;
 * reverting to "0 * * * *" fails that test.
 *
 * THE INTERLOCK (most important requirement in the brief): this cron physically
 * refuses to lock while saved-card auto-charge is not live. getLockoutPolicyState
 * folds in three guards — PAYMOB_RECURRING_INTEGRATION_ID must be a real credential
 * (not unset/empty/'placeholder'), summer.first_charge_release must be RELEASED, and
 * the billing.lockout.enabled kill switch must be on. If any fails, the cron does
 * NOTHING: it never charges, never nudges-to-lock, never downgrades a teacher, never
 * paywalls a centre. When the interlock is the SOLE blocker (released + kill switch
 * on but the credential is still a placeholder) it logs loudly and raises a Sentry
 * warning — that is the dangerous "someone flipped the gate too early" case.
 *
 * Inert today: first_charge_release is HELD and the recurring id is a placeholder,
 * so this returns skipped without touching a single centre.
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { insertCronLogSuccess, insertCronLogFailure } from '@/lib/cron/cronLog';
import { getLockoutPolicyState } from '@/lib/billingLockoutPolicy';
import { runBillingLockoutTick, buildLockoutTickConfig } from '@/lib/billingLockout';
import { createSupabaseLockoutAdapter } from '@/lib/billingLockoutAdapter';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'billing-lockout';

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

  // THE interlock / HELD / kill-switch gate. Hard stop before touching any centre.
  const policy = await getLockoutPolicyState();
  if (!policy.active) {
    if (policy.reason === 'autocharge_not_configured') {
      // Released + kill switch on, but the recurring credential is a placeholder.
      // This is the outage this interlock exists to prevent: leave every account
      // OPEN and shout about it.
      console.error(
        '[billing-lockout] LOCKOUT SUPPRESSED: PAYMOB_RECURRING_INTEGRATION_ID is not a real credential ' +
          '(unset/empty/placeholder) while first_charge_release is RELEASED. Leaving all accounts open.',
      );
      Sentry.withScope((scope) => {
        scope.setTag('cron', CRON_NAME);
        scope.setTag('reason', 'autocharge_not_configured');
        scope.setLevel('warning');
        Sentry.captureMessage(
          'Billing lockout suppressed by the auto-charge interlock: first_charge_release is RELEASED but ' +
            'PAYMOB_RECURRING_INTEGRATION_ID is still a placeholder. No centre was locked. Set the real ' +
            'recurring credential or re-HOLD first_charge_release.',
        );
      });
    }
    await insertCronLogSuccess(supabase, CRON_NAME, {
      duration_ms: Date.now() - cronStart,
      records_processed: 0,
      metadata: { skipped: policy.reason },
    });
    return NextResponse.json({ skipped: policy.reason }, { status: 200 });
  }

  try {
    const adapter = createSupabaseLockoutAdapter(supabase);
    const config = buildLockoutTickConfig({
      retryTimesCairo: policy.retryTimesCairo,
      reminderTimeCairo: policy.reminderTimeCairo,
      maxAttempts: policy.maxAttempts,
    });
    const summary = await runBillingLockoutTick(adapter, config);

    await insertCronLogSuccess(supabase, CRON_NAME, {
      duration_ms: Date.now() - cronStart,
      records_processed: summary.centersProcessed,
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
