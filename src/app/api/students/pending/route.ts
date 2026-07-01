import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';

export async function GET(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  const { supabaseAdmin, centerId } = auth;

  const { data: rows, error } = await supabaseAdmin
    .from('pending_enrollments')
    .select('id, student_id, group_id, student_name, student_phone, parent_phone, notes, status, created_at')
    .eq('center_id', centerId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }

  const list = (rows ?? []) as Array<{
    id: string;
    student_id: string | null;
    group_id: string;
    student_name: string;
    student_phone: string;
    parent_phone: string | null;
    notes: string | null;
    status: string;
    created_at: string;
  }>;

  const groupIds = Array.from(new Set(list.map((r) => r.group_id)));
  let groupNameById: Record<string, string> = {};
  if (groupIds.length > 0) {
    const { data: groups } = await supabaseAdmin
      .from('student_groups')
      .select('id, name, subject')
      .in('id', groupIds);
    const groupRows = (groups ?? []) as Array<{ id: string; name: string | null; subject: string | null }>;
    groupNameById = Object.fromEntries(groupRows.map((g) => [g.id, g.name ?? '']));
  }

  return NextResponse.json({
    pending: list.map((r) => ({
      ...r,
      group_name: groupNameById[r.group_id] ?? '',
    })),
  });
}
