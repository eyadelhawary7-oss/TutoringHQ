/**
 * Recompute Center Health scores (weighted 0–100) — nightly cron
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = 50;
const PARALLEL_CENTERS = 12;

const MS_PER_DAY = 86_400_000;

function loginPoints(daysSinceLogin: number | null): number {
  if (daysSinceLogin === null) return 0;
  if (daysSinceLogin < 7) return 35;
  if (daysSinceLogin <= 14) return 17;
  return 0;
}

function statusFromScore(score: number): 'green' | 'amber' | 'red' {
  if (score >= 70) return 'green';
  if (score >= 40) return 'amber';
  return 'red';
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

type CenterWork = { id: string; ownerAuthId: string | null };

export async function POST(request: Request) {
  const auth = request.headers.get('Authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  const admin = supabaseAdmin;

  const thirtyDaysAgo = new Date(Date.now() - 30 * MS_PER_DAY).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * MS_PER_DAY).toISOString();

  const { data: centerRows, error: centersError } = await admin
    .from('centers')
    .select('id')
    .eq('status', 'active');

  if (centersError) {
    console.error('[recompute-health-scores] centers:', centersError.message);
    return NextResponse.json({ error: centersError.message }, { status: 500 });
  }

  const centers = (centerRows ?? []) as { id: string }[];
  const centerIds = centers.map((c) => c.id);
  if (centerIds.length === 0) {
    return NextResponse.json({ processed: 0, green: 0, amber: 0, red: 0 });
  }

  const { data: ownerRows, error: ownersError } = await admin
    .from('users')
    .select('id, center_id')
    .eq('role', 'owner')
    .in('center_id', centerIds);

  if (ownersError) {
    console.error('[recompute-health-scores] owners:', ownersError.message);
    return NextResponse.json({ error: ownersError.message }, { status: 500 });
  }

  const ownerByCenter = new Map<string, string>();
  for (const row of (ownerRows ?? []) as { id: string; center_id: string | null }[]) {
    if (row.center_id && !ownerByCenter.has(row.center_id)) {
      ownerByCenter.set(row.center_id, row.id);
    }
  }

  const workList: CenterWork[] = centers.map((c) => ({
    id: c.id,
    ownerAuthId: ownerByCenter.get(c.id) ?? null,
  }));

  const updates: { id: string; health_score: number; health_status: 'green' | 'amber' | 'red' }[] = [];

  async function scoreOne(
    center: CenterWork,
  ): Promise<{ id: string; health_score: number; health_status: 'green' | 'amber' | 'red' }> {
    const [loginRes, studentsRes, scansRes, paymentsRes] = await Promise.all([
      (async (): Promise<number | null> => {
        if (!center.ownerAuthId) return null;
        const { data, error } = await admin.auth.admin.getUserById(center.ownerAuthId);
        if (error || !data?.user) return null;
        const at = data.user.last_sign_in_at;
        if (!at) return null;
        return Math.floor((Date.now() - new Date(at).getTime()) / MS_PER_DAY);
      })(),
      admin
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('center_id', center.id)
        .gte('created_at', thirtyDaysAgo),
      admin
        .from('attendance_scans')
        .select('id', { count: 'exact', head: true })
        .eq('center_id', center.id)
        .gte('scanned_at', sevenDaysAgo),
      admin
        .from('payments')
        .select('id', { count: 'exact', head: true })
        .eq('center_id', center.id)
        .gte('paid_at', thirtyDaysAgo),
    ]);

    const s1 = loginPoints(loginRes);
    const s2 = (studentsRes.count ?? 0) > 0 ? 25 : 0;
    const s3 = (scansRes.count ?? 0) > 0 ? 25 : 0;
    const s4 = (paymentsRes.count ?? 0) > 0 ? 15 : 0;
    const score = Math.min(100, s1 + s2 + s3 + s4);
    const health_status = statusFromScore(score);
    return { id: center.id, health_score: score, health_status };
  }

  for (const group of chunkArray(workList, PARALLEL_CENTERS)) {
    const partial = await Promise.all(group.map((c) => scoreOne(c)));
    updates.push(...partial);
  }

  let green = 0;
  let amber = 0;
  let red = 0;
  for (const u of updates) {
    if (u.health_status === 'green') green += 1;
    else if (u.health_status === 'amber') amber += 1;
    else red += 1;
  }

  const nowIso = new Date().toISOString();
  for (const batch of chunkArray(updates, BATCH_SIZE)) {
    await Promise.all(
      batch.map((u) =>
        admin
          .from('centers')
          .update({
            health_score: u.health_score,
            health_status: u.health_status,
            health_score_updated_at: nowIso,
          })
          .eq('id', u.id),
      ),
    );
  }

  const { error: logErr } = await admin.from('cron_health_log').upsert(
    {
      cron_name: 'recompute-health-scores',
      last_success_at: nowIso,
      failure_count: 0,
    },
    { onConflict: 'cron_name' },
  );
  if (logErr) {
    console.error('[recompute-health-scores] cron_health_log:', logErr.message);
  }

  return NextResponse.json({
    processed: workList.length,
    green,
    amber,
    red,
  });
}

export async function GET(request: Request) {
  return POST(request);
}
