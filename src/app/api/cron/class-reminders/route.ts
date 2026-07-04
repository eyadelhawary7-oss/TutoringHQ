import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { insertCronLogSuccess, insertCronLogFailure } from '@/lib/cron/cronLog';
import { supabaseAdmin as supabaseAdminHealth } from '@/lib/supabase-admin';
import { isTemplateApproved } from '@/lib/centerNotify';
import { queueClassReminderNotification } from '@/lib/teacherScheduleNotifications';
import { cairoDateKey } from '@/lib/cairo/day';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CRON_NAME = 'class-reminders';
const CLASS_REMINDER_TEMPLATE = 'chq_class_reminder';
const CAIRO_TZ = 'Africa/Cairo';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Cairo day-of-week today, 0=Sun..6=Sat (matches group_schedule.day_of_week). */
function cairoTodayDow(): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: CAIRO_TZ, weekday: 'long' })
    .format(new Date())
    .toLowerCase();
  return WEEKDAYS.indexOf(name);
}

/**
 * Daily class-reminder cron. Finds each PRIVATE group with a class occurring today
 * (Cairo) — its recurring group_schedule slot for today's weekday, minus any
 * cancelled/rescheduled-away exception, plus any class rescheduled ONTO today —
 * and sends the enrolled students a `chq_class_reminder`.
 *
 * Sends are gated on Meta template approval inside queueClassReminderNotification;
 * until chq_class_reminder is approved this cron finds classes but sends nothing
 * (it reports skipped: 'template_not_approved'). No dedup ledger: Vercel fires this
 * once per day, and each group is de-duplicated within the run.
 */
export async function POST(request: Request) {
  const cronStart = Date.now();

  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ success: false }, { status: 200 });
  }

  const supabaseAdmin: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
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

  let groupsWithClass = 0;
  let notified = 0;

  try {
    const todayYmd = cairoDateKey(new Date());
    const todayDow = cairoTodayDow();
    if (todayDow < 0) {
      await insertCronLogSuccess(supabaseAdmin, CRON_NAME, {
        duration_ms: Date.now() - cronStart,
        records_processed: 0,
        metadata: { error: 'cairo_dow_unresolved' },
      });
      return NextResponse.json({ success: true, groupsWithClass: 0, notified: 0 });
    }

    // Gate once up front. When the template is not approved this cron holds
    // cleanly: it does no roster reads and sends nothing.
    const approved = await isTemplateApproved(CLASS_REMINDER_TEMPLATE, supabaseAdmin);
    if (!approved) {
      await insertCronLogSuccess(supabaseAdmin, CRON_NAME, {
        duration_ms: Date.now() - cronStart,
        records_processed: 0,
        metadata: { skipped: 'template_not_approved' },
      });
      return NextResponse.json({ success: true, skipped: 'template_not_approved' });
    }

    // Recurring slots landing on today's weekday.
    const { data: slotRows, error: slotErr } = await supabaseAdmin
      .from('group_schedule')
      .select('id, group_id, day_of_week')
      .eq('day_of_week', todayDow)
      .limit(2000);
    if (slotErr) throw slotErr;
    const slots = (slotRows as { id: string; group_id: string }[] | null) ?? [];

    // Today's exceptions: on-date cancels/reschedules remove the native occurrence;
    // reschedules whose new_date is today ADD an occurrence for that group.
    const { data: exRows } = await supabaseAdmin
      .from('schedule_exceptions')
      .select('group_id, schedule_id, kind, exception_date, new_date')
      .or(`exception_date.eq.${todayYmd},new_date.eq.${todayYmd}`)
      .limit(4000);
    const exceptions =
      (exRows as
        | { group_id: string; schedule_id: string; kind: string; exception_date: string; new_date: string | null }[]
        | null) ?? [];

    const removedBySlot = new Set<string>(); // schedule_id whose today occurrence is cancelled/moved away
    const groupsRescheduledOntoToday = new Set<string>();
    for (const ex of exceptions) {
      if (ex.exception_date === todayYmd && (ex.kind === 'cancelled' || ex.kind === 'rescheduled')) {
        removedBySlot.add(ex.schedule_id);
      }
      if (ex.kind === 'rescheduled' && ex.new_date === todayYmd) {
        groupsRescheduledOntoToday.add(ex.group_id);
      }
    }

    const groupIds = new Set<string>();
    for (const s of slots) {
      if (removedBySlot.has(s.id)) continue; // class cancelled or moved off today
      groupIds.add(s.group_id);
    }
    for (const gid of groupsRescheduledOntoToday) groupIds.add(gid);

    if (groupIds.size === 0) {
      await insertCronLogSuccess(supabaseAdmin, CRON_NAME, {
        duration_ms: Date.now() - cronStart,
        records_processed: 0,
        metadata: { groupsWithClass: 0, notified: 0 },
      });
      return NextResponse.json({ success: true, groupsWithClass: 0, notified: 0 });
    }

    // Only private groups get schedule reminders; carry teacher_id for the
    // ownership re-check inside queueClassReminderNotification.
    const { data: groupRows } = await supabaseAdmin
      .from('student_groups')
      .select('id, teacher_id, kind')
      .in('id', [...groupIds])
      .eq('kind', 'private');
    const groups =
      (groupRows as { id: string; teacher_id: string | null; kind: string }[] | null) ?? [];

    for (const g of groups) {
      if (!g.teacher_id) continue;
      groupsWithClass += 1;
      try {
        await queueClassReminderNotification(g.id, todayYmd, g.teacher_id, supabaseAdmin);
        notified += 1;
      } catch (err) {
        console.error('[class-reminders] reminder failed:', g.id, err);
      }
    }

    await insertCronLogSuccess(supabaseAdmin, CRON_NAME, {
      duration_ms: Date.now() - cronStart,
      records_processed: groupsWithClass,
      metadata: { groupsWithClass, notified },
    });

    try {
      if (supabaseAdminHealth) {
        await supabaseAdminHealth.from('cron_health_log').upsert(
          {
            cron_name: CRON_NAME,
            last_success_at: new Date().toISOString(),
            failure_count: 0,
          },
          { onConflict: 'cron_name' },
        );
      }
    } catch (healthLogErr) {
      console.error('[class-reminders] cron_health_log:', healthLogErr);
    }

    return NextResponse.json({ success: true, groupsWithClass, notified });
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
