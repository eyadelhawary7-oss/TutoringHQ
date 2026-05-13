import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { sendParentTermSummary } from '@/lib/centerNotify';
import { parseBodyWithLimit } from '@/lib/validate';

export const dynamic = 'force-dynamic';

type Body = { studentIds?: string[]; groupId?: string };

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  const { supabaseAdmin, centerId } = auth;
  let body: Body;
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const studentIds = Array.isArray(body.studentIds) ? body.studentIds.filter((x) => typeof x === 'string') : [];
  const groupId = typeof body.groupId === 'string' ? body.groupId.trim() : '';
  if (studentIds.length === 0 || !groupId) {
    return NextResponse.json({ error: 'studentIds and groupId are required' }, { status: 400 });
  }

  const { data: groupRow, error: gErr } = await supabaseAdmin
    .from('student_groups')
    .select('id, name, fee, center_id')
    .eq('id', groupId)
    .maybeSingle();
  if (gErr || !groupRow || (groupRow as { center_id?: string }).center_id !== centerId) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }
  const groupName = String((groupRow as { name?: string | null }).name ?? '').trim() || ',';
  const groupFee = Number((groupRow as { fee?: number | string | null }).fee ?? 0) || 0;

  const { data: centerRow } = await supabaseAdmin
    .from('centers')
    .select('name')
    .eq('id', centerId)
    .maybeSingle();
  const centerName = String((centerRow as { name?: string | null } | null)?.name ?? '').trim() || ',';

  const { data: scans } = await supabaseAdmin
    .from('attendance_scans')
    .select('student_id, scanned_at')
    .eq('center_id', centerId)
    .eq('group_id', groupId);

  const sessionDates = new Set<string>();
  for (const s of scans ?? []) {
    const row = s as { scanned_at?: string };
    if (row.scanned_at) sessionDates.add(row.scanned_at.slice(0, 10));
  }
  const totalSessions = sessionDates.size;

  const { data: members } = await supabaseAdmin
    .from('student_group_members')
    .select('student_id')
    .eq('group_id', groupId)
    .in('student_id', studentIds);

  const allowed = new Set((members ?? []).map((m) => (m as { student_id: string }).student_id));
  const filteredIds = studentIds.filter((id) => allowed.has(id));
  if (filteredIds.length === 0) {
    return NextResponse.json({ error: 'No matching students in this group' }, { status: 400 });
  }

  const { data: students } = await supabaseAdmin
    .from('students')
    .select('id, name, parent_phone')
    .eq('center_id', centerId)
    .in('id', filteredIds);

  let sent = 0;
  let failed = 0;

  for (const st of students ?? []) {
    const row = st as { id: string; name: string | null; parent_phone: string | null };
    const parentPhone = row.parent_phone?.trim();
    if (!parentPhone) {
      failed += 1;
      continue;
    }

    const attended = (scans ?? []).filter(
      (sc) => (sc as { student_id?: string }).student_id === row.id,
    ).length;

    const { data: payRows } = await supabaseAdmin
      .from('payments')
      .select('amount')
      .eq('center_id', centerId)
      .eq('student_id', row.id)
      .eq('confirmed', true);

    const paid = (payRows ?? []).reduce(
      (s, p) => s + Number((p as { amount?: number | string | null }).amount ?? 0),
      0,
    );
    const owed = attended * groupFee;
    const balance = Math.max(0, owed - paid);

    const ok = await sendParentTermSummary(
      parentPhone,
      (row.name ?? '').trim() || ',',
      groupName,
      attended,
      totalSessions || attended,
      balance,
      centerName,
    );
    if (ok) sent += 1;
    else failed += 1;
  }

  return NextResponse.json({ sent, failed });
}
