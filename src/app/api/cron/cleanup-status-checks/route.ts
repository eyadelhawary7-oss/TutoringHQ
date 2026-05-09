import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { tCronBackup } from '@/lib/cronBackupI18n';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const { error, count } = await supabase
    .from('status_checks')
    .delete({ count: 'exact' })
    .lt('checked_at', cutoff.toISOString());

  if (error) {
    console.error('[cleanup-status-checks]', error.message);
    return NextResponse.json(
      { success: false, error: tCronBackup('cleanupFailed', { message: error.message }) },
      { status: 500 },
    );
  }

  await supabase.from('cron_log').insert({
    cron_name: 'cleanup-status-checks',
    ran_at: new Date().toISOString(),
    status: 'success',
    duration_ms: 0,
    records_processed: count ?? 0,
  });

  try {
    if (supabaseAdmin) {
      await supabaseAdmin.from('cron_health_log').upsert(
        {
          cron_name: 'cleanup-status-checks',
          last_success_at: new Date().toISOString(),
          failure_count: 0,
        },
        { onConflict: 'cron_name' },
      );
    }
  } catch (healthLogErr) {
    console.error('[cleanup-status-checks] cron_health_log:', healthLogErr);
  }

  return NextResponse.json({
    success: true,
    deleted: count ?? 0,
    cutoff: cutoff.toISOString(),
  });
}
