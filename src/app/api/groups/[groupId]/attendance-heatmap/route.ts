import { NextRequest } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const { groupId } = await params;
  const { searchParams } = new URL(request.url);
  const weeksNum = Math.min(
    Math.max(parseInt(searchParams.get('weeks') || '8', 10), 1),
    52
  );

  const auth = await requireCenterAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const supabase = auth.supabaseAdmin;
  const userCenterId = auth.centerId;

  const { data: group, error: groupError } = await supabase
    .from('student_groups')
    .select('id, center_id')
    .eq('id', groupId)
    .maybeSingle();

  if (groupError || !group) {
    return Response.json({ error: 'Group not found' }, { status: 404 });
  }
  if (group.center_id !== userCenterId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - weeksNum * 7);
  const cutoffISO = cutoffDate.toISOString();

  const { data: scans, error: scansError } = await supabase
    .from('attendance_scans')
    .select('student_id, session_date, scanned_at')
    .eq('group_id', groupId)
    .gte('scanned_at', cutoffISO);

  if (scansError) {
    return Response.json({ error: scansError.message }, { status: 500 });
  }

  const grouped: Record<string, Set<string>> = {};
  for (const scan of scans || []) {
    const date: string =
      scan.session_date ?? scan.scanned_at?.split('T')[0] ?? '';
    if (!date) continue;
    if (!grouped[date]) grouped[date] = new Set();
    grouped[date].add(scan.student_id);
  }

  const cells = Object.entries(grouped)
    .map(([date, studentSet]) => ({
      date,
      present: studentSet.size,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const { count } = await supabase
    .from('student_group_members')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', groupId);

  const groupSize = count ?? 0;

  return Response.json({ cells, groupSize, weeksNum });
}
