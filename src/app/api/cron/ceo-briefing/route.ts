/**
 * CEO daily briefing — 7:15am UTC (after renewal cron at 7:00)
 * Sends chq_ceo_briefing template to CEO_PHONE
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createAction } from '@/lib/ceo';
import { sendCeoBriefing, fetchCeoBriefingData } from '@/lib/whatsapp/flows/ceoBriefing';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'ceo-briefing';

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ success: false }, { status: 200 });
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: pausedRow } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'cron_paused')
    .maybeSingle();
  if (pausedRow?.value === true) {
    return NextResponse.json({ skipped: 'cron_paused' }, { status: 200 });
  }

  try {
    if (!process.env.CEO_PHONE) {
      throw new Error('CEO_PHONE not set');
    }
    const data = await fetchCeoBriefingData();

    let waSent = true;
    try { const result = await sendCeoBriefing(data); if (!result.success) throw new Error(result.error || 'Send failed'); } catch (waError) {
      console.error('[ceo-briefing] WA send failed:', waError);
      waSent = false;
      const msg = waError instanceof Error ? waError.message : 'Unknown';
      try {
        await createAction(supabase, {
          type: 'ops',
          priority: 'amber',
          title: 'CEO Briefing WA delivery failed',
          subtitle: `briefing_failed: ${msg}`,
          revenue_at_risk: 0,
          auto_generated: true,
        });
      } catch (queueErr) {
        console.error('[ceo-briefing] ceo_action_queue insert failed:', queueErr);
      }
    }

    const recordsProcessed = 1;
    await supabase.from('cron_log').insert({
      cron_name: CRON_NAME,
      status: 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: recordsProcessed,
      metadata: { waSent },
    });

    return NextResponse.json({ success: true, data, waSent });
  } catch (error) {
    console.error(`[${CRON_NAME}] Error:`, error);
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
