import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendPaymentConfirmed } from '@/lib/centerNotify';
import { processCardOrderStatusWaOutboxJob } from '@/lib/cardOrderNotifications';
import { processBillingNudgeWaOutboxJob } from '@/lib/nudges/outboxHandler';
import { insertCronLogFailure, insertCronLogSuccess } from '@/lib/cron/cronLog';
import { createAction } from '@/lib/ceo';

const CRON_NAME = 'process-outbox';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

type WebhookOutboxJob = {
  id: string;
  job_type: string;
  payload: unknown;
  status: string;
  attempt_count: number | null;
  max_attempts: number | null;
  next_attempt_at: string | null;
};

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const admin = supabaseAdmin;
  const cronStart = Date.now();

  let processed = 0;
  let failed = 0;
  let dead = 0;

  const nowIso = new Date().toISOString();

  const { data: jobs, error: fetchErr } = await admin
    .from('webhook_outbox')
    .select('*')
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', nowIso)
    .order('next_attempt_at', { ascending: true })
    .limit(20);

  if (fetchErr) {
    console.error('[process-outbox] fetch:', fetchErr.message);
    await insertCronLogFailure(admin, CRON_NAME, new Error(fetchErr.message), {
      duration_ms: Date.now() - cronStart,
    });
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const rows = (jobs ?? []) as WebhookOutboxJob[];
  if (rows.length === 0) {
    await upsertCronHealth();
    await insertCronLogSuccess(admin, CRON_NAME, {
      duration_ms: Date.now() - cronStart,
      records_processed: 0,
    });
    return NextResponse.json({ processed: 0, failed: 0, dead: 0 });
  }

  for (const job of rows) {
    // L5: atomic claim. Constrain the flip to rows still in a claimable state
    // and re-select, so two overlapping cron runs can't both claim the same row
    // — the loser's update matches 0 rows and it skips the job.
    const { data: claimed, error: procErr } = await admin
      .from('webhook_outbox')
      .update({ status: 'processing' })
      .eq('id', job.id)
      .in('status', ['pending', 'failed'])
      .select('id');
    if (procErr) {
      console.error('[process-outbox] processing flag:', job.id, procErr.message);
      failed += 1;
      continue;
    }
    if (!claimed || claimed.length === 0) {
      // Already claimed by a concurrent run — skip.
      continue;
    }

    let success = false;
    try {
      if (job.job_type === 'send_wa_payment_confirmed') {
        const { phone, centerName, period, amount } = job.payload as {
          phone?: string;
          centerName?: string;
          period?: string;
          amount?: string;
        };
        const result = await sendPaymentConfirmed(
          admin,
          phone ?? '',
          centerName ?? '',
          period ?? '',
          amount ?? '',
        );
        success = result.success === true || result.skipped === true;
      } else if (job.job_type === 'send_card_order_status_wa') {
        success = await processCardOrderStatusWaOutboxJob(job.payload);
      } else if (job.job_type === 'send_billing_nudge_wa') {
        success = await processBillingNudgeWaOutboxJob(job.payload, admin);
      } else {
        console.warn('[process-outbox] unknown job_type', job.job_type);
      }

      if (success) {
        const { error: doneErr } = await admin
          .from('webhook_outbox')
          .update({
            status: 'done',
            completed_at: new Date().toISOString(),
            last_attempt_at: new Date().toISOString(),
            attempt_count: (job.attempt_count ?? 0) + 1,
          })
          .eq('id', job.id);
        if (doneErr) {
          console.error('[process-outbox] done update:', job.id, doneErr.message);
          throw new Error(doneErr.message);
        }
        processed += 1;
      } else {
        throw new Error('handler returned false');
      }
    } catch (e) {
      const newAttemptCount = (job.attempt_count ?? 0) + 1;
      const maxAttempts = job.max_attempts ?? 5;
      const errMsg = e instanceof Error ? e.message : 'Unknown error';

      if (newAttemptCount >= maxAttempts) {
        const { error: dlqErr } = await admin.from('dead_letter_queue').insert({
          outbox_id: job.id,
          job_type: job.job_type,
          payload: job.payload,
          error_message: errMsg,
          attempt_count: newAttemptCount,
        });
        if (dlqErr) {
          console.error('[process-outbox] DLQ insert:', job.id, dlqErr.message);
        }
        const { error: deadErr } = await admin
          .from('webhook_outbox')
          .update({ status: 'dead' })
          .eq('id', job.id);
        if (deadErr) {
          console.error('[process-outbox] dead update:', job.id, deadErr.message);
        }
        dead += 1;

        // Surface the dropped message so it is never silently lost: a CEO action
        // (visible self-serve in the console + on /admin/health) and a Sentry
        // alert. Recovery is a safe one-click retry from the admin dead-letter
        // view. Non-fatal — a surfacing failure must not break the cron.
        Sentry.captureMessage('outbox job dead-lettered', {
          level: 'warning',
          tags: { area: 'outbox', job_type: job.job_type },
          extra: { job_id: job.id, attempts: newAttemptCount, error: errMsg },
        });
        try {
          await createAction(admin, {
            type: 'ops',
            priority: 'amber',
            title: `Notification failed after ${newAttemptCount} retries (${job.job_type})`,
            subtitle: errMsg.slice(0, 240),
            action_label: 'Review & retry',
            action_url: '/admin/health',
            auto_generated: true,
          });
        } catch (alertErr) {
          console.error('[process-outbox] dead-letter alert:', alertErr);
        }
      } else {
        const backoffMs = Math.pow(2, newAttemptCount) * 60 * 1000;
        const nextAttempt = new Date(Date.now() + backoffMs).toISOString();
        const { error: failErr } = await admin
          .from('webhook_outbox')
          .update({
            status: 'failed',
            next_attempt_at: nextAttempt,
            attempt_count: newAttemptCount,
            error_message: errMsg,
          })
          .eq('id', job.id);
        if (failErr) {
          console.error('[process-outbox] failed update:', job.id, failErr.message);
        }
        failed += 1;
      }
    }
  }

  await upsertCronHealth();
  await insertCronLogSuccess(admin, CRON_NAME, {
    duration_ms: Date.now() - cronStart,
    records_processed: processed + failed + dead,
    metadata: { processed, failed, dead },
  });
  return NextResponse.json({ processed, failed, dead });
}

async function upsertCronHealth() {
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin.from('cron_health_log').upsert(
      {
        cron_name: 'process-outbox',
        last_success_at: new Date().toISOString(),
        failure_count: 0,
      },
      { onConflict: 'cron_name' },
    );
  } catch (e) {
    console.error('[process-outbox] cron_health_log:', e);
  }
}
