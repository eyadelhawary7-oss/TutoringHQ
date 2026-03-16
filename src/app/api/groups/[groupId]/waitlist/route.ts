import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

async function getContext(request: NextRequest) {
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

  return { supabaseAdmin };
}

/** GET: List waitlist for group */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const ctx = await getContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { groupId } = await params;
    if (!groupId) return NextResponse.json({ error: 'groupId required' }, { status: 400 });

    const { data: students, error } = await ctx.supabaseAdmin
      .from('students')
      .select('id, name, student_number, parent_phone, waitlist_position')
      .eq('waitlist_group_id', groupId)
      .order('waitlist_position', { ascending: true, nullsFirst: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ waitlist: students ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/** POST: Add student to waitlist */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const ctx = await getContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { groupId } = await params;
    const body = await request.json().catch(() => ({}));
    const studentId = typeof body.student_id === 'string' ? body.student_id : null;

    if (!groupId || !studentId) {
      return NextResponse.json({ error: 'groupId and student_id required' }, { status: 400 });
    }

    const { data: group } = await ctx.supabaseAdmin
      .from('student_groups')
      .select('id, center_id')
      .eq('id', groupId)
      .single();

    if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });

    const { count } = await ctx.supabaseAdmin
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('waitlist_group_id', groupId);

    const position = (count ?? 0) + 1;

    const { error: updateError } = await ctx.supabaseAdmin
      .from('students')
      .update({ waitlist_group_id: groupId, waitlist_position: position })
      .eq('id', studentId)
      .eq('center_id', (group as { center_id: string }).center_id);

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    return NextResponse.json({ ok: true, position });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
