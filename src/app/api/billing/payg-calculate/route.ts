/**
 * Calculate PAYG weekly charge for a center.
 * Can be called by cron or on-demand.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { calculatePaygCharge } from '@/lib/payg-calculator';

async function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key, { auth: { persistSession: false } });
}

function getWeekBounds(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { centerId } = body;
    const authHeader = request.headers.get('Authorization');

    const supabase = await getSupabase();

    let targetCenterId = centerId;
    if (!targetCenterId && authHeader) {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseAuth = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false }, global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user } } = await supabaseAuth.auth.getUser();
      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      const { data: u } = await supabase.from('users').select('center_id').eq('id', user.id).single();
      if (!u?.center_id) return NextResponse.json({ error: 'No center' }, { status: 403 });
      targetCenterId = (u as { center_id: string }).center_id;
    }

    if (!targetCenterId) {
      return NextResponse.json({ error: 'centerId required or valid auth' }, { status: 400 });
    }

    const { start: weekStart, end: weekEnd } = getWeekBounds();

    const { data: scans } = await supabase
      .from('attendance_scans')
      .select('student_id')
      .eq('center_id', targetCenterId)
      .gte('scanned_at', `${weekStart}T00:00:00`)
      .lte('scanned_at', `${weekEnd}T23:59:59`);

    const uniqueStudents = new Set((scans || []).map((s: { student_id: string }) => s.student_id));
    const studentCount = uniqueStudents.size;
    const { weeklyCharge, monthlyEstimate, ratePerStudent } = calculatePaygCharge(studentCount);

    return NextResponse.json({
      centerId: targetCenterId,
      weekStart,
      weekEnd,
      studentCount,
      ratePerStudent,
      weeklyCharge,
      monthlyEstimate,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}
