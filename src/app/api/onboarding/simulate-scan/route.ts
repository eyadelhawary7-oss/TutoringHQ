import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

async function getUserCenterContext(request: NextRequest) {
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

  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id, can_scan')
    .eq('id', user.id)
    .single();

  const centerId = userRecord?.center_id as string | undefined;
  if (!centerId) return null;

  return {
    userId: user.id,
    centerId,
    canScan: (userRecord as { can_scan?: boolean }).can_scan !== false,
    supabaseAdmin,
  };
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getUserCenterContext(req);
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!ctx.canScan) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: student } = await ctx.supabaseAdmin
      .from('students')
      .select('id')
      .eq('center_id', ctx.centerId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!student?.id) {
      return NextResponse.json(
        { error: 'Add a student before simulating a scan' },
        { status: 400 },
      );
    }

    const scannedAt = new Date().toISOString();
    const sessionDate = scannedAt.slice(0, 10);

    const { error } = await ctx.supabaseAdmin.from('attendance_scans').insert({
      student_id: student.id,
      center_id: ctx.centerId,
      scanned_by: ctx.userId,
      scanned_at: scannedAt,
      session_date: sessionDate,
      payment_status_at_scan: 'unpaid',
      payment_recorded: false,
    });

    if (error) {
      return NextResponse.json({ error: error.message ?? 'Scan failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[onboarding/simulate-scan]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
