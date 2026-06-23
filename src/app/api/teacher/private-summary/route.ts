import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireTeacherAuth } from '@/lib/centerAuth';
import { countActiveNonGuestStudents } from '@/lib/teacherCap';

/**
 * Headline numbers for the teacher private-engine LOCK SUMMARY — the teacher
 * equivalent of the center /suspended screen: total private groups + total
 * private (active, non-guest) students. COUNTS ONLY, never records.
 *
 * Uses the plain teacher gate (requireTeacherAuth), NOT requireTeacherPrivateAccess,
 * so a LAPSED (locked) teacher can still see her own headline numbers behind the
 * lock. The free zone (center monitoring) is not touched here. The actual private
 * records remain gated by requireTeacherPrivateAccess on their own routes.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacherAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const { data: groupRows, error: groupsErr } = await auth.supabaseAdmin
      .from('student_groups')
      .select('id')
      .eq('teacher_id', auth.userId)
      .eq('kind', 'private')
      .eq('status', 'active');
    if (groupsErr) throw groupsErr;

    const privateGroups = (groupRows ?? []).length;
    const privateStudents = await countActiveNonGuestStudents(auth.supabaseAdmin, auth.userId);

    return NextResponse.json({ privateGroups, privateStudents });
  } catch (e) {
    Sentry.withScope((scope) => {
      scope.setTag('route', 'api/teacher/private-summary');
      Sentry.captureException(e);
    });
    return NextResponse.json({ error: 'Server error', code: 'server_error' }, { status: 500 });
  }
}
