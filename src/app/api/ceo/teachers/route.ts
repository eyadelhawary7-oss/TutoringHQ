import { NextResponse, type NextRequest } from 'next/server';
import { requireSuperAdminApi } from '@/lib/admin-auth';
import { getCeoTeacherData } from '@/lib/ceoTeachers';

/**
 * Owner-only teacher-side visibility (read-only). Exposes ALL teachers across
 * every center, so the gate is the security boundary: requireSuperAdminApi
 * rejects anyone who is not a platform super-admin (401/403) before any query
 * runs on the service-role client.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  try {
    const data = await getCeoTeacherData(auth.supabaseAdmin);
    return NextResponse.json(data);
  } catch (err) {
    console.error('[CEO Teachers] query failed:', err);
    return NextResponse.json(
      { error: 'Teacher data unavailable' },
      { status: 503 },
    );
  }
}
