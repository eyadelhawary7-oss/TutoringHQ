import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'Token required' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: row, error } = await supabase
    .from('parent_portal_tokens')
    .select('student_id, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
  }

  const now = new Date().toISOString();
  if (!row || (row as { expires_at: string }).expires_at <= now) {
    let centerPhone: string | null = null;
    if (row) {
      const { data: st } = await supabase
        .from('students')
        .select('center_id')
        .eq('id', (row as { student_id: string }).student_id)
        .single();
      if (st) {
        const { data: c } = await supabase
          .from('centers')
          .select('phone')
          .eq('id', (st as { center_id: string }).center_id)
          .single();
        centerPhone = (c as { phone?: string } | null)?.phone ?? null;
      }
    }
    return NextResponse.json({ expired: true, center_phone: centerPhone });
  }

  const studentId = (row as { student_id: string }).student_id;

  const { data: student } = await supabase
    .from('students')
    .select('id, name, center_id, balance_due')
    .eq('id', studentId)
    .single();

  if (!student) {
    return NextResponse.json({ error: 'Student not found' }, { status: 404 });
  }

  const cid = (student as { center_id: string }).center_id;
  const { data: center } = await supabase
    .from('centers')
    .select('name, phone')
    .eq('id', cid)
    .single();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: scans } = await supabase
    .from('attendance_scans')
    .select('scanned_at')
    .eq('student_id', studentId)
    .gte('scanned_at', thirtyDaysAgo.toISOString());

  const scansByDate: Record<string, boolean> = {};
  for (const s of scans ?? []) {
    const d = (s as { scanned_at: string }).scanned_at.slice(0, 10);
    scansByDate[d] = true;
  }

  const { data: members } = await supabase
    .from('student_group_members')
    .select('group_id')
    .eq('student_id', studentId);
  const groupIds = [...new Set((members ?? []).map((m: { group_id: string }) => m.group_id))];

  let nextSessions: { day: string; time: string; group: string }[] = [];
  if (groupIds.length > 0) {
    const { data: slots } = await supabase
      .from('schedule_slots')
      .select('day_of_week, start_time, end_time, group_id')
      .eq('center_id', cid)
      .in('group_id', groupIds);

    const { data: grps } = await supabase
      .from('student_groups')
      .select('id, name')
      .in('id', groupIds);
    const groupMap = new Map((grps ?? []).map((g: { id: string; name: string }) => [g.id, g.name]));

    const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const nowDate = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(nowDate);
      d.setDate(d.getDate() + i);
      const dow = d.getDay();
      for (const sl of slots ?? []) {
        const s = sl as { day_of_week: number; start_time: string; group_id: string };
        const slotDow = typeof s.day_of_week === 'string' ? parseInt(s.day_of_week, 10) : s.day_of_week;
        if (slotDow === dow && groupIds.includes(s.group_id)) {
          const start = s.start_time?.toString().slice(0, 5) ?? '';
          nextSessions.push({
            day: DAYS[dow],
            time: start,
            group: groupMap.get(s.group_id) ?? '',
          });
        }
      }
    }
    nextSessions = nextSessions.slice(0, 5);
  }

  return NextResponse.json({
    name: (student as { name: string }).name ?? '',
    center_name: (center as { name?: string })?.name ?? '',
    center_phone: (center as { phone?: string })?.phone ?? null,
    balance_due: Number((student as { balance_due?: number }).balance_due) || 0,
    scans_by_date: scansByDate,
    next_sessions: nextSessions,
  });
}
