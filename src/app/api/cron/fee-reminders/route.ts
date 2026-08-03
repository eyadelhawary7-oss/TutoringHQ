import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { insertCronLogSuccess, insertCronLogFailure } from '@/lib/cron/cronLog';
import { supabaseAdmin as supabaseAdminHealth } from '@/lib/supabase-admin';
import { isTemplateApproved } from '@/lib/centerNotify';
import { sendTemplateMessage } from '@/lib/whatsapp/client';
import { formatCurrency } from '@/lib/formatNumber';
import {
  FEE_REMINDER_FALLBACK_TEXT,
  FEE_REMINDER_TEMPLATE,
  MAX_FEE_REMINDERS,
  buildPaymentDetails,
  nextClassDate,
  type TeacherPaymentProfile,
} from '@/lib/teacherFeeReminder';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_REMINDER_AGE_MS = ONE_DAY_MS; // class ended > 24h ago
const SECOND_REMINDER_GAP_MS = 3 * ONE_DAY_MS; // ~3 days after the first
// Template name, reminder cap and the message-construction helpers
// (buildPaymentDetails / nextClassDate / the fallback ask) live in
// src/lib/teacherFeeReminder.ts, shared with the manual Send-reminder endpoint
// so the two paths always build the identical message and enforce one cap.
const MAX_REMINDERS = MAX_FEE_REMINDERS;

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'fee-reminders';

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

  let sent = 0;
  let skipped = 0;
  let fallback = 0;
  let failed = 0;

  try {
    const approved = await isTemplateApproved(FEE_REMINDER_TEMPLATE, supabaseAdmin);

    const now = Date.now();
    const firstCutoff = new Date(now - FIRST_REMINDER_AGE_MS).toISOString();
    const secondGapCutoff = new Date(now - SECOND_REMINDER_GAP_MS).toISOString();

    // Pending lesson charges that have reached the 24h boundary and are still
    // below the reminder cap. created_at is the class-end reference.
    const { data: charges, error: chargesErr } = await supabaseAdmin
      .from('transactions')
      .select(
        'id, student_id, group_id, teacher_id, center_id, amount_billed, payer_phone, fee_reminder_count, fee_reminder_last_at, created_at',
      )
      .eq('kind', 'lesson')
      .eq('status', 'pending')
      .eq('is_test', false)
      .lt('fee_reminder_count', MAX_REMINDERS)
      .lt('created_at', firstCutoff)
      .not('payer_phone', 'is', null)
      .limit(1000);

    if (chargesErr) {
      throw chargesErr;
    }

    // Cache per-teacher payment profile and per-group schedule across rows.
    const teacherCache = new Map<string, TeacherPaymentProfile | null>();
    const groupScheduleCache = new Map<string, { day_of_week: number }[]>();
    const flaggedTeachers = new Set<string>();

    for (const charge of charges ?? []) {
      const count = Number(charge.fee_reminder_count ?? 0);
      const phone = charge.payer_phone as string | null;
      if (!phone) {
        skipped += 1;
        continue;
      }

      // Cadence gate: first at >24h (already filtered), second only after the gap.
      if (count >= MAX_REMINDERS) {
        skipped += 1;
        continue;
      }
      if (count === 1) {
        const lastAt = charge.fee_reminder_last_at as string | null;
        if (!lastAt || lastAt > secondGapCutoff) {
          // Not yet ~3 days since the first reminder.
          skipped += 1;
          continue;
        }
      }

      if (!approved) {
        skipped += 1;
        continue;
      }

      // Student name.
      const studentId = charge.student_id as string | null;
      let studentName = '';
      if (studentId) {
        const { data: studentRow } = await supabaseAdmin
          .from('students')
          .select('name')
          .eq('id', studentId)
          .maybeSingle();
        studentName = (studentRow?.name as string | null)?.trim() ?? '';
      }

      // Teacher payment profile (cached).
      const teacherId = charge.teacher_id as string | null;
      let profile: TeacherPaymentProfile | null = null;
      if (teacherId) {
        if (teacherCache.has(teacherId)) {
          profile = teacherCache.get(teacherId) ?? null;
        } else {
          const { data: profileRow } = await supabaseAdmin
            .from('teacher_profiles')
            .select(
              'instapay_address, wallet_phone, payment_phone, accepted_methods, default_payment_method',
            )
            .eq('user_id', teacherId)
            .maybeSingle();
          profile = (profileRow as TeacherPaymentProfile | null) ?? null;
          teacherCache.set(teacherId, profile);
        }
      }

      const paymentDetails = profile ? buildPaymentDetails(profile) : null;
      const hasDetails = paymentDetails !== null;

      // Fallback flag: teacher entered no payment details. Lightweight Sentry
      // breadcrumb (once per teacher per run) so they can be nudged to add them.
      if (!hasDetails && teacherId && !flaggedTeachers.has(teacherId)) {
        flaggedTeachers.add(teacherId);
        Sentry.addBreadcrumb({
          category: 'fee-reminders',
          level: 'warning',
          message: 'Teacher has no payment details for fee reminder',
          data: { teacher_id: teacherId },
        });
        fallback += 1;
      }

      // Next class date (best-effort from the group's recurring schedule).
      const groupId = charge.group_id as string | null;
      let scheduleRows: { day_of_week: number }[] = [];
      if (groupId) {
        if (groupScheduleCache.has(groupId)) {
          scheduleRows = groupScheduleCache.get(groupId) ?? [];
        } else {
          const { data: schedRows } = await supabaseAdmin
            .from('group_schedule')
            .select('day_of_week')
            .eq('group_id', groupId);
          scheduleRows = (schedRows as { day_of_week: number }[] | null) ?? [];
          groupScheduleCache.set(groupId, scheduleRows);
        }
      }
      const nextDate = nextClassDate(scheduleRows);

      const feeStr = formatCurrency(Number(charge.amount_billed ?? 0), 'ar');
      // Fallback copy: no fabricated details, no link — just a plain ask.
      const detailsText = hasDetails ? (paymentDetails as string) : FEE_REMINDER_FALLBACK_TEXT;

      const centerId = (charge.center_id as string | null) ?? '';

      try {
        const result = await sendTemplateMessage(
          centerId,
          phone,
          FEE_REMINDER_TEMPLATE,
          {
            '1': studentName,
            '2': feeStr,
            '3': detailsText,
            '4': nextDate,
          },
          { bodyParameterOrder: ['1', '2', '3', '4'] },
        );

        if (!result.success) {
          skipped += 1;
          continue;
        }

        // Direct service-role update of the cadence columns (not lifecycle-
        // protected, so the guard trigger allows it).
        const { error: updErr } = await supabaseAdmin
          .from('transactions')
          .update({
            fee_reminder_count: count + 1,
            fee_reminder_last_at: new Date().toISOString(),
          })
          .eq('id', charge.id as string);
        if (updErr) {
          console.error('[fee-reminders] cadence update failed:', charge.id, updErr);
        }
        sent += 1;
      } catch (waErr) {
        console.error('[fee-reminders] WA send error:', waErr);
        failed += 1;
      }
    }

    await insertCronLogSuccess(supabaseAdmin, CRON_NAME, {
      duration_ms: Date.now() - cronStart,
      records_processed: sent + skipped,
      metadata: { sent, skipped, fallback, failed },
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
      console.error('[fee-reminders] cron_health_log:', healthLogErr);
    }

    return NextResponse.json({ success: true, sent, skipped, fallback, failed });
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
