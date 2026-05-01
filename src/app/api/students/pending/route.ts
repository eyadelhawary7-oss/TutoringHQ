import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

async function getCenterContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const accessToken = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('role, center_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!userRow || !userRow.center_id) return { unauthorized: true as const };

  return {
    supabaseAdmin,
    centerId: userRow.center_id as string,
    userId: user.id,
    role: (userRow.role as string) ?? 'staff',
  };
}

export async function GET(request: NextRequest) {
  const ctx = await getCenterContext(request);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ('unauthorized' in ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { supabaseAdmin, centerId } = ctx;

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
