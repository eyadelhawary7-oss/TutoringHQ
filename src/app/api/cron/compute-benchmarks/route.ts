/**
 * Compute benchmarks API — invoked by cron at 1am UTC daily
 * Calls compute_benchmark_snapshots RPC
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const snapshotDate = yesterday.toISOString().slice(0, 10);

    const { data, error } = await supabase.rpc('compute_benchmark_snapshots', {
      p_snapshot_date: snapshotDate,
    });

    if (error) {
      console.error('[compute-benchmarks] RPC error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rowsAffected = (data as number) ?? 0;
    return NextResponse.json({ ok: true, rows_affected: rowsAffected, snapshot_date: snapshotDate });
  } catch (err) {
    console.error('[compute-benchmarks] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
