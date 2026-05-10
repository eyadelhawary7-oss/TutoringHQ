import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { insertCronLogFailure, insertCronLogSuccess } from '@/lib/cron/cronLog';

const CRON_NAME = 'cleanup-pending-signups';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  if (!supabaseAdmin) {
    return NextResponse.json({ success: false }, { status: 200 });
  }

  const admin = supabaseAdmin;
  const cronStart = Date.now();

  try {
    const nowIso = new Date().toISOString();
    const { error, count } = await supabaseAdmin
      .from('pending_signups')
      .delete({ count: 'exact' })
      .lt('expires_at', nowIso)
      .is('completed_at', null);

    if (error) {
      Sentry.captureException(error, { tags: { cron: CRON_NAME } });
      await insertCronLogFailure(admin, CRON_NAME, error, { duration_ms: Date.now() - cronStart });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await insertCronLogSuccess(admin, CRON_NAME, {
      duration_ms: Date.now() - cronStart,
      records_processed: count ?? 0,
    });

    return NextResponse.json({ deleted: count ?? 0 });
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: CRON_NAME } });
    await insertCronLogFailure(admin, CRON_NAME, e, { duration_ms: Date.now() - cronStart });
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
