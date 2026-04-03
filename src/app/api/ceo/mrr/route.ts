import { getAdminContext } from '@/lib/admin-auth';

export async function GET(request: Request) {
  const ctx = await getAdminContext(request);
  if (!ctx) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = ctx.supabaseAdmin;

  const { data: snapshots, error } = await supabase
    .from('mrr_snapshots')
    .select('snapshot_date, mrr, active_centers, new_centers, churned_centers')
    .order('snapshot_date', { ascending: false })
    .limit(30);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const safeSnapshots = snapshots || [];

  // Reverse for chart display: oldest → newest (left to right)
  const chartSnapshots = [...safeSnapshots].reverse();

  // Latest snapshot is the first item (fetched descending)
  const latest = safeSnapshots[0] ?? null;

  // This month aggregates
  const thisMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const thisMonthRows = safeSnapshots.filter(
    (s) => typeof s.snapshot_date === 'string' && s.snapshot_date.startsWith(thisMonth)
  );

  return Response.json({
    // Chart data: ascending order (oldest first), ready for Recharts
    snapshots: chartSnapshots,
    summary: {
      currentMrr: latest?.mrr ?? 0,
      activeCenters: latest?.active_centers ?? 0,
      newThisMonth: thisMonthRows.reduce((sum, s) => sum + (s.new_centers ?? 0), 0),
      churnedThisMonth: thisMonthRows.reduce((sum, s) => sum + (s.churned_centers ?? 0), 0),
    },
    hasData: safeSnapshots.length > 0,
  });
}
