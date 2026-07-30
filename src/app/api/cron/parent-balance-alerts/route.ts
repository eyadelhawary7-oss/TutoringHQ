import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { insertCronLogSuccess, insertCronLogFailure } from '@/lib/cron/cronLog';
import { supabaseAdmin as supabaseAdminHealth } from '@/lib/supabase-admin';
import { isTemplateApproved } from '@/lib/centerNotify';
import { sendTemplateMessage } from '@/lib/whatsapp/client';
import { toArabicNumerals, WA_TEMPLATES } from '@/lib/parentPack';
import { getStudentBalances } from '@/lib/studentBalance';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'parent-balance-alerts';

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
    const { data: packCenters } = await supabaseAdmin
      .from('centers')
      .select('id, name')
      .eq('parent_pack_enabled', true)
      .eq('subscription_status', 'active');

    const packCenterIds = packCenters?.map((c) => c.id) ?? [];
    if (packCenterIds.length === 0) {
      await insertCronLogSuccess(supabaseAdmin, CRON_NAME, {
        duration_ms: Date.now() - cronStart,
        records_processed: 0,
      });
      return NextResponse.json({ success: true, sent: 0, skipped: 0 });
    }

    const centerNameMap = new Map(packCenters?.map((c) => [c.id, c.name]) ?? []);

    // D3/D25: students.payment_status is write-once-at-insert and never updated,
    // so it cannot say who currently owes money. Candidates come from the opt-in/
    // active/phone/center gates only; the actual "do they owe" and "how much" both
    // come from getStudentBalances - the same real-time balance calculation the
    // dashboard and student screens already use, so this cron can never quote or
    // target off a number those screens disagree with.
    const { data: candidates } = await supabaseAdmin
      .from('students')
      .select('id, name, parent_phone, center_id')
      .eq('parent_pack_opted_in', true)
      .not('parent_phone', 'is', null)
      .eq('is_active', true)
      .in('center_id', packCenterIds);

    const balances = await getStudentBalances(supabaseAdmin, {
      studentIds: (candidates ?? []).map((s) => s.id),
    });
    const students = (candidates ?? []).filter((s) => (balances.get(s.id)?.balance ?? 0) > 0);

    let sent = 0;
    let skipped = 0;

    for (const student of students) {
      const balance = balances.get(student.id)?.balance ?? 0;

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
            '3': toArabicNumerals(Math.round(balance)),
          });
          sent += 1;
        } catch (waErr) {
          console.error('[parent-balance-alerts] WA send error:', waErr);
        }
      } else {
        skipped += 1;
      }
    }

    await insertCronLogSuccess(supabaseAdmin, CRON_NAME, {
      duration_ms: Date.now() - cronStart,
      records_processed: sent + skipped,
      metadata: { sent, skipped },
    });

    try {
      if (supabaseAdminHealth) {
        await supabaseAdminHealth.from('cron_health_log').upsert(
          {
            cron_name: 'parent-balance-alerts',
            last_success_at: new Date().toISOString(),
            failure_count: 0,
          },
          { onConflict: 'cron_name' },
        );
      }
    } catch (healthLogErr) {
      console.error('[parent-balance-alerts] cron_health_log:', healthLogErr);
    }

    return NextResponse.json({ success: true, sent, skipped });
  } catch (error) {
    console.error(`[${CRON_NAME}] Error:`, error);
    await insertCronLogFailure(supabaseAdmin, CRON_NAME, error, {
      duration_ms: Date.now() - cronStart,
    });
    return NextResponse.json({ success: false }, { status: 200 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
