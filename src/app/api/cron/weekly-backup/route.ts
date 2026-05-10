import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { notifyBackupComplete, runBackup } from '@/lib/googleDriveBackup';
import { insertCronLogFailure, insertCronLogPartial, insertCronLogSuccess } from '@/lib/cron/cronLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CRON_NAME = 'weekly-backup';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const startTime = Date.now();

  try {
    const result = await runBackup('weekly');
    await notifyBackupComplete(result);

    const durationMs = result.durationMs;
    if (result.errors.length === 0) {
      await insertCronLogSuccess(supabase, CRON_NAME, {
        duration_ms: durationMs,
        records_processed: result.totalRows,
        metadata: {
          files: result.files.length,
          folder_id: result.folderId,
          date: result.date,
        },
      });
    } else {
      await insertCronLogPartial(supabase, CRON_NAME, {
        duration_ms: durationMs,
        records_processed: result.totalRows,
        metadata: {
          files: result.files.length,
          errors: result.errors,
          folder_id: result.folderId,
          date: result.date,
        },
      });
    }

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
      console.error('[weekly-backup] cron_health_log:', healthLogErr);
    }

    return NextResponse.json({
      success: true,
      type: 'weekly',
      date: result.date,
      files: result.files.length,
      total_rows: result.totalRows,
      duration_ms: result.durationMs,
      errors: result.errors,
      folder_id: result.folderId,
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    await insertCronLogFailure(supabase, CRON_NAME, err, { duration_ms: durationMs });

    console.error('[weekly-backup] Failed:', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
