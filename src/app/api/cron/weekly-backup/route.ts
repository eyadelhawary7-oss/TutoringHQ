import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { tCronBackup } from '@/lib/cronBackupI18n';
import { notifyBackupComplete, runBackup } from '@/lib/googleDriveBackup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: tCronBackup('errorUnauthorized') }, { status: 401 });
  }

  const startTime = Date.now();

  await supabase.from('cron_log').insert({
    cron_name: 'weekly-backup',
    ran_at: new Date().toISOString(),
    status: 'running',
    duration_ms: 0,
    records_processed: 0,
  });

  try {
    const result = await runBackup('weekly');
    await notifyBackupComplete(result);

    await supabase.from('cron_log').insert({
      cron_name: 'weekly-backup',
      ran_at: new Date().toISOString(),
      status: result.errors.length === 0 ? 'success' : 'partial',
      duration_ms: result.durationMs,
      records_processed: result.totalRows,
      metadata: {
        files: result.files.length,
        errors: result.errors,
        folder_id: result.folderId,
        date: result.date,
      },
    });

    try {
      if (supabaseAdmin) {
        await supabaseAdmin.from('cron_health_log').upsert(
          {
            cron_name: 'weekly-backup',
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
    const message = String(err);

    await supabase.from('cron_log').insert({
      cron_name: 'weekly-backup',
      ran_at: new Date().toISOString(),
      status: 'error',
      duration_ms: durationMs,
      records_processed: 0,
      error_message: message,
    });

    console.error('[weekly-backup] Failed:', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
