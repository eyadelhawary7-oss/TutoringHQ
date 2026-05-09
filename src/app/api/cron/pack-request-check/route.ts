import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { supabaseAdmin as supabaseAdminHealth } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'pack-request-check';

  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ success: false }, { status: 200 });
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: pausedRow } = await supabaseAdmin
    .from('platform_config')
    .select('value')
    .eq('key', 'cron_paused')
    .maybeSingle();
  if (pausedRow?.value === true) {
    return NextResponse.json({ skipped: 'cron_paused' }, { status: 200 });
  }

  try {
    const { count, error } = await supabaseAdmin
      .from('centers')
      .select('id', { count: 'exact', head: true })
      .eq('pack_request_status', 'pending');

    if (error) {
      throw new Error(error.message);
    }

    const n = count ?? 0;
    console.info(`[pack-request-check] Pending WA pack requests: ${n}`);

    await supabaseAdmin.from('cron_log').insert({
      cron_name: CRON_NAME,
      status: 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: n,
    });

    try {
      if (supabaseAdminHealth) {
        await supabaseAdminHealth.from('cron_health_log').upsert(
          {
            cron_name: 'pack-request-check',
            last_success_at: new Date().toISOString(),
            failure_count: 0,
          },
          { onConflict: 'cron_name' },
        );
      }
    } catch (healthLogErr) {
      console.error('[pack-request-check] cron_health_log:', healthLogErr);
    }

    return NextResponse.json({ success: true, pendingRequests: n });
  } catch (error) {
    console.error(`[${CRON_NAME}] Error:`, error);
    try {
      await supabaseAdmin.from('cron_log').insert({
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
