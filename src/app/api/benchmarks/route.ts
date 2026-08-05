import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { centerAccessGateResponse } from '@/lib/centerAccessGate';

async function getUserContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) return null;

  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch {
    return null;
  }

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace('Bearer ', '');
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: { user }, error } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id, organization_id')
    .eq('id', user.id)
    .single();

  if (!userRecord?.center_id && !userRecord?.organization_id) return null;

  return { user: userRecord, authUser: user, supabaseAdmin };
}

/**
 * `Merged-Center-Insight` §02 draws every metric row against the LOCAL MEDIAN
 * ("You 18,400 · median 14,200 EGP", plus a median tick on the track) — not
 * against the mean. `get_center_benchmarks` returns only `district_avg` per
 * metric even though it reads the p25/p50/p75 columns internally to interpolate
 * the percentile, so the median never reaches the client.
 *
 * Verified live before writing this (information_schema.columns, project
 * lczmjpnbuhnsislcvzar): `benchmark_snapshots` physically carries
 * `p50_attendance_rate`, `p50_revenue_per_student`, `p50_retention_rate_30d`
 * and `p50_group_utilization`. This reads them directly rather than changing
 * the RPC, so no migration is involved.
 *
 * The snapshot picked here is the SAME ONE the RPC picked, and that is now
 * enforced rather than asserted. An earlier version of this function claimed
 * the two "can never diverge" while taking only `district` and `tier` from the
 * RPC response and RE-DERIVING the date with its own
 * `.order('snapshot_date', desc).limit(1)`. That is two independent round trips
 * against a table a daily cron writes: a snapshot inserted between them, or a
 * duplicate `snapshot_date` with no tie-break, and the medians attached here
 * belong to a different row than the percentiles the RPC computed.
 *
 * `pg_get_functiondef(get_center_benchmarks)` — read live, not assumed —
 * returns `'snapshot_date', v_snapshot.snapshot_date` in its jsonb. The one
 * field that makes the claim true was already on the wire and was being
 * ignored. It is now filtered on explicitly, so the lookup either hits the
 * RPC's exact row or returns nothing. When the RPC withheld the comparison
 * (`insufficient_data`, or a district under the 10-centre threshold) nothing is
 * attached — the median is a district figure and must inherit the same
 * disclosure gate as the rest of the comparison.
 */
const MEDIAN_COLUMNS = {
  attendance: 'p50_attendance_rate',
  revenue_per_student: 'p50_revenue_per_student',
  retention_30d: 'p50_retention_rate_30d',
  group_utilization: 'p50_group_utilization',
} as const;

async function withDistrictMedians(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (payload.insufficient_data !== false) return payload;

  const district = typeof payload.district === 'string' ? payload.district : null;
  const tier = typeof payload.tier === 'string' ? payload.tier : null;
  // The RPC's own snapshot_date. Without it there is no way to guarantee we
  // read the same row it did, so withhold rather than guess with a fresh
  // "latest" lookup — a median from the wrong snapshot is worse than none.
  const snapshotDate = typeof payload.snapshot_date === 'string' ? payload.snapshot_date : null;
  if (!district || !tier || !snapshotDate) return payload;

  const { data: snapshot, error } = await supabaseAdmin
    .from('benchmark_snapshots')
    .select(Object.values(MEDIAN_COLUMNS).join(', '))
    .eq('district', district)
    .eq('student_count_tier', tier)
    .eq('snapshot_date', snapshotDate)
    .limit(1)
    .maybeSingle();

  if (error || !snapshot) {
    // Non-fatal: the screen renders without the median line rather than 500ing.
    if (error) console.error('[benchmarks] median lookup failed:', error.message);
    return payload;
  }

  const row = snapshot as unknown as Record<string, number | null>;
  const out = { ...payload };
  for (const [metricKey, column] of Object.entries(MEDIAN_COLUMNS)) {
    const metric = out[metricKey];
    if (!metric || typeof metric !== 'object') continue;
    const median = row[column];
    if (median === null || median === undefined) continue;
    out[metricKey] = { ...(metric as Record<string, unknown>), district_median: Number(median) };
  }
  return out;
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { user: userRecord, authUser, supabaseAdmin } = ctx;
    const { searchParams } = new URL(request.url);
    const centerIdParam = searchParams.get('center_id');

    let centerId: string | null = userRecord.center_id;

    if (centerIdParam && userRecord.organization_id) {
      const { data: assignment } = await supabaseAdmin
        .from('branch_user_assignments')
        .select('center_id')
        .eq('user_id', authUser.id)
        .eq('center_id', centerIdParam)
        .maybeSingle();

      const { data: orgCenters } = await supabaseAdmin
        .from('centers')
        .select('id')
        .eq('organization_id', userRecord.organization_id)
        .eq('id', centerIdParam);

      if (assignment || (orgCenters?.length ?? 0) > 0) {
        centerId = centerIdParam;
      }
    } else if (centerIdParam && centerIdParam === userRecord.center_id) {
      centerId = centerIdParam;
    }

    if (!centerId && userRecord.organization_id) {
      const { data: firstCenter } = await supabaseAdmin
        .from('centers')
        .select('id')
        .eq('organization_id', userRecord.organization_id)
        .limit(1)
        .maybeSingle();
      if (firstCenter) centerId = (firstCenter as { id: string }).id;
    }

    if (!centerId) return NextResponse.json({ error: 'No center' }, { status: 400 });

    // Part 6 (BLOCK): the hand-rolled auth here skipped the suspension / lock gate.
    // A locked centre sees only the invoice and a pay button, not benchmarks.
    const gate = await centerAccessGateResponse(supabaseAdmin, centerId);
    if (gate) return gate;

    const { data, error } = await supabaseAdmin.rpc('get_center_benchmarks', {
      p_center_id: centerId,
    });

    if (error) {
      console.error('[benchmarks] RPC error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const payload = (data ?? {}) as Record<string, unknown>;
    const enriched = await withDistrictMedians(supabaseAdmin, payload);

    return NextResponse.json(enriched);
  } catch (err) {
    console.error('[benchmarks] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
