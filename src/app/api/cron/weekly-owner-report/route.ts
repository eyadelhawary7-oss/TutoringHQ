/**
 * Weekly owner WhatsApp report (Sunday 06:00 UTC) — chq_weekly_summary
 */

import { NextResponse } from 'next/server';
import { sendWeeklyReport } from '@/lib/centerNotify';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CRON_NAME = 'weekly-owner-report';
const BATCH_SIZE = 20;

const TIPS = [
  'طالب منتظم في الحضور = نتيجة أفضل. تابع المتغيبين هذا الأسبوع.',
  'المجموعات الصغيرة تحقق نتائج أكبر. هل حان وقت إضافة مجموعة جديدة؟',
  'ذكّر أولياء الأمور بالدفع مبكراً — يقلل المتأخرات بنسبة 40%.',
  'سجّل الحضور يومياً — البيانات المنتظمة تعطيك صورة أوضح.',
  'مركز منظم = مركز ناجح. استمر على هذا المستوى.',
  'الطلاب الجدد في أول شهر هم الأكثر تأثراً — تابعهم عن كثب.',
  'راجع قائمة طلابك غير النشطين هذا الأسبوع.',
];

function weekStartMondayDate(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - daysToMonday);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart.toISOString().split('T')[0]!;
}

function rollingSevenDaysAgoIso(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

function isUniqueViolation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === '23505') return true;
  return String(err.message ?? '').toLowerCase().includes('duplicate');
}

type CenterRow = {
  id: string;
  name: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  phone: string | null;
};

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const admin = supabaseAdmin;

  const { data: pausedRow } = await admin
    .from('platform_config')
    .select('value')
    .eq('key', 'cron_paused')
    .maybeSingle();
  if (pausedRow?.value === true) {
    return NextResponse.json({ skipped: 'cron_paused' }, { status: 200 });
  }

  const weekStartDate = weekStartMondayDate();
  const sinceIso = rollingSevenDaysAgoIso();
  const weekNumber = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const tip = TIPS[weekNumber % TIPS.length]!;

  const { data: centerRows, error: centersErr } = await admin
    .from('centers')
    .select('id, name, owner_name, owner_phone, phone')
    .eq('status', 'active');

  if (centersErr) {
    console.error(`[${CRON_NAME}] centers:`, centersErr.message);
    return NextResponse.json({ error: centersErr.message }, { status: 500 });
  }

  const centers = (centerRows ?? []) as CenterRow[];
  const processed = centers.length;
  let sent = 0;
  let skipped = 0;

  async function handleOne(center: CenterRow): Promise<void> {
    const ownerPhone = (center.owner_phone ?? center.phone ?? '').trim();
    if (!ownerPhone) {
      skipped += 1;
      return;
    }

    const { error: claimErr } = await admin.from('weekly_report_log').insert({
      center_id: center.id,
      week_start: weekStartDate,
    });

    if (claimErr) {
      if (isUniqueViolation(claimErr)) {
        skipped += 1;
        return;
      }
      console.error(`[${CRON_NAME}] weekly_report_log insert`, center.id, claimErr);
      skipped += 1;
      return;
    }

    let activeStudents = 0;
    let attendanceSessions = 0;
    let revenue = 0;
    let newStudents = 0;

    try {
      const [activeRes, scansRes, paymentsRes, newStRes] = await Promise.all([
        admin
          .from('students')
          .select('id', { count: 'exact', head: true })
          .eq('center_id', center.id)
          .eq('is_active', true),
        admin
          .from('attendance_scans')
          .select('id', { count: 'exact', head: true })
          .eq('center_id', center.id)
          .gte('scanned_at', sinceIso),
        admin
          .from('payments')
          .select('amount')
          .eq('center_id', center.id)
          .not('paid_at', 'is', null)
          .gte('paid_at', sinceIso)
          .in('status', ['paid', 'confirmed']),
        admin
          .from('students')
          .select('id', { count: 'exact', head: true })
          .eq('center_id', center.id)
          .gte('created_at', sinceIso),
      ]);

      if (activeRes.error) {
        console.error(`[${CRON_NAME}] active students`, center.id, activeRes.error);
      } else {
        activeStudents = activeRes.count ?? 0;
      }

      if (scansRes.error) {
        console.error(`[${CRON_NAME}] attendance_scans`, center.id, scansRes.error);
      } else {
        attendanceSessions = scansRes.count ?? 0;
      }

      if (paymentsRes.error) {
        console.error(`[${CRON_NAME}] payments`, center.id, paymentsRes.error);
      } else {
        revenue = (paymentsRes.data ?? []).reduce(
          (sum, row) => sum + Number((row as { amount?: unknown }).amount ?? 0),
          0,
        );
      }

      if (newStRes.error) {
        console.error(`[${CRON_NAME}] new students`, center.id, newStRes.error);
      } else {
        newStudents = newStRes.count ?? 0;
      }
    } catch (aggErr) {
      console.error(`[${CRON_NAME}] aggregate`, center.id, aggErr);
    }

    const ownerName = (center.owner_name ?? center.name ?? '—').trim() || '—';
    const centerName = (center.name ?? '—').trim() || '—';

    let notify: Awaited<ReturnType<typeof sendWeeklyReport>> = { skipped: true };
    try {
      notify = await sendWeeklyReport(
        admin,
        center.id,
        ownerPhone,
        ownerName,
        centerName,
        activeStudents,
        attendanceSessions,
        revenue,
        newStudents,
        tip,
      );
    } catch (e) {
      console.error(`[${CRON_NAME}] sendWeeklyReport`, center.id, e);
    }

    if (notify.success) {
      sent += 1;
      return;
    }

    const { error: delErr } = await admin
      .from('weekly_report_log')
      .delete()
      .eq('center_id', center.id)
      .eq('week_start', weekStartDate);
    if (delErr) {
      console.error(`[${CRON_NAME}] weekly_report_log delete after failed send`, center.id, delErr);
    }
    skipped += 1;
  }

  for (let i = 0; i < centers.length; i += BATCH_SIZE) {
    const batch = centers.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map((c) => handleOne(c)));
  }

  try {
    await admin.from('cron_health_log').upsert(
      {
        cron_name: CRON_NAME,
        last_success_at: new Date().toISOString(),
        failure_count: 0,
      },
      { onConflict: 'cron_name' },
    );
  } catch (healthLogErr) {
    console.error(`[${CRON_NAME}] cron_health_log:`, healthLogErr);
  }

  return NextResponse.json({
    processed,
    sent,
    skipped,
    week_start: weekStartDate,
  });
}

export async function GET(request: Request) {
  return POST(request);
}
