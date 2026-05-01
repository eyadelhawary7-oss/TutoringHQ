import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const maxDuration = 300;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 50;

type CenterRow = {
  id: string;
  plan: string | null;
  last_scan_at: string | null;
  approved_at: string | null;
};

type MetricsDailyRow = {
  center_id: string;
  metric_date: string;
  total_scans: number | null;
  logins_count: number | null;
  payments_recorded: number | null;
  students_active: number | null;
  last_scan_at: string | null;
  last_upserted_at: string | null;
};

export async function GET(request: Request) {
  const auth = request.headers.get('Authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const admin = supabaseAdmin;

  const { data: centerRows, error: centersError } = await admin
    .from('centers')
    .select('id, plan, last_scan_at, approved_at')
    .eq('status', 'active');

  if (centersError) {
    console.error('[recompute-health-scores] centers:', centersError.message);
    return NextResponse.json({ error: centersError.message }, { status: 500 });
  }

  const centers = (centerRows ?? []) as CenterRow[];
  if (centers.length === 0) {
    await upsertCronHealth();
    return NextResponse.json({ processed: 0, errors: 0 });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);

  const { data: metricsRows, error: metricsError } = await admin
    .from('center_metrics_daily')
    .select(
      'center_id, metric_date, total_scans, logins_count, payments_recorded, students_active, last_scan_at, last_upserted_at',
    )
    .gte('metric_date', sevenDaysAgo);

  if (metricsError) {
    console.error('[recompute-health-scores] metrics:', metricsError.message);
    return NextResponse.json({ error: metricsError.message }, { status: 500 });
  }

  const metricsByCenter = new Map<string, MetricsDailyRow[]>();
  for (const row of (metricsRows ?? []) as MetricsDailyRow[]) {
    const list = metricsByCenter.get(row.center_id) ?? [];
    list.push(row);
    metricsByCenter.set(row.center_id, list);
  }

  const updates: {
    id: string;
    health_score: number;
    health_status: 'green' | 'amber' | 'red';
  }[] = [];

  let processed = 0;
  let errors = 0;
  const staleThresholdMs = 26 * 60 * 60 * 1000;

  for (const center of centers) {
    try {
      const rows = metricsByCenter.get(center.id) ?? [];
      const hasRecentMetrics =
        rows.length > 0 &&
        rows.some(
          (r) =>
            r.last_upserted_at != null &&
            Date.now() - new Date(r.last_upserted_at).getTime() <
              staleThresholdMs,
        );

      let loginScore: number;
      let scanScore: number;
      let paymentScore: number;
      let studentScore: number;

      if (hasRecentMetrics) {
        const totalLogins = rows.reduce(
          (s, r) => s + (r.logins_count ?? 0),
          0,
        );
        const totalScans = rows.reduce(
          (s, r) => s + (r.total_scans ?? 0),
          0,
        );
        const totalPayments = rows.reduce(
          (s, r) => s + (r.payments_recorded ?? 0),
          0,
        );
        const byDate = [...rows].sort((a, b) =>
          b.metric_date.localeCompare(a.metric_date),
        );
        const latestStudents = byDate[0]?.students_active ?? 0;

        loginScore = Math.min(100, totalLogins * 14);
        scanScore = Math.min(100, totalScans * 3);
        paymentScore = Math.min(100, totalPayments * 34);
        studentScore = Math.min(100, latestStudents * 2);
      } else {
        const [scansRes, paymentsRes, usersRes, studentsRes] =
          await Promise.all([
            admin
              .from('attendance_scans')
              .select('id', { count: 'exact', head: true })
              .eq('center_id', center.id)
              .gte('scanned_at', sevenDaysAgo),
            admin
              .from('payments')
              .select('id', { count: 'exact', head: true })
              .eq('center_id', center.id)
              .gte('paid_at', sevenDaysAgo),
            admin
              .from('users')
              .select('id', { count: 'exact', head: true })
              .eq('center_id', center.id),
            admin
              .from('students')
              .select('id', { count: 'exact', head: true })
              .eq('center_id', center.id)
              .eq('is_active', true),
          ]);

        const totalScans = scansRes.count ?? 0;
        const totalPayments = paymentsRes.count ?? 0;
        const totalLogins = usersRes.count ?? 0;
        const latestStudents = studentsRes.count ?? 0;

        loginScore = Math.min(100, totalLogins * 14);
        scanScore = Math.min(100, totalScans * 3);
        paymentScore = Math.min(100, totalPayments * 34);
        studentScore = Math.min(100, latestStudents * 2);
      }

      let score = Math.round(
        loginScore * 0.35 +
          studentScore * 0.25 +
          scanScore * 0.25 +
          paymentScore * 0.15,
      );

      if (center.last_scan_at) {
        const daysSinceLastScan = Math.floor(
          (Date.now() - new Date(center.last_scan_at).getTime()) / MS_PER_DAY,
        );
        if (daysSinceLastScan >= 4) {
          score = Math.max(0, score - 25);
        }
      } else if (center.approved_at) {
        score = Math.max(0, score - 25);
      }

      score = Math.max(0, Math.min(100, score));

      const status: 'green' | 'amber' | 'red' =
        score >= 70 ? 'green' : score >= 40 ? 'amber' : 'red';

      updates.push({
        id: center.id,
        health_score: score,
        health_status: status,
      });
      processed += 1;
    } catch (e) {
      console.error('[recompute-health-scores] center', center.id, e);
      errors += 1;
    }
  }

  const updatedAt = new Date().toISOString();

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((u) =>
        admin
          .from('centers')
          .update({
            health_score: u.health_score,
            health_status: u.health_status,
            health_score_updated_at: updatedAt,
          })
          .eq('id', u.id),
      ),
    );
  }

  await upsertCronHealth();

  return NextResponse.json({ processed, errors, updatedAt });
}

async function upsertCronHealth() {
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin.from('cron_health_log').upsert(
      {
        cron_name: 'recompute-health-scores',
        last_success_at: new Date().toISOString(),
        failure_count: 0,
      },
      { onConflict: 'cron_name' },
    );
  } catch (e) {
    console.error('[recompute-health-scores] cron_health_log:', e);
  }
}
