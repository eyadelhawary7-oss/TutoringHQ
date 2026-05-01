import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendPaymentConfirmed } from '@/lib/centerNotify';

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
  const auth = request.headers.get('Authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const admin = supabaseAdmin;

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
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const rows = (jobs ?? []) as WebhookOutboxJob[];
  if (rows.length === 0) {
    await upsertCronHealth();
    return NextResponse.json({ processed: 0, failed: 0, dead: 0 });
  }

  for (const job of rows) {
    const { error: procErr } = await admin
      .from('webhook_outbox')
      .update({ status: 'processing' })
      .eq('id', job.id);
    if (procErr) {
      console.error('[process-outbox] processing flag:', job.id, procErr.message);
      failed += 1;
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
