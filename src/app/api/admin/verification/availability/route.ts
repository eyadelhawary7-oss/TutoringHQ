import 'server-only';

import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { getValifyConfigStatus } from '@/lib/valifyGuardLogic';
import { resolveEffectiveState } from '@/lib/verificationState';
import { VERIFICATION_RECORDS_TABLE, isMissingRelation } from '@/lib/verificationStore';

/**
 * GET /api/admin/verification/availability
 *
 * Whether the identity-verification feature is live AT ALL, for internal staff.
 * This is deployment state, not tenant data — there is no `center_id` here and no
 * per-centre answer.
 *
 * Any internal admin role may read it, `internal_viewer` included: a viewer
 * looking at a vendor row that says "Connected" when nothing is connected is
 * exactly the failure this endpoint exists to prevent.
 *
 * DELIBERATELY DOES NOT return env var names or values. The named cause is what
 * an operator needs; `admin_users` includes sales and support roles, and leaking
 * the deployment's config key list to them buys nothing.
 *
 * ----------------------------------------------------------------------------
 * THE SCHEMA ANSWER IS PROBED, NOT ASSERTED.
 * ----------------------------------------------------------------------------
 * An earlier version of this route passed `stateSourceAvailable: false` as a
 * literal with a comment saying the columns do not exist. The fact was true when
 * written and it is true today — verified live against project
 * lczmjpnbuhnsislcvzar on 4 August 2026, `verification_records` and
 * `verification_attempts` are both absent from `information_schema.tables` — but
 * a hardcoded fact is a fact that goes stale the hour Eyad applies the migration,
 * and this endpoint would then keep telling admins the feature is dead while it
 * quietly worked. So it asks the database instead: a zero-row HEAD count against
 * `verification_records`, whose undefined-relation error IS the answer.
 *
 * GET only, mutates nothing, so no CSRF token.
 */
export async function GET(request: Request) {
  const ctx = await getAdminContext(request);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const guard = getValifyConfigStatus();
  if (!guard.configured) {
    // Credentials come first. With no credentials, whether the tables exist is
    // not the operator's blocking problem and reporting the schema cause would
    // send them to fix the wrong thing.
    return NextResponse.json(
      { state: resolveEffectiveState(null, guard.cause) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { error } = await ctx.supabaseAdmin
    .from(VERIFICATION_RECORDS_TABLE)
    .select('subject_type', { count: 'exact', head: true })
    .limit(0);

  // Any error at all fails closed. A missing relation gets the accurate named
  // cause; anything else (permissions, connectivity) still reports unconfigured
  // rather than implying the feature is live, because an admin screen that says
  // "Connected" on the strength of an unreadable database is the lie this
  // endpoint exists to remove.
  const cause = error
    ? isMissingRelation(error)
      ? ('verification_schema_not_applied' as const)
      : ('valify_not_configured' as const)
    : null;

  return NextResponse.json(
    { state: resolveEffectiveState(null, cause) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
