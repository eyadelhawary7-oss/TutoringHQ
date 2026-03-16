import { createClient } from '@supabase/supabase-js';

async function getUserContext(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace('Bearer ', '');
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: { user }, error } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id')
    .eq('id', user.id)
    .single();

  if (!userRecord?.center_id) return null;

  return { centerId: userRecord.center_id, supabaseAdmin };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const { searchParams } = new URL(request.url);
  const weeksNum = Math.min(
    Math.max(parseInt(searchParams.get('weeks') || '8', 10), 1),
    52
  );

  const ctx = await getUserContext(request);
  if (!ctx) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = ctx.supabaseAdmin;
  const userCenterId = ctx.centerId;

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
