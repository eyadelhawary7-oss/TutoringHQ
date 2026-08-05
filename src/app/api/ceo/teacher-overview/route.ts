import { NextResponse, type NextRequest } from 'next/server';
import { requireSuperAdminApi } from '@/lib/admin-auth';
import { getCeoTeacherOverview } from '@/lib/ceoTeachers';

/**
 * GET /api/ceo/teacher-overview — `Merged-CEO` §02 overview strip (read-only).
 *
 * Spans every teacher across every center, so the gate is the security
 * boundary: `requireSuperAdminApi` rejects non-super-admins before any query
 * runs on the service-role client. Same gate as `/api/ceo/teachers`.
 *
 * No mutations — nothing here needs CSRF.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  try {
    const data = await getCeoTeacherOverview(auth.supabaseAdmin);
    return NextResponse.json(data);
  } catch (err) {
    console.error('[CEO Teacher Overview] query failed:', err);
    return NextResponse.json({ error: 'Teacher overview unavailable' }, { status: 503 });
  }
}
