import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/cron/expire-group-proposals (nightly, 02:00 UTC)
 * Marks open group proposals whose negotiation clock ran out as expired.
 * expires_at is reset to now()+7d by the DB trigger on every offer insert,
 * so only genuinely stalled negotiations expire.
 */
export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const { data, error } = await admin
    .from('group_proposals')
    .update({ status: 'expired' })
    .eq('status', 'open')
    .lt('expires_at', new Date().toISOString())
    .select('id');
  if (error) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/cron/expire-group-proposals');
      scope.setTag('step', 'expire_update');
      Sentry.captureException(error);
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  }

  return NextResponse.json({ expired_count: (data ?? []).length });
}
