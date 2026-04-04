import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { isTemplateApproved } from '@/lib/centerNotify';
import { sendTemplateMessage } from '@/lib/whatsapp/client';
import { toArabicNumerals, WA_TEMPLATES } from '@/lib/parentPack';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'parent-balance-alerts';

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
    const { data: packCenters } = await supabaseAdmin
      .from('centers')
      .select('id, name')
      .eq('parent_pack_enabled', true)
      .eq('subscription_status', 'active');

    const packCenterIds = packCenters?.map((c) => c.id) ?? [];
    if (packCenterIds.length === 0) {
      await supabaseAdmin.from('cron_log').insert({
        cron_name: CRON_NAME,
        status: 'success',
        duration_ms: Date.now() - cronStart,
        records_processed: 0,
      });
      return NextResponse.json({ success: true, sent: 0, skipped: 0 });
    }

    const centerNameMap = new Map(packCenters?.map((c) => [c.id, c.name]) ?? []);

    const { data: students } = await supabaseAdmin
      .from('students')
      .select('id, name, parent_phone, fee, center_id')
      .eq('parent_pack_opted_in', true)
      .not('parent_phone', 'is', null)
      .eq('is_active', true)
      .eq('payment_status', 'unpaid')
      .in('center_id', packCenterIds);

    let sent = 0;
    let skipped = 0;

    for (const student of students ?? []) {
      const feeAmount = Number(student.fee ?? 0);
      if (feeAmount <= 0) {
        skipped += 1;
        continue;
      }

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: recentAlert } = await supabaseAdmin
        .from('wa_message_queue')
        .select('id')
        .eq('to_phone', student.parent_phone as string)
        .eq('template_name', WA_TEMPLATES.PARENT_BALANCE_DUE)
        .gt('created_at', sevenDaysAgo)
        .limit(1)
        .maybeSingle();

      if (!recentAlert) {
        const centerName = centerNameMap.get(student.center_id) ?? '';
        const tmpl = WA_TEMPLATES.PARENT_BALANCE_DUE;
        if (!(await isTemplateApproved(tmpl, supabaseAdmin))) {
          skipped += 1;
          continue;
        }
        try {
          await sendTemplateMessage(student.center_id as string, student.parent_phone as string, tmpl, {
            '1': student.name,
            '2': centerName,
            '3': toArabicNumerals(Math.round(feeAmount)),
          });
          sent += 1;
        } catch (waErr) {
          console.error('[parent-balance-alerts] WA send error:', waErr);
        }
      } else {
        skipped += 1;
      }
    }

    await supabaseAdmin.from('cron_log').insert({
      cron_name: CRON_NAME,
      status: 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: sent + skipped,
      metadata: { sent, skipped },
    });

    return NextResponse.json({ success: true, sent, skipped });
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
