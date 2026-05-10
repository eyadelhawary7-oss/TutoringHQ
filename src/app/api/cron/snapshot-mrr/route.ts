import { NextResponse } from 'next/server';
import { insertCronLogFailure, insertCronLogSuccess } from '@/lib/cron/cronLog';
import { requireCronSecret } from '@/lib/cron/requireCronSecret';
import { computeMrrSnapshot } from '@/lib/mrrSnapshot';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const CRON_NAME = 'snapshot-mrr';

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const cronStart = Date.now();

  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'misconfigured' }, { status: 500 });
  }

  const admin = supabaseAdmin;

  try {
    const snapshot_date = new Date().toISOString().slice(0, 10);
    const snapshot = await computeMrrSnapshot(admin);

    const { error: upsertError } = await admin.from('mrr_snapshots').upsert(
      {
        snapshot_date,
        total_mrr: snapshot.total_mrr,
        active_centers: snapshot.active_centers,
        by_plan: snapshot.by_plan,
        computed_at: new Date().toISOString(),
      },
      { onConflict: 'snapshot_date' },
    );

    if (upsertError) {
      throw new Error(upsertError.message);
    }

    await insertCronLogSuccess(admin, CRON_NAME, {
      duration_ms: Date.now() - cronStart,
      records_processed: 1,
      metadata: {
        snapshot_date,
        total_mrr: snapshot.total_mrr,
        active_centers: snapshot.active_centers,
      },
    });

    return NextResponse.json({
      ok: true,
      snapshot_date,
      total_mrr: snapshot.total_mrr,
      active_centers: snapshot.active_centers,
    });
  } catch (e) {
    await insertCronLogFailure(admin, CRON_NAME, e, { duration_ms: Date.now() - cronStart });
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
