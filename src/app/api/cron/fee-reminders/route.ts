import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { insertCronLogSuccess, insertCronLogFailure } from '@/lib/cron/cronLog';
import { supabaseAdmin as supabaseAdminHealth } from '@/lib/supabase-admin';
import { isTemplateApproved } from '@/lib/centerNotify';
import { sendTemplateMessage } from '@/lib/whatsapp/client';
import { formatCurrency, formatDate } from '@/lib/formatNumber';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FEE_REMINDER_TEMPLATE = 'chq_fee_reminder';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_REMINDER_AGE_MS = ONE_DAY_MS; // class ended > 24h ago
const SECOND_REMINDER_GAP_MS = 3 * ONE_DAY_MS; // ~3 days after the first
const MAX_REMINDERS = 2;
const CAIRO_TZ = 'Africa/Cairo';

const PAYMENT_METHODS = ['cash', 'instapay', 'vodafone_cash', 'other'] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

type TeacherPaymentProfile = {
  instapay_address: string | null;
  wallet_phone: string | null;
  payment_phone: string | null;
  accepted_methods: string[] | null;
  default_payment_method: string | null;
};

/** Arabic label for a payment method (matches the teacher settings copy). */
const METHOD_LABEL_AR: Record<PaymentMethod, string> = {
  cash: 'كاش',
  instapay: 'إنستا باي',
  vodafone_cash: 'فودافون كاش',
  other: 'غير كده',
};

function methodDetail(profile: TeacherPaymentProfile, method: PaymentMethod): string | null {
  switch (method) {
    case 'instapay':
      return profile.instapay_address
        ? `${METHOD_LABEL_AR.instapay}: ${profile.instapay_address}`
        : METHOD_LABEL_AR.instapay;
    case 'vodafone_cash':
      return profile.wallet_phone
        ? `${METHOD_LABEL_AR.vodafone_cash}: ${profile.wallet_phone}`
        : METHOD_LABEL_AR.vodafone_cash;
    case 'cash':
      // Cash needs no handle; the payment_phone (if any) is a coordination number.
      return profile.payment_phone
        ? `${METHOD_LABEL_AR.cash} (${profile.payment_phone})`
        : METHOD_LABEL_AR.cash;
    case 'other':
      return profile.payment_phone
        ? `${METHOD_LABEL_AR.other}: ${profile.payment_phone}`
        : null;
    default:
      return null;
  }
}

/**
 * Builds the payment-details line for the reminder: the teacher's DEFAULT method
 * first, then the other accepted methods. Returns null when the teacher has
 * entered no usable payment details at all (no handles AND no accepted methods),
 * which signals the fallback path.
 */
function buildPaymentDetails(profile: TeacherPaymentProfile): string | null {
  const accepted = (profile.accepted_methods ?? []).filter(
    (m): m is PaymentMethod => (PAYMENT_METHODS as readonly string[]).includes(m),
  );
  const hasAnyHandle = Boolean(
    profile.instapay_address || profile.wallet_phone || profile.payment_phone,
  );
  if (accepted.length === 0 && !hasAnyHandle) {
    return null;
  }

  const ordered: PaymentMethod[] = [];
  const def = profile.default_payment_method;
  if (def && (PAYMENT_METHODS as readonly string[]).includes(def) && accepted.includes(def as PaymentMethod)) {
    ordered.push(def as PaymentMethod);
  }
  for (const m of accepted) {
    if (!ordered.includes(m)) ordered.push(m);
  }

  // No accepted methods but a handle exists: infer from the handle.
  if (ordered.length === 0) {
    if (profile.instapay_address) ordered.push('instapay');
    else if (profile.wallet_phone) ordered.push('vodafone_cash');
    else if (profile.payment_phone) ordered.push('other');
  }

  const lines = ordered
    .map((m) => methodDetail(profile, m))
    .filter((line): line is string => Boolean(line));

  if (lines.length === 0) return null;
  return lines.join('\n');
}

/**
 * Best-effort next class date for a group from group_schedule (recurring weekly
 * slots, day_of_week 0=Sun..6=Sat). Returns a Cairo-formatted Arabic date string
 * for the soonest upcoming slot, or '' when no schedule exists.
 */
function nextClassDate(
  scheduleRows: { day_of_week: number }[] | null | undefined,
): string {
  if (!scheduleRows || scheduleRows.length === 0) return '';

  // Today's day-of-week in Cairo (0=Sun..6=Sat) via en-US weekday.
  const weekdayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const todayName = new Intl.DateTimeFormat('en-US', {
    timeZone: CAIRO_TZ,
    weekday: 'long',
  })
    .format(new Date())
    .toLowerCase();
  const todayDow = weekdayNames.indexOf(todayName);
  if (todayDow < 0) return '';

  let minAhead = 8;
  for (const row of scheduleRows) {
    const dow = Number(row.day_of_week);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) continue;
    // Days until the next occurrence (>=1, so we always point to a future class).
    let ahead = dow - todayDow;
    if (ahead <= 0) ahead += 7;
    if (ahead < minAhead) minAhead = ahead;
  }
  if (minAhead > 7) return '';

  const target = new Date(Date.now() + minAhead * ONE_DAY_MS);
  return formatDate(target, 'ar', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: CAIRO_TZ,
  });
}

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
      const detailsText = hasDetails ? (paymentDetails as string) : 'برجاء إرسال رسوم الحصة.';

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
