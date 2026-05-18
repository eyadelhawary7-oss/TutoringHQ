import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { insertCronLogFailure, insertCronLogSuccess } from '@/lib/cron/cronLog';

export const maxDuration = 300;

const CRON_NAME = 'recompute-health-scores';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 50;

type CenterRow = {
  id: string;
  plan: string | null;
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
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const admin = supabaseAdmin;

  const cronStart = Date.now();

  const { data: centerRows, error: centersError } = await admin
    .from('centers')
    .select('id, plan, approved_at')
    .eq('status', 'active');

  if (centersError) {
    console.error('[recompute-health-scores] centers:', centersError.message);
    await insertCronLogFailure(admin, CRON_NAME, new Error(centersError.message), {
      duration_ms: Date.now() - cronStart,
    });
    return NextResponse.json({ error: centersError.message }, { status: 500 });
  }

  const centers = (centerRows ?? []) as CenterRow[];
  if (centers.length === 0) {
    await upsertCronHealth();
    await insertCronLogSuccess(admin, CRON_NAME, {
      duration_ms: Date.now() - cronStart,
      metadata: { processed: 0 },
    });
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
    await insertCronLogFailure(admin, CRON_NAME, new Error(metricsError.message), {
      duration_ms: Date.now() - cronStart,
    });
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
            Date.now() - new Date(r.last_upserted_at).getTime() < staleThresholdMs,
        );

      let loginScore: number;
      let scanScore: number;
      let paymentScore: number;
      let studentScore: number;
      let lastScanAt: string | null = null;

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

        // Derive last_scan_at from the metrics rows we already have.
        lastScanAt = rows.reduce<string | null>((acc, r) => {
          if (!r.last_scan_at) return acc;
          if (!acc) return r.last_scan_at;
          return r.last_scan_at > acc ? r.last_scan_at : acc;
        }, null);
      } else {
        const [scansRes, paymentsRes, usersRes, studentsRes, latestScanRes] =
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
            admin
              .from('attendance_scans')
              .select('scanned_at')
              .eq('center_id', center.id)
              .order('scanned_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);

        const totalScans = scansRes.count ?? 0;
        const totalPayments = paymentsRes.count ?? 0;
        const totalLogins = usersRes.count ?? 0;
        const latestStudents = studentsRes.count ?? 0;

        loginScore = Math.min(100, totalLogins * 14);
        scanScore = Math.min(100, totalScans * 3);
        paymentScore = Math.min(100, totalPayments * 34);
        studentScore = Math.min(100, latestStudents * 2);

        lastScanAt =
          (latestScanRes.data as { scanned_at: string | null } | null)
            ?.scanned_at ?? null;
      }

      let score = Math.round(
        loginScore * 0.35 +
          studentScore * 0.25 +
          scanScore * 0.25 +
          paymentScore * 0.15,
      );

      if (lastScanAt) {
        const daysSinceLastScan = Math.floor(
          (Date.now() - new Date(lastScanAt).getTime()) / MS_PER_DAY,
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

  await insertCronLogSuccess(admin, CRON_NAME, {
    duration_ms: Date.now() - cronStart,
    records_processed: processed,
    metadata: { errors },
  });

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