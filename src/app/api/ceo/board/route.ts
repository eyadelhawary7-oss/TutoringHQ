import { NextResponse, type NextRequest } from 'next/server';
import { requireSuperAdminApi } from '@/lib/admin-auth';
import { getCeoBoard } from '@/lib/ceoBoard';

/**
 * GET /api/ceo/board — `Merged-CEO` §01 board figures (read-only).
 *
 * Spans every center and every teacher, so the gate is the security boundary:
 * `requireSuperAdminApi` rejects anyone who is not a platform super-admin
 * (401/403) before any query runs on the service-role client. Same gate as
 * `/api/ceo/teachers` and `/api/ceo/trials-watch`.
 *
 * No mutations — nothing here needs CSRF (see S9 for the CEO routes that do).
 */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) return auth.response;

  try {
    const data = await getCeoBoard(auth.supabaseAdmin);
    return NextResponse.json(data);
  } catch (err) {
    console.error('[CEO Board] query failed:', err);
    return NextResponse.json({ error: 'Board data unavailable' }, { status: 503 });
  }
}
