import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { insertCronLogSuccess, insertCronLogFailure } from '@/lib/cron/cronLog';
import { supabaseAdmin as supabaseAdminHealth } from '@/lib/supabase-admin';
import { isTemplateApproved } from '@/lib/centerNotify';
import { sendTemplateMessage } from '@/lib/whatsapp/client';
import {
  getCurrentCairoTime,
  getDayOfWeek,
  getTodayCairo,
  toArabicNumerals,
  WA_TEMPLATES,
} from '@/lib/parentPack';
import { assertIsoDateForOrFilter } from '@/lib/postgrestSafe';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'parent-absence-alerts';

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
    const todayDayOfWeek = getDayOfWeek(new Date());
    const todayCairo = assertIsoDateForOrFilter(getTodayCairo(), 'todayCairo');
    const { hour: currentHour, minute: currentMin } = getCurrentCairoTime();
    const sentToday = new Set<string>();

    const { data: activeCenters } = await supabaseAdmin
      .from('centers')
      .select('id')
      .eq('parent_pack_enabled', true)
      .eq('subscription_status', 'active');

    for (const center of activeCenters ?? []) {
      const { data: slots } = await supabaseAdmin
        .from('schedule_slots')
        .select('id, group_id, end_time, student_groups(name)')
        .eq('center_id', center.id)
        .eq('day_of_week', todayDayOfWeek)
        .eq('recurring', true)
        .or(`recurring_until.is.null,recurring_until.gte.${todayCairo}`);

      for (const slot of slots ?? []) {
        if (!slot.end_time) continue;

        const [endHour, endMin] = (slot.end_time as string).split(':').map(Number);
        const slotEnded =
          currentHour > endHour || (currentHour === endHour && currentMin >= endMin);
        if (!slotEnded) continue;

        const { data: members } = await supabaseAdmin
          .from('student_group_members')
          .select('students(id, name, parent_phone, parent_pack_opted_in, is_active)')
          .eq('group_id', slot.group_id as string)
          .eq('center_id', center.id);

        for (const member of members ?? []) {
          const rawSt = member.students as unknown;
          const s = (Array.isArray(rawSt) ? rawSt[0] : rawSt) as {
            id: string;
            name: string;
            parent_phone: string | null;
            parent_pack_opted_in: boolean | null;
            is_active: boolean | null;
          } | null;
          if (!s) continue;
          if (!s.parent_pack_opted_in) continue;
          if (s.is_active === false) continue;
          if (!s.parent_phone) continue;
          if (sentToday.has(s.id)) continue;

          const { data: scan } = await supabaseAdmin
            .from('attendance_scans')
            .select('id')
            .eq('student_id', s.id)
            .eq('session_date', todayCairo)
            .eq('group_id', slot.group_id as string)
            .limit(1)
            .maybeSingle();

          if (!scan) {
            const tmpl = WA_TEMPLATES.PARENT_ABSENCE;
            if (!(await isTemplateApproved(tmpl, supabaseAdmin))) continue;
            sentToday.add(s.id);
            const rawG = slot.student_groups as unknown;
            const gObj = (Array.isArray(rawG) ? rawG[0] : rawG) as { name?: string } | null;
            const groupName = gObj?.name ?? '';
            const dateDisplay = toArabicNumerals(todayCairo.split('-').reverse().join('/'));
            try {
              await sendTemplateMessage(center.id, s.parent_phone, tmpl, {
                '1': s.name,
                '2': groupName,
                '3': dateDisplay,
              });
            } catch (waErr) {
              console.error('[parent-absence-alerts] WA send error:', waErr);
            }
          }
        }
      }
    }

    const recordsProcessed = sentToday.size;

    await insertCronLogSuccess(supabaseAdmin, CRON_NAME, {
      duration_ms: Date.now() - cronStart,
      records_processed: recordsProcessed,
    });

    try {
      if (supabaseAdminHealth) {
        await supabaseAdminHealth.from('cron_health_log').upsert(
          {
            cron_name: 'parent-absence-alerts',
            last_success_at: new Date().toISOString(),
            failure_count: 0,
          },
          { onConflict: 'cron_name' },
        );
      }
    } catch (healthLogErr) {
      console.error('[parent-absence-alerts] cron_health_log:', healthLogErr);
    }

    return NextResponse.json({ success: true, sent: recordsProcessed });
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
