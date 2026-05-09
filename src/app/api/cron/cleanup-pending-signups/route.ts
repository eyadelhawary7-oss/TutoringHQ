import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  if (!supabaseAdmin) {
    return NextResponse.json({ success: false }, { status: 200 });
  }

  try {
    const nowIso = new Date().toISOString();
    const { error, count } = await supabaseAdmin
      .from('pending_signups')
      .delete({ count: 'exact' })
      .lt('expires_at', nowIso)
      .is('completed_at', null);

    if (error) {
      Sentry.captureException(error, { tags: { cron: 'cleanup-pending-signups' } });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: count ?? 0 });
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: 'cleanup-pending-signups' } });
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
