import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

async function getUserContext(request: NextRequest) {
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
    .select('id, center_id, role')
    .eq('id', user.id)
    .single();

  if (!userRecord?.center_id) return null;

  return { user: userRecord, supabaseAdmin };
}

/**
 * GET /api/settings/limits
 * Returns the current center's plan limits and current counts.
 * Response: { maxTeachers, currentTeachers, maxStudents, currentStudents, canAddTeacher, canAddStudent }
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const centerId = ctx.user.center_id;

    const { data: center, error: centerError } = await ctx.supabaseAdmin
      .from('centers')
      .select('max_teachers, max_students')
      .eq('id', centerId)
      .single();

    if (centerError || !center) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }

    const maxTeachers = Number(center.max_teachers ?? 8);
    const maxStudents = Number(center.max_students ?? 200);

    const { count: currentTeachers } = await ctx.supabaseAdmin
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('center_id', centerId)
      .eq('role', 'teacher');

    const { count: currentStudents } = await ctx.supabaseAdmin
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('center_id', centerId);

    return NextResponse.json({
      maxTeachers,
      currentTeachers: currentTeachers ?? 0,
      maxStudents,
      currentStudents: currentStudents ?? 0,
      canAddTeacher: (currentTeachers ?? 0) < maxTeachers,
      canAddStudent: (currentStudents ?? 0) < maxStudents,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
