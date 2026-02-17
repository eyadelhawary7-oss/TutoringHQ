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
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/5d45850b-1c51-447c-910a-e44a9b31e025',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'limits/route.ts:GET:entry',message:'limits GET called',data:{},timestamp:Date.now(),hypothesisId:'H4'})}).catch(()=>{});
    // #endregion
    const ctx = await getUserContext(request);
    if (!ctx) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/5d45850b-1c51-447c-910a-e44a9b31e025',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'limits/route.ts:ctx_null',message:'getUserContext null',data:{},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const centerId = ctx.user.center_id;
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/5d45850b-1c51-447c-910a-e44a9b31e025',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'limits/route.ts:before_center',message:'before center query',data:{centerId},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
    // #endregion

    const { data: center, error: centerError } = await ctx.supabaseAdmin
      .from('centers')
      .select('max_teachers, max_students, plan')
      .eq('id', centerId)
      .single();

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/5d45850b-1c51-447c-910a-e44a9b31e025',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'limits/route.ts:after_center',message:'after center query',data:{hasCenter:!!center,centerError:centerError?.message??null,centerCode:centerError?.code??null},timestamp:Date.now(),hypothesisId:'H2_H3'})}).catch(()=>{});
    // #endregion

    if (centerError || !center) {
      return NextResponse.json({ error: 'Center not found' }, { status: 404 });
    }

    const maxTeachers = Number(center.max_teachers ?? 2);
    const maxStudents = Number(center.max_students ?? 150);

    // Count all team members (owner, admin, assistant, teacher)
    const { count: currentTeamMembers } = await ctx.supabaseAdmin
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('center_id', centerId);

    const { count: currentStudents } = await ctx.supabaseAdmin
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('center_id', centerId);

    // Weekly active students (unique students scanned in past 7 days)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const { data: weeklyScans } = await ctx.supabaseAdmin
      .from('attendance_scans')
      .select('student_id')
      .eq('center_id', centerId)
      .gte('scanned_at', weekAgo.toISOString());
    const weeklyUniqueStudents = new Set((weeklyScans || []).map((s: { student_id: string }) => s.student_id)).size;

    const plan = (center as { plan?: string })?.plan || 'starter';
    const studentLimit = plan === 'top_centers' || plan === 'payg' ? 999999 : Number(center.max_students ?? 150);

    const currentTeachers = currentTeamMembers ?? 0;
    return NextResponse.json({
      maxTeachers,
      currentTeachers,
      maxStudents,
      currentStudents: currentStudents ?? 0,
      canAddTeacher: currentTeachers < maxTeachers,
      canAddStudent: (currentStudents ?? 0) < maxStudents,
      plan,
      weeklyUniqueStudents,
      studentLimit,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
