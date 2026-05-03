import { NextRequest, NextResponse } from 'next/server';
import { sendTemplateMessage } from '@/lib/whatsapp/client';
import { toArabicNumerals, WA_TEMPLATES } from '@/lib/parentPack';
import { requireOwnerAdminCenter } from '@/lib/requireOwnerAdminCenter';
import { assertIsoDateForOrFilter } from '@/lib/postgrestSafe';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const ctx = await requireOwnerAdminCenter(request);
  if (ctx instanceof NextResponse) return ctx;

  const { supabaseAdmin, centerId } = ctx;

  let body: { periodId?: string; groupId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.periodId || typeof body.periodId !== 'string') {
    return NextResponse.json({ error: 'periodId required' }, { status: 400 });
  }

  if (!body.groupId || typeof body.groupId !== 'string') {
    return NextResponse.json({ error: 'groupId required' }, { status: 400 });
  }

  if (body.groupId !== 'all' && !UUID_RE.test(body.groupId)) {
    return NextResponse.json({ error: 'Invalid groupId' }, { status: 400 });
  }

  const { data: period } = await supabaseAdmin
    .from('academic_periods')
    .select('id, name, start_date, end_date')
    .eq('id', body.periodId)
    .eq('center_id', centerId)
    .maybeSingle();

  if (!period) {
    return NextResponse.json({ error: 'Period not found' }, { status: 404 });
  }

  const periodStart = assertIsoDateForOrFilter(String(period.start_date).slice(0, 10), 'period.start_date');
  const periodEnd = assertIsoDateForOrFilter(String(period.end_date).slice(0, 10), 'period.end_date');

  const { data: ctr } = await supabaseAdmin.from('centers').select('name').eq('id', centerId).maybeSingle();

  const groupIds: string[] =
    body.groupId === 'all'
      ? ((await supabaseAdmin.from('student_groups').select('id').eq('center_id', centerId)).data?.map((g) => g.id) ??
        [])
      : [body.groupId];

  if (groupIds.length === 0) {
    return NextResponse.json({ sent: 0 });
  }

  const studentMap = new Map<
    string,
    { id: string; name: string; parent_phone: string; fee: number; groupId: string }
  >();

  for (const gId of groupIds) {
    const { data: members } = await supabaseAdmin
      .from('student_group_members')
      .select('group_id, students(id, name, parent_phone, fee, is_active, parent_pack_opted_in, center_id)')
      .eq('group_id', gId)
      .eq('center_id', centerId);

    for (const member of members ?? []) {
      const rawSt = member.students as unknown;
      const s = (Array.isArray(rawSt) ? rawSt[0] : rawSt) as {
        id: string;
        name: string;
        parent_phone: string | null;
        fee: string | number | null;
        is_active: boolean | null;
        parent_pack_opted_in: boolean | null;
        center_id: string;
      } | null;
      if (!s) continue;
      if (s.center_id !== centerId) continue;
      if (!s.parent_pack_opted_in) continue;
      if (!s.parent_phone) continue;
      if (s.is_active === false) continue;
      if (!studentMap.has(s.id)) {
        studentMap.set(s.id, {
          id: s.id,
          name: s.name,
          parent_phone: s.parent_phone,
          fee: Number(s.fee ?? 0),
          groupId: member.group_id as string,
        });
      }
    }
  }

  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeks = Math.max(
    1,
    Math.round(
      (new Date(`${periodEnd}T12:00:00`).getTime() - new Date(`${periodStart}T12:00:00`).getTime()) /
        msPerWeek,
    ),
  );

  let sent = 0;
  for (const student of studentMap.values()) {
    const { count: attendanceCount } = await supabaseAdmin
      .from('attendance_scans')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', student.id)
      .eq('group_id', student.groupId)
      .gte('session_date', periodStart)
      .lte('session_date', periodEnd);

    const { count: slotsPerWeek } = await supabaseAdmin
      .from('schedule_slots')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', student.groupId)
      .eq('recurring', true)
      .or(`recurring_until.is.null,recurring_until.gte.${periodStart}`);

    const totalSessions = (slotsPerWeek ?? 1) * weeks;

    await sendTemplateMessage(centerId, student.parent_phone, WA_TEMPLATES.PARENT_TERM_SUMMARY, {
      '1': student.name,
      '2': period.name,
      '3': toArabicNumerals(attendanceCount ?? 0),
      '4': toArabicNumerals(totalSessions),
      '5': toArabicNumerals(Math.round(student.fee)),
      '6': ctr?.name ?? '',
    });
    sent += 1;
  }

  return NextResponse.json({ sent });
}
