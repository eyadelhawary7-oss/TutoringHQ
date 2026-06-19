import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/cron/reset-teacher-blast-credits (monthly, 01:00 on the 1st)
 * Resets the subscription blast-credit bucket to 100 for every ACTIVE paid
 * teacher (plan_key in ['teacher_pro','teacher_scale'], status='active').
 * Standard / trialing / free teachers are skipped by the RPC itself (it no-ops
 * unless the profile plan_key is a paid tier), so a row that has just
 * downgraded is safe.
 *
 * Operates off teacher_subscriptions directly (small table) - never scans raw
 * events. Paginated so it stays correct as the paid cohort grows. Idempotent:
 * reset_subscription_blast_credits just sets the bucket to 100, so a same-day
 * re-run is a no-op. Secured exactly like the other crons via requireCronSecret.
 */
const PAGE_SIZE = 500;

export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  let reset = 0;
  let skipped = 0;
  let processed = 0;

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from('teacher_subscriptions')
      .select('teacher_id')
      .in('plan_key', ['teacher_pro', 'teacher_scale'])
      .eq('status', 'active')
      .order('teacher_id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      Sentry.withScope((scope) => {
        scope.setTag('route', 'api/cron/reset-teacher-blast-credits');
        scope.setTag('step', 'list_paid_teachers');
        Sentry.captureException(error);
      });
      return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
    }

    const rows = (data ?? []) as { teacher_id: string }[];
    for (const row of rows) {
      processed += 1;
      const { data: rpcData, error: rpcErr } = await admin.rpc(
        'reset_subscription_blast_credits',
        { p_user_id: row.teacher_id },
      );
      if (rpcErr) {
        // One teacher's failure must not abort the whole run; log + continue.
        Sentry.withScope((scope) => {
          scope.setTag('route', 'api/cron/reset-teacher-blast-credits');
          scope.setTag('step', 'reset_rpc');
          scope.setTag('teacher_id', row.teacher_id);
          Sentry.captureException(rpcErr);
        });
        continue;
      }
      if ((rpcData as { reset?: boolean } | null)?.reset) reset += 1;
      else skipped += 1;
    }

    if (rows.length < PAGE_SIZE) break;
  }

  return NextResponse.json({ processed, reset, skipped });
}
