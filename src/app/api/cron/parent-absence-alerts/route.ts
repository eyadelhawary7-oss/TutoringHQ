import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendTemplateMessage } from '@/lib/whatsapp/client';
import {
  getCurrentCairoTime,
  getDayOfWeek,
  getTodayCairo,
  toArabicNumerals,
  WA_TEMPLATES,
} from '@/lib/parentPack';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const todayDayOfWeek = getDayOfWeek(new Date());
  const todayCairo = getTodayCairo();
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
          sentToday.add(s.id);
          const rawG = slot.student_groups as unknown;
          const gObj = (Array.isArray(rawG) ? rawG[0] : rawG) as { name?: string } | null;
          const groupName = gObj?.name ?? '';
          const dateDisplay = toArabicNumerals(todayCairo.split('-').reverse().join('/'));
          await sendTemplateMessage(center.id, s.parent_phone, WA_TEMPLATES.PARENT_ABSENCE, {
            '1': s.name,
            '2': groupName,
            '3': dateDisplay,
          });
        }
      }
    }
  }

  return NextResponse.json({ sent: sentToday.size });
}
