import 'server-only';

import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { readVerificationConfig } from '@/lib/verification/config';
import { resolveVerificationState } from '@/lib/verification/state';

/**
 * GET /api/admin/verification/availability
 *
 * Whether the identity-verification feature is live AT ALL, for internal staff.
 * This is deployment state, not tenant data — there is no `center_id` here and
 * no per-centre answer, because until the schema carries verification columns
 * there is no per-centre state to have.
 *
 * Any internal admin role may read it, `internal_viewer` included: a viewer
 * looking at a vendor row that says "Connected" when nothing is connected is
 * exactly the failure this endpoint exists to prevent.
 *
 * DELIBERATELY DOES NOT return env var names or values. The named cause
 * ("credentials not set" vs "still on placeholder values") is what an operator
 * needs; `admin_users` includes sales and support roles, and leaking the
 * deployment's config key list to them buys nothing.
 *
 * GET only, mutates nothing, so no CSRF token.
 */
export async function GET(request: Request) {
  const ctx = await getAdminContext(request);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = readVerificationConfig();

  // `stateSourceAvailable: false` is a live-verified fact, not a placeholder:
  // as of 4 Aug 2026 neither `centers` nor `teacher_profiles` carries a
  // verification column, so no per-subject status can be reported even with
  // real credentials. The state machine applies config precedence first.
  const state = resolveVerificationState({
    config,
    stateSourceAvailable: false,
    row: null,
  });

  return NextResponse.json({ state }, { headers: { 'Cache-Control': 'no-store' } });
}
