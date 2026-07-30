import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  // Preserve the original owner/admin-only gate.
  if (!['owner', 'admin'].includes(auth.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { supabaseAdmin, centerId } = auth;
  const { id } = await context.params;

  const { data: pending, error } = await supabaseAdmin
    .from('pending_enrollments')
    .update({ status: 'rejected' })
    .eq('id', id)
    .eq('center_id', centerId)
    .select('student_id')
    .single();

  if (error) {
    return NextResponse.json({ error: 'Failed to reject request' }, { status: 500 });
  }

  // D24: rejection used to leave the student row untouched, so a rejected
  // signup stayed is_active=false forever with no way to tell it apart from a
  // real staff pause. Stamp the reason directly on the student so it never
  // depends on this pending_enrollments row again.
  const studentId = (pending as { student_id: string | null } | null)?.student_id;
  if (studentId) {
    const { error: studentErr } = await supabaseAdmin
      .from('students')
      .update({ inactive_reason: 'rejected' })
      .eq('id', studentId)
      .eq('center_id', centerId);
    if (studentErr) {
      console.error('[students/pending/reject] inactive_reason stamp failed:', studentErr);
    }
  }

  return NextResponse.json({ success: true });
}
