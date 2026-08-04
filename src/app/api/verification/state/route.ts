import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';
import { requireCenterAuth, requireTeacherAuth } from '@/lib/centerAuth';
import { readVerificationState } from '@/lib/verification/readVerificationState';

/**
 * GET /api/verification/state
 *
 * The single endpoint every verification-aware surface reads. Returns the
 * authenticated caller's OWN verification state and nothing else.
 *
 * TENANCY: the subject is derived entirely server-side. `requireCenterAuth`
 * yields `centerId` from the session's `users` row; `requireTeacherAuth` yields
 * the teacher's own `userId`. This route accepts NO body, NO query parameters
 * and NO identifiers of any kind, so there is nothing for a caller to tamper
 * with — cross-tenant reads are impossible by construction rather than by
 * check.
 *
 * METHOD: GET only. It mutates nothing, so it carries no CSRF token; CSRF
 * applies to the mutating routes (the redirect launcher and the webhook), which
 * Territory A owns.
 *
 * WHAT IT RETURNS TODAY: `available: false` with a named cause, for every
 * caller, because the Valify credentials are placeholders AND the verification
 * columns do not exist in the live schema (both re-verified 4 Aug 2026). That
 * is the honest answer and the UI renders it as such. There is deliberately no
 * default-to-verified, no optimistic branch and no cached "last known good".
 */

// Subjects a caller may be. Centre-side users resolve to their centre; solo
// teachers are centre-less (users.center_id NULL) and resolve to themselves.
export async function GET(request: NextRequest) {
  const centerAuth = await requireCenterAuth(request);
  if (centerAuth.ok) {
    const state = await readVerificationState(centerAuth.supabaseAdmin, {
      kind: 'center',
      id: centerAuth.centerId,
    });
    return NextResponse.json(
      { subjectKind: 'center', state },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Not a centre user. A solo teacher has no centre_id at all, so centre auth
  // legitimately fails for them — fall through rather than 401ing a teacher.
  const teacherAuth = await requireTeacherAuth(request);
  if (teacherAuth.ok) {
    const state = await readVerificationState(teacherAuth.supabaseAdmin, {
      kind: 'teacher',
      id: teacherAuth.userId,
    });
    return NextResponse.json(
      { subjectKind: 'teacher', state },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Neither. Return the centre-auth failure, which carries the real reason
  // (NO_BEARER / TOKEN_INVALID / CENTER_SUSPENDED …).
  return centerAuth.response;
}
