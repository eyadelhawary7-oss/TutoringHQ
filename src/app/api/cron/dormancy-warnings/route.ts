/**
 * Monthly (1st): warnings for long-dormant centers; at 12+ months export + purge operational data.
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { todayISO } from '@/lib/parentPack';
import { tCronBackup } from '@/lib/cronBackupI18n';
import {
  sendDataDeletionNotice,
  sendReactivationWarning30,
  sendReactivationWarning90,
} from '@/lib/centerNotify';
import {
  exportDormantCenterToDrive,
  monthsSinceDormancy,
  purgeDormantCenterOperationalData,
} from '@/lib/dormantCenterPurge';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SYSTEM_AUDIT_USER_ID = '00000000-0000-0000-0000-000000000000';

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'dormancy-warnings';

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: tCronBackup('errorUnauthorized') }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ success: false }, { status: 200 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: pausedRow } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'cron_paused')
    .maybeSingle();
  if (pausedRow?.value === true) {
    return NextResponse.json({ skipped: 'cron_paused' }, { status: 200 });
  }

  const today = todayISO();

  try {
    const { data: dormantRows, error: qErr } = await supabase
      .from('centers')
      .select('id, name, phone, dormancy_date, dormancy_purged_at, status')
      .eq('status', 'dormant')
      .not('dormancy_date', 'is', null);

    if (qErr) {
      throw new Error(qErr.message);
    }

    let warned90 = 0;
    let warned30 = 0;
    let purged = 0;
    const errors: string[] = [];

    for (const raw of dormantRows ?? []) {
      const c = raw as {
        id: string;
        name: string | null;
        phone: string | null;
        dormancy_date: string;
        dormancy_purged_at: string | null;
        status: string;
      };

      const dormYmd = String(c.dormancy_date).slice(0, 10);
      const months = monthsSinceDormancy(dormYmd, today);

      try {
        if (months >= 12 && !c.dormancy_purged_at) {
          const exportRes = await exportDormantCenterToDrive(supabase, c.id, today);
          if (exportRes.errors.length) {
            errors.push(`${c.id} export: ${exportRes.errors.join('; ')}`);
          }

          const purgeRes = await purgeDormantCenterOperationalData(supabase, c.id);
          if (purgeRes.errors.length) {
            errors.push(`${c.id} purge: ${purgeRes.errors.join('; ')}`);
          }

          await supabase
            .from('centers')
            .update({
              status: 'rejected',
              dormancy_purged_at: new Date().toISOString(),
              subscription_status: 'cancelled',
              billing_status: 'suspended',
            })
            .eq('id', c.id);

          await supabase.from('audit_log').insert({
            center_id: c.id,
            user_id: SYSTEM_AUDIT_USER_ID,
            action: 'dormant_center_data_purged',
            entity_type: 'center',
            details: {
              dormancy_date: dormYmd,
              export_folder: exportRes.folderId,
              export_files: exportRes.files,
              deleted: purgeRes.deleted,
            },
          });

          await sendDataDeletionNotice(supabase, c.id, today);
          purged++;
          continue;
        }

        if (months === 9) {
          const r = await sendReactivationWarning90(supabase, c.id);
          if (r.success) warned90++;
        } else if (months === 11) {
          const r = await sendReactivationWarning30(supabase, c.id);
          if (r.success) warned30++;
        }
      } catch (e) {
        errors.push(`${c.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    await supabase.from('cron_log').insert({
      cron_name: CRON_NAME,
      status: errors.length > 0 && purged === 0 && warned90 === 0 && warned30 === 0 ? 'partial' : 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: (dormantRows ?? []).length,
      metadata: { today, warned90, warned30, purged, errors: errors.slice(0, 20) },
      error_message: errors.length ? errors.join('; ').slice(0, 2000) : null,
    });

    return NextResponse.json({ success: true, today, warned90, warned30, purged, errors });
  } catch (error) {
    console.error(`[${CRON_NAME}]`, error);
    try {
      await supabase.from('cron_log').insert({
        cron_name: CRON_NAME,
        status: 'failure',
        duration_ms: Date.now() - cronStart,
        error_message: error instanceof Error ? error.message.slice(0, 2000) : 'Unknown',
      });
    } catch (logErr) {
      console.error(`[${CRON_NAME}] cron_log:`, logErr);
    }
    return NextResponse.json({ success: false }, { status: 200 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
