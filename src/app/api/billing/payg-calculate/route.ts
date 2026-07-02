/**
 * Calculate the PAYG weekly charge for the authenticated caller's center.
 * On-demand only; requires a valid center session (super-admins may target
 * another center via a body `centerId`).
 */
import { NextRequest, NextResponse } from 'next/server';
import { calculatePaygCharge } from '@/lib/payg-calculator';
import { parseBodyWithLimit } from '@/lib/validate';
import { requireCenterAuth } from '@/lib/centerAuth';

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

export async function POST(request: NextRequest) {
  try {
    const body = (await parseBodyWithLimit(request, 65536).catch(() => ({}))) as Record<string, unknown>;

    // Always authenticate. Previously auth ran only when the body had no
    // `centerId`, so sending a `centerId` skipped auth entirely and the route
    // queried any center's scans via the service role.
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    const supabase = auth.supabaseAdmin;

    // A body-supplied centerId is honoured only for super-admins; every other
    // caller is scoped to their own center regardless of what they send.
    const bodyCenterId = typeof body.centerId === 'string' ? body.centerId : undefined;
    const targetCenterId =
      auth.isSuperAdmin && bodyCenterId ? bodyCenterId : auth.centerId;

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
