/**
 * CEO daily briefing — 7am UTC (9am Cairo)
 * Sends chq_ceo_briefing template to CEO_PHONE
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
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
    const result = await sendCeoBriefing(data);
    if (!result.success) {
      throw new Error(result.error || 'Send failed');
    }

    const recordsProcessed = 1;
    await supabase.from('cron_log').insert({
      cron_name: CRON_NAME,
      status: 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: recordsProcessed,
    });

    return NextResponse.json({ success: true, data });
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
